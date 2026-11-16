// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Miniflare } from 'miniflare'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchSubscriptionContent } from '../cloudflare/subscription-fetcher-core.js'

const VALID_CLASH_YAML = `mixed-port: 7890
proxies:
  - name: "Entry-入口"
    type: socks5
    server: 203.0.113.10
    port: 1080
proxy-groups:
  - name: 入口节点
    type: select
    proxies:
      - Entry-入口
rules:
  - MATCH,入口节点
`

const mfInstances = []

afterEach(async () => {
  while (mfInstances.length > 0) {
    const mf = mfInstances.pop()
    await mf.dispose()
  }
})

function loadWorkerSources() {
  const root = resolve(import.meta.dirname, '..')
  const appSource = readFileSync(resolve(root, 'cloudflare/app-worker.js'), 'utf8')
  const fetcherSource = readFileSync(resolve(root, 'cloudflare/subscription-fetcher-worker.js'), 'utf8')
  const fetcherCoreSource = readFileSync(resolve(root, 'cloudflare/subscription-fetcher-core.js'), 'utf8')
  const guardSource = readFileSync(resolve(root, 'shared/ssrf-guard.mjs'), 'utf8')
  return { appSource, fetcherSource, fetcherCoreSource, guardSource }
}

function createWorkerModules(appSource, fetcherSource, fetcherCoreSource, guardSource) {
  return {
    appModules: [
      { type: 'ESModule', path: 'cloudflare/app-worker.js', contents: appSource },
      { type: 'ESModule', path: 'shared/ssrf-guard.mjs', contents: guardSource },
    ],
    fetcherModules: [
      { type: 'ESModule', path: 'cloudflare/subscription-fetcher-worker.js', contents: fetcherSource },
      { type: 'ESModule', path: 'cloudflare/subscription-fetcher-core.js', contents: fetcherCoreSource },
      { type: 'ESModule', path: 'shared/ssrf-guard.mjs', contents: guardSource },
    ],
  }
}

describe('Cloudflare Worker subscription fetcher redirect & limit enforcement (B03 / T06 / T07)', () => {
  it('按每跳白名单跟随合法重定向并拦截非法跳转、循环、超限、超时与过大响应', async () => {
    const env = {
      ALLOWED_SUBSCRIPTION_HOSTS: 'sub.example.invalid,cdn.example.invalid',
      FETCH_TIMEOUT_MS: '5000',
      MAX_RESPONSE_BYTES: '128',
      MAX_REDIRECTS: '5',
    }

    const okResult = await fetchSubscriptionContent(
      'https://sub.example.invalid/start?token=REDACTED',
      env,
      async (url) => {
        if (url === 'https://sub.example.invalid/start?token=REDACTED') {
          return new Response(null, {
            status: 302,
            headers: { location: '/relative/step2' },
          })
        }
        if (url === 'https://sub.example.invalid/relative/step2') {
          return new Response(null, {
            status: 307,
            headers: { location: 'https://cdn.example.invalid/final.yaml' },
          })
        }
        return new Response('proxies:\n  - name: ok\n', { status: 200 })
      },
    )
    expect(okResult).toContain('proxies:')

    await expect(
      fetchSubscriptionContent('https://sub.example.invalid/start', env, async () =>
        new Response(null, { status: 302, headers: { location: 'https://evil.example.invalid/x' } }),
      ),
    ).rejects.toMatchObject({ statusCode: 403, message: 'host_not_allowed' })

    await expect(
      fetchSubscriptionContent('https://sub.example.invalid/start', env, async () =>
        new Response(null, { status: 302, headers: { location: 'https://[::ffff:127.0.0.1]/x' } }),
      ),
    ).rejects.toMatchObject({ statusCode: 403, message: 'blocked_host' })

    await expect(
      fetchSubscriptionContent('https://sub.example.invalid/a', env, async (url) =>
        new Response(null, {
          status: 302,
          headers: { location: url.endsWith('/a') ? '/b' : '/a' },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 502, message: 'redirect_loop' })

    let hops = 0
    await expect(
      fetchSubscriptionContent('https://sub.example.invalid/0', env, async () => {
        hops += 1
        return new Response(null, { status: 302, headers: { location: `/${hops}` } })
      }),
    ).rejects.toMatchObject({ statusCode: 502, message: 'too_many_redirects' })

    let cancelledOnOversize = false
    const bigStream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(80).fill(65))
      },
      cancel() {
        cancelledOnOversize = true
      },
    })
    await expect(
      fetchSubscriptionContent(
        'https://sub.example.invalid/big',
        env,
        async () => new Response(bigStream, { status: 200 }),
      ),
    ).rejects.toMatchObject({ statusCode: 413, message: 'upstream_response_too_large' })
    expect(cancelledOnOversize).toBe(true)

    await expect(
      fetchSubscriptionContent(
        'https://sub.example.invalid/slow',
        { ...env, FETCH_TIMEOUT_MS: '60' },
        async (_url, init) =>
          new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => {
              const err = new Error('aborted')
              err.name = 'AbortError'
              reject(err)
            })
          }),
      ),
    ).rejects.toMatchObject({ statusCode: 504, message: 'upstream_timeout' })
  })
})

describe('Cloudflare App Worker DO storage, healthz and bindings (B04 / B05 / T09 / T10 / T11)', () => {
  it('两个独立边缘处理实例通过同一 Durable Object 权威存储立即读写、处理 HEAD、并发读与绝对过期', async () => {
    const { appSource, fetcherSource, fetcherCoreSource, guardSource } = loadWorkerSources()
    const { appModules, fetcherModules } = createWorkerModules(appSource, fetcherSource, fetcherCoreSource, guardSource)

    const mf = new Miniflare({
      workers: [
        {
          name: 'edge-a',
          compatibilityDate: '2026-06-21',
          modulesRoot: '.',
          modules: appModules,
          bindings: { CLASH_IMPORT_TTL_SECONDS: '0.2' },
          durableObjects: {
            CLASH_CONFIG_STORE: {
              className: 'TemporaryClashConfigStore',
              scriptName: 'do-store',
              useSQLite: true,
            },
          },
          serviceBindings: {
            SUBSCRIPTION_FETCHER: 'fetcher',
            ASSETS: () => new Response('<html>SPA</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
          },
        },
        {
          name: 'edge-b',
          compatibilityDate: '2026-06-21',
          modulesRoot: '.',
          modules: appModules,
          bindings: { CLASH_IMPORT_TTL_SECONDS: '0.2' },
          durableObjects: {
            CLASH_CONFIG_STORE: {
              className: 'TemporaryClashConfigStore',
              scriptName: 'do-store',
              useSQLite: true,
            },
          },
          serviceBindings: {
            SUBSCRIPTION_FETCHER: 'fetcher',
            ASSETS: () => new Response('<html>SPA</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
          },
        },
        {
          name: 'do-store',
          compatibilityDate: '2026-06-21',
          modulesRoot: '.',
          modules: appModules,
          durableObjects: {
            CLASH_CONFIG_STORE: {
              className: 'TemporaryClashConfigStore',
              useSQLite: true,
            },
          },
        },
        {
          name: 'fetcher',
          compatibilityDate: '2026-06-21',
          modulesRoot: '.',
          modules: fetcherModules,
          bindings: {
            FETCH_TOKEN: 'REDACTED_INTERNAL_TOKEN',
            ALLOWED_SUBSCRIPTION_HOSTS: 'sub.example.invalid',
            FETCH_TIMEOUT_MS: '5000',
            MAX_RESPONSE_BYTES: '2097152',
            MAX_REDIRECTS: '5',
          },
        },
      ],
    })
    mfInstances.push(mf)

    const edgeA = await mf.getWorker('edge-a')
    const edgeB = await mf.getWorker('edge-b')

    const healthRes = await edgeA.fetch('https://edge-a.example.invalid/api/healthz')
    expect(healthRes.status).toBe(200)
    expect(await healthRes.json()).toEqual({
      ok: true,
      mode: 'worker-app',
      apiVersion: 1,
      capabilities: {
        fetchSubscription: true,
        temporaryClashConfig: true,
      },
    })

    const unknownApiRes = await edgeA.fetch('https://edge-a.example.invalid/api/does-not-exist')
    expect(unknownApiRes.status).toBe(404)
    expect(unknownApiRes.headers.get('content-type')).toContain('application/json')

    // 由边缘实例 A 创建
    const createRes = await edgeA.fetch('https://edge-a.example.invalid/api/clash-config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: VALID_CLASH_YAML }),
    })
    expect(createRes.status).toBe(200)
    const created = await createRes.json()
    expect(created.url).toMatch(/^\/api\/clash-config\/[a-zA-Z0-9_-]{32}$/)
    expect(created.storage).toBe('durable-object-sqlite')

    // 立即从独立边缘实例 B 并发读取与 HEAD
    const [readB1, readB2, headB] = await Promise.all([
      edgeB.fetch(`https://edge-b.example.invalid${created.url}`),
      edgeB.fetch(`https://edge-b.example.invalid${created.url}`),
      edgeB.fetch(`https://edge-b.example.invalid${created.url}`, { method: 'HEAD' }),
    ])

    expect(readB1.status).toBe(200)
    expect(readB1.headers.get('content-type')).toBe('text/yaml; charset=utf-8')
    expect(readB1.headers.get('cache-control')).toBe('no-store')
    expect(await readB1.text()).toBe(VALID_CLASH_YAML)
    expect(readB2.status).toBe(200)

    expect(headB.status).toBe(200)
    expect(headB.headers.get('content-type')).toBe('text/yaml; charset=utf-8')
    expect(headB.headers.get('cache-control')).toBe('no-store')
    expect(await headB.text()).toBe('')

    // 接近过期前再次读取（不得触发滑动续期）
    await new Promise((resolve) => setTimeout(resolve, 110))
    const midRead = await edgeA.fetch(`https://edge-a.example.invalid${created.url}`)
    expect(midRead.status).toBe(200)

    // 再等待 120ms（累计超过 200ms TTL，但距上次读取不足 200ms），确认绝对过期生效
    await new Promise((resolve) => setTimeout(resolve, 120))

    const [expiredGet, expiredHead] = await Promise.all([
      edgeB.fetch(`https://edge-b.example.invalid${created.url}`),
      edgeA.fetch(`https://edge-a.example.invalid${created.url}`, { method: 'HEAD' }),
    ])
    expect(expiredGet.status).toBe(404)
    expect(expiredHead.status).toBe(404)
    expect(await expiredHead.text()).toBe('')

    // 验证 Service Binding 错误映射（非白名单域名 -> 403，非法 URL -> 400）
    const disallowedFetch = await edgeA.fetch('https://edge-a.example.invalid/api/fetch-subscription', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://forbidden.example.invalid/sub' }),
    })
    expect(disallowedFetch.status).toBe(403)
    expect(await disallowedFetch.json()).toEqual({ error: 'host_not_allowed' })

    const invalidFetch = await edgeA.fetch('https://edge-a.example.invalid/api/fetch-subscription', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'ftp://sub.example.invalid/sub' }),
    })
    expect(invalidFetch.status).toBe(400)
    expect(await invalidFetch.json()).toEqual({ error: 'unsupported_protocol' })
  })

  it('校验流式 2 MiB 上限（不依赖 Content-Length）、格式错误 400、缺失绑定 503 与存储故障 503', async () => {
    const { appSource, fetcherSource, fetcherCoreSource, guardSource } = loadWorkerSources()
    const { appModules } = createWorkerModules(appSource, fetcherSource, fetcherCoreSource, guardSource)

    // 1. 缺失绑定的 Worker
    const mfMissing = new Miniflare({
      workers: [
        {
          name: 'app-missing-bindings',
          compatibilityDate: '2026-06-21',
          modulesRoot: '.',
          modules: appModules,
          serviceBindings: {
            ASSETS: () => new Response('<html>SPA</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
          },
        },
      ],
    })
    mfInstances.push(mfMissing)
    const missingWorker = await mfMissing.getWorker('app-missing-bindings')

    const missingHealth = await missingWorker.fetch('https://app.example.invalid/api/healthz')
    expect(missingHealth.status).toBe(200)
    expect(await missingHealth.json()).toEqual({
      ok: true,
      mode: 'worker-app',
      apiVersion: 1,
      capabilities: {
        fetchSubscription: false,
        temporaryClashConfig: false,
      },
    })

    const missingStorePost = await missingWorker.fetch('https://app.example.invalid/api/clash-config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: VALID_CLASH_YAML }),
    })
    expect(missingStorePost.status).toBe(503)

    const missingFetchPost = await missingWorker.fetch('https://app.example.invalid/api/fetch-subscription', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://sub.example.invalid/sub' }),
    })
    expect(missingFetchPost.status).toBe(503)

    // 2. 流式超限（无 Content-Length 的 chunked 流）、格式错误、以及 DO 抛出异常返回 503
    const brokenStoreScript = `
      import { DurableObject } from 'cloudflare:workers';
      export class TemporaryClashConfigStore extends DurableObject {
        async putConfig() { throw new Error('sqlite_io_error'); }
        async getConfig() { throw new Error('sqlite_io_error'); }
      }
      export default { fetch() { return new Response('ok'); } };
    `
    const mfBrokenStore = new Miniflare({
      workers: [
        {
          name: 'app-with-store',
          compatibilityDate: '2026-06-21',
          modulesRoot: '.',
          modules: appModules,
          durableObjects: {
            CLASH_CONFIG_STORE: {
              className: 'TemporaryClashConfigStore',
              scriptName: 'broken-do',
              useSQLite: true,
            },
          },
        },
        {
          name: 'broken-do',
          compatibilityDate: '2026-06-21',
          modules: true,
          script: brokenStoreScript,
          durableObjects: {
            CLASH_CONFIG_STORE: { className: 'TemporaryClashConfigStore', useSQLite: true },
          },
        },
      ],
    })
    mfInstances.push(mfBrokenStore)
    const worker = await mfBrokenStore.getWorker('app-with-store')

    // 伪造无 Content-Length 的 2 MiB+ 流式请求体
    const hugeStream = new ReadableStream({
      start(controller) {
        const chunk = new Uint8Array(512 * 1024).fill(65)
        for (let i = 0; i < 5; i += 1) {
          controller.enqueue(chunk)
        }
        controller.close()
      },
    })
    const oversizeRes = await worker.fetch('https://app.example.invalid/api/clash-config', {
      method: 'POST',
      duplex: 'half',
      headers: { 'content-type': 'application/json' },
      body: hugeStream,
    })
    expect(oversizeRes.status).toBe(413)

    const badFormatRes = await worker.fetch('https://app.example.invalid/api/clash-config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'not valid clash yaml' }),
    })
    expect(badFormatRes.status).toBe(400)

    const storageErrorPost = await worker.fetch('https://app.example.invalid/api/clash-config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: VALID_CLASH_YAML }),
    })
    expect(storageErrorPost.status).toBe(503)

    const validId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const storageErrorGet = await worker.fetch(`https://app.example.invalid/api/clash-config/${validId}`)
    expect(storageErrorGet.status).toBe(503)
  })
})
