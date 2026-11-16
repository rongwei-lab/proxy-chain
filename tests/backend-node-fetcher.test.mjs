// @vitest-environment node
import http from 'node:http'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSubscriptionFetcherHandler,
  createSubscriptionFetcherServer,
  fetchSubscriptionWithRedirects,
  resolveAndValidateTarget,
} from '../server/subscription-fetcher.mjs'
import { isBlockedHostLiteral, isBlockedIpAddress } from '../shared/ssrf-guard.mjs'

const serversToClose = []

afterEach(async () => {
  vi.useRealTimers()
  while (serversToClose.length > 0) {
    const srv = serversToClose.pop()
    await new Promise((resolve) => srv.close(resolve))
  }
})

async function startLocalServer(handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  serversToClose.push(server)
  const address = server.address()
  return {
    server,
    port: address.port,
    origin: `http://127.0.0.1:${address.port}`,
  }
}

describe('SSRF guard IP/CIDR and redirect rules (B03 / T06 / T07)', () => {
  it('拦截完整 IPv4 回环、私网、CGNAT、链路本地与 IPv6 / IPv4 映射地址', () => {
    const blocked = [
      'localhost',
      'sub.localhost',
      '127.0.0.1',
      '127.0.0.2',
      '127.255.255.254',
      '0.0.0.0',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      '[::1]',
      '::',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      '[fe80::1%eth0]',
      '::ffff:127.0.0.1',
      '[::ffff:7f00:1]',
      '::ffff:169.254.169.254',
      'ff02::1',
    ]

    for (const candidate of blocked) {
      expect(isBlockedHostLiteral(candidate), candidate).toBe(true)
    }

    expect(isBlockedIpAddress('93.184.216.34')).toBe(false)
    expect(isBlockedIpAddress('2001:4860:4860::8888')).toBe(false)
    expect(isBlockedHostLiteral('allowed.example.invalid')).toBe(false)
  })
})

describe('Node subscription fetcher redirects, DNS pinning and resource limits (B03 / T06 / T07 / T08)', () => {
  it('允许白名单内绝对跳转与相对跳转，且不向上游转发服务访问令牌', async () => {
    const upstreamHeadersSeen = []
    const upstream = await startLocalServer((req, res) => {
      upstreamHeadersSeen.push({ url: req.url, auth: req.headers.authorization, host: req.headers.host })
      if (req.url === '/start?token=SECRET_SUB_TOKEN') {
        res.writeHead(302, { location: '/sub/step2' })
        res.end('redirecting')
        return
      }
      if (req.url === '/sub/step2') {
        res.writeHead(302, { location: 'final.yaml' })
        res.end('redirecting')
        return
      }
      if (req.url === '/sub/final.yaml') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('proxies:\n  - name: ok\n')
        return
      }
      res.writeHead(404)
      res.end('missing')
    })

    const fetcherPortServer = createSubscriptionFetcherServer(
      {
        fetchToken: 'REDACTED_SERVICE_TOKEN',
        allowedOrigins: new Set(['https://app.example.invalid']),
        allowedHosts: new Set(['sub.example.invalid', 'cdn.example.invalid']),
        timeoutMs: 5000,
        maxBytes: 1024 * 1024,
        maxRedirects: 5,
        allowPrivateHosts: false,
      },
      {
        lookup: async (hostname) => {
          expect(['sub.example.invalid', 'cdn.example.invalid']).toContain(hostname)
          return [{ address: '93.184.216.34', family: 4 }]
        },
        httpRequest: (options, callback) => {
          // 断言已绑定了固定 IP lookup，且保留真实 Host 头
          let pinned = null
          options.lookup(options.hostname, { all: false }, (_err, addr) => {
            pinned = addr
          })
          expect(pinned).toBe('93.184.216.34')
          return http.request(
            {
              hostname: '127.0.0.1',
              port: upstream.port,
              path: options.path,
              method: options.method,
              headers: options.headers,
              signal: options.signal,
            },
            callback,
          )
        },
      },
    )
    await new Promise((resolve) => fetcherPortServer.listen(0, '127.0.0.1', resolve))
    serversToClose.push(fetcherPortServer)
    const fetcherPort = fetcherPortServer.address().port

    const res = await fetch(`http://127.0.0.1:${fetcherPort}/fetch-subscription`, {
      method: 'POST',
      headers: {
        origin: 'https://app.example.invalid',
        authorization: 'Bearer REDACTED_SERVICE_TOKEN',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        url: `http://sub.example.invalid:${upstream.port}/start?token=SECRET_SUB_TOKEN`,
      }),
    })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.content).toContain('proxies:')
    expect(upstreamHeadersSeen).toHaveLength(3)
    for (const seen of upstreamHeadersSeen) {
      expect(seen.auth).toBeUndefined()
      expect(seen.host).toBe(`sub.example.invalid:${upstream.port}`)
    }
  })

  it('拒绝跳转到非白名单域名、内网地址、IPv6 与缺失 Location，且错误消息不泄露完整订阅 URL', async () => {
    const secretQueryUrl = 'http://sub.example.invalid:8080/sub?secret=REDACTED_USER_CREDENTIAL'

    const scenarios = [
      { location: 'http://evil.example.invalid/steal', expectedCode: 403, expectedErr: 'host_not_allowed' },
      { location: 'http://127.0.0.2/admin', expectedCode: 403, expectedErr: 'blocked_host' },
      { location: 'http://[::1]/admin', expectedCode: 403, expectedErr: 'blocked_host' },
      { location: '', expectedCode: 502, expectedErr: 'invalid_redirect_location' },
    ]

    for (const scenario of scenarios) {
      await expect(
        fetchSubscriptionWithRedirects(
          secretQueryUrl,
          {
            allowedHosts: new Set(['sub.example.invalid']),
            timeoutMs: 3000,
            maxBytes: 65536,
            maxRedirects: 5,
            allowPrivateHosts: false,
          },
          {
            lookup: async () => [{ address: '93.184.216.34', family: 4 }],
            httpRequest: (_options, cb) => {
              const req = new EventEmitter()
              req.end = () => {
                const res = new EventEmitter()
                res.statusCode = 302
                res.headers = scenario.location ? { location: scenario.location } : {}
                res.destroy = () => {}
                cb(res)
              }
              req.destroy = () => {}
              return req
            },
          },
        ),
      ).rejects.toSatisfy((err) => {
        expect(err.statusCode).toBe(scenario.expectedCode)
        expect(err.message).toBe(scenario.expectedErr)
        expect(err.message).not.toContain('REDACTED_USER_CREDENTIAL')
        return true
      })
    }
  })

  it('即使内网 IP 在白名单中，默认仍拦截私网、回环及 IPv6 映射地址', async () => {
    const blockedHosts = ['127.0.0.2', '10.0.0.8', '169.254.169.254', '[::1]', '[::ffff:127.0.0.1]', '[fe80::1]']
    for (const host of blockedHosts) {
      await expect(
        fetchSubscriptionWithRedirects(`http://${host}/sub`, {
          allowedHosts: new Set([host.replace(/^\[|\]$/g, '')]),
          timeoutMs: 2000,
          maxBytes: 1024,
          maxRedirects: 5,
          allowPrivateHosts: false,
        }),
      ).rejects.toMatchObject({ statusCode: 403, message: 'blocked_host' })
    }
  })

  it('DNS 返回内网或 IPv6 保留地址时在预检阶段阻断；仅查询一次 DNS 并把该 IP 固定到实际请求', async () => {
    await expect(
      resolveAndValidateTarget(
        new URL('https://sub.example.invalid/feed'),
        { allowPrivateHosts: false },
        async () => [{ address: '::ffff:127.0.0.1', family: 6 }],
      ),
    ).rejects.toMatchObject({ statusCode: 403, message: 'blocked_host' })

    let dnsCalls = 0
    const fakeLookup = async () => {
      dnsCalls += 1
      // 若第二跳重新查询会返回私网地址；固定连接后单跳绝不应再次触发 DNS 查询
      return dnsCalls === 1
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '127.0.0.1', family: 4 }]
    }

    let seenRequestOptions = null
    const content = await fetchSubscriptionWithRedirects(
      'https://sub.example.invalid/feed',
      {
        allowedHosts: new Set(['sub.example.invalid']),
        timeoutMs: 3000,
        maxBytes: 65536,
        maxRedirects: 5,
        allowPrivateHosts: false,
      },
      {
        lookup: fakeLookup,
        httpsRequest: (options, cb) => {
          seenRequestOptions = options
          const req = new EventEmitter()
          req.end = () => {
            const res = new PassThrough()
            res.statusCode = 200
            res.headers = {}
            cb(res)
            res.end('ok-https')
          }
          req.destroy = () => {}
          return req
        },
      },
    )

    expect(content).toBe('ok-https')
    expect(dnsCalls).toBe(1)
    expect(seenRequestOptions.servername).toBe('sub.example.invalid')
    expect(seenRequestOptions.headers.host).toBe('sub.example.invalid')
    expect(seenRequestOptions.rejectUnauthorized).not.toBe(false)

    const pinnedAddresses = await new Promise((resolve) => {
      seenRequestOptions.lookup('sub.example.invalid', { all: true }, (_err, list) => resolve(list))
    })
    expect(pinnedAddresses).toEqual([{ address: '93.184.216.34', family: 4 }])
    expect(dnsCalls).toBe(1)
  })

  it('拦截重定向循环与超过上限的重定向', async () => {
    await expect(
      fetchSubscriptionWithRedirects(
        'http://sub.example.invalid/a',
        {
          allowedHosts: new Set(['sub.example.invalid']),
          timeoutMs: 3000,
          maxBytes: 65536,
          maxRedirects: 5,
          allowPrivateHosts: false,
        },
        {
          lookup: async () => [{ address: '93.184.216.34', family: 4 }],
          httpRequest: (options, cb) => {
            const req = new EventEmitter()
            req.end = () => {
              const res = new EventEmitter()
              res.statusCode = 302
              res.headers = { location: options.path === '/a' ? '/b' : '/a' }
              res.destroy = () => {}
              cb(res)
            }
            req.destroy = () => {}
            return req
          },
        },
      ),
    ).rejects.toMatchObject({ statusCode: 502, message: 'redirect_loop' })

    let step = 0
    await expect(
      fetchSubscriptionWithRedirects(
        'http://sub.example.invalid/hop-0',
        {
          allowedHosts: new Set(['sub.example.invalid']),
          timeoutMs: 3000,
          maxBytes: 65536,
          maxRedirects: 5,
          allowPrivateHosts: false,
        },
        {
          lookup: async () => [{ address: '93.184.216.34', family: 4 }],
          httpRequest: (_options, cb) => {
            step += 1
            const req = new EventEmitter()
            req.end = () => {
              const res = new EventEmitter()
              res.statusCode = 302
              res.headers = { location: `/hop-${step}` }
              res.destroy = () => {}
              cb(res)
            }
            req.destroy = () => {}
            return req
          },
        },
      ),
    ).rejects.toMatchObject({ statusCode: 502, message: 'too_many_redirects' })
  })

  it('总超时覆盖多跳重定向与读取，超限立即销毁上游流并释放资源', async () => {
    const slowUpstream = await startLocalServer((req, res) => {
      if (req.url === '/slow-1') {
        setTimeout(() => {
          res.writeHead(302, { location: '/slow-2' })
          res.end()
        }, 60)
        return
      }
      setTimeout(() => {
        res.writeHead(200)
        res.end('too late')
      }, 100)
    })

    await expect(
      fetchSubscriptionWithRedirects(`http://127.0.0.1:${slowUpstream.port}/slow-1`, {
        allowedHosts: new Set(['127.0.0.1']),
        timeoutMs: 90,
        maxBytes: 65536,
        maxRedirects: 5,
        allowPrivateHosts: true,
      }),
    ).rejects.toMatchObject({ statusCode: 504, message: 'upstream_timeout' })

    let destroyedOnOversize = false
    await expect(
      fetchSubscriptionWithRedirects(
        'http://sub.example.invalid/large',
        {
          allowedHosts: new Set(['sub.example.invalid']),
          timeoutMs: 3000,
          maxBytes: 100,
          maxRedirects: 5,
          allowPrivateHosts: false,
        },
        {
          lookup: async () => [{ address: '93.184.216.34', family: 4 }],
          httpRequest: (_options, cb) => {
            const req = new EventEmitter()
            req.destroy = () => {
              destroyedOnOversize = true
            }
            req.end = () => {
              const res = new PassThrough()
              res.statusCode = 200
              res.headers = {}
              const origDestroy = res.destroy.bind(res)
              res.destroy = () => {
                destroyedOnOversize = true
                return origDestroy()
              }
              cb(res)
              res.write(Buffer.alloc(60, 'a'))
              res.write(Buffer.alloc(60, 'b'))
              res.end()
            }
            return req
          },
        },
      ),
    ).rejects.toMatchObject({ statusCode: 413, message: 'upstream_response_too_large' })

    expect(destroyedOnOversize).toBe(true)
  })
})

describe('R04: 总超时与外部取消完整覆盖 DNS 等待阶段', () => {
  it('R04-T01: DNS 永不返回时受总截止时间约束，返回 504 upstream_timeout 且不发起上游连接（含 HTTP 层映射）', async () => {
    vi.useFakeTimers()
    let httpCalls = 0

    const pending = fetchSubscriptionWithRedirects(
      'https://sub.example.invalid/never-dns',
      {
        allowedHosts: new Set(['sub.example.invalid']),
        timeoutMs: 20,
        maxBytes: 65536,
        maxRedirects: 5,
        allowPrivateHosts: false,
      },
      {
        lookup: () => new Promise(() => {}),
        httpRequest: () => {
          httpCalls += 1
          return new EventEmitter()
        },
        httpsRequest: () => {
          httpCalls += 1
          return new EventEmitter()
        },
      },
    )

    const assertion = expect(pending).rejects.toMatchObject({
      statusCode: 504,
      message: 'upstream_timeout',
    })
    await vi.advanceTimersByTimeAsync(25)
    await assertion
    expect(httpCalls).toBe(0)

    vi.useRealTimers()

    let serverHttpCalls = 0
    const fetcher = createSubscriptionFetcherServer(
      {
        fetchToken: 'dev-secret-token',
        allowedOrigins: new Set(),
        allowedHosts: new Set(['sub.example.invalid']),
        timeoutMs: 30,
        maxBytes: 65536,
        maxRedirects: 5,
        allowPrivateHosts: false,
      },
      {
        lookup: () => new Promise(() => {}),
        httpsRequest: () => {
          serverHttpCalls += 1
          return new EventEmitter()
        },
      },
    )
    await new Promise((resolve) => fetcher.listen(0, '127.0.0.1', resolve))
    serversToClose.push(fetcher)
    const { port } = fetcher.address()

    const res = await fetch(`http://127.0.0.1:${port}/fetch-subscription`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer dev-secret-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://sub.example.invalid/feed' }),
    })
    expect(res.status).toBe(504)
    expect(await res.json()).toEqual({ error: 'upstream_timeout' })
    expect(serverHttpCalls).toBe(0)
  })

  it('R04-T02: DNS 等待期间用户取消或客户端断开立即停止等待并结束，不继续写入响应', async () => {
    const externalAbort = new AbortController()
    let lookupStartedResolve
    const lookupStarted = new Promise((resolve) => {
      lookupStartedResolve = resolve
    })
    let httpCalls = 0

    const pending = fetchSubscriptionWithRedirects(
      'https://sub.example.invalid/abort-dns',
      {
        allowedHosts: new Set(['sub.example.invalid']),
        timeoutMs: 5000,
        maxBytes: 65536,
        maxRedirects: 5,
        allowPrivateHosts: false,
      },
      {
        signal: externalAbort.signal,
        lookup: () => {
          lookupStartedResolve()
          return new Promise(() => {})
        },
        httpsRequest: () => {
          httpCalls += 1
          return new EventEmitter()
        },
      },
    )

    await lookupStarted
    externalAbort.abort('user_cancelled')
    await expect(pending).rejects.toMatchObject({
      statusCode: 499,
      message: 'request_aborted',
    })
    expect(httpCalls).toBe(0)

    // HTTP 处理层：客户端在 DNS 等待期间断开，随后 DNS 才返回，不应写 200 或抛错
    let resolveLateDns
    let handlerLookupStartedResolve
    const handlerLookupStarted = new Promise((resolve) => {
      handlerLookupStartedResolve = resolve
    })
    const handler = createSubscriptionFetcherHandler(
      {
        fetchToken: 'tok',
        allowedOrigins: new Set(),
        allowedHosts: new Set(['sub.example.invalid']),
        timeoutMs: 5000,
        maxBytes: 65536,
        maxRedirects: 5,
        allowPrivateHosts: false,
      },
      {
        lookup: () => {
          handlerLookupStartedResolve()
          return new Promise((resolve) => {
            resolveLateDns = resolve
          })
        },
        httpsRequest: () => {
          httpCalls += 1
          return new EventEmitter()
        },
      },
    )

    const fakeReq = new EventEmitter()
    fakeReq.method = 'POST'
    fakeReq.url = '/fetch-subscription'
    fakeReq.headers = { authorization: 'Bearer tok' }

    const fakeRes = new EventEmitter()
    fakeRes.writableEnded = false
    fakeRes.destroyed = false
    let writtenStatus = null
    fakeRes.setHeader = () => {}
    fakeRes.writeHead = (status) => {
      writtenStatus = status
    }
    fakeRes.end = () => {
      fakeRes.writableEnded = true
    }

    const handlePromise = handler(fakeReq, fakeRes)
    fakeReq.emit('data', Buffer.from(JSON.stringify({ url: 'https://sub.example.invalid/sub' })))
    fakeReq.emit('end')

    await handlerLookupStarted
    fakeReq.emit('aborted')
    fakeRes.emit('close')
    await handlePromise

    resolveLateDns([{ address: '93.184.216.34', family: 4 }])
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(writtenStatus).toBeNull()
    expect(httpCalls).toBe(0)
  })

  it('R04-T03: 超时或取消后 DNS 迟到成功或迟到失败时，不建连、不改写结果、无 unhandledRejection', async () => {
    vi.useFakeTimers()
    const unhandled = []
    const onUnhandled = (reason) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    try {
      let resolveLateDns
      let httpCalls = 0
      const timeoutCase = fetchSubscriptionWithRedirects(
        'https://sub.example.invalid/late-resolve',
        {
          allowedHosts: new Set(['sub.example.invalid']),
          timeoutMs: 20,
          maxBytes: 65536,
          maxRedirects: 5,
          allowPrivateHosts: false,
        },
        {
          lookup: () =>
            new Promise((resolve) => {
              resolveLateDns = resolve
            }),
          httpsRequest: () => {
            httpCalls += 1
            return new EventEmitter()
          },
        },
      )
      const assertTimeout = expect(timeoutCase).rejects.toMatchObject({
        statusCode: 504,
        message: 'upstream_timeout',
      })
      await vi.advanceTimersByTimeAsync(25)
      await assertTimeout

      resolveLateDns([{ address: '93.184.216.34', family: 4 }])
      await vi.advanceTimersByTimeAsync(10)
      expect(httpCalls).toBe(0)

      let rejectLateDns
      const abortController = new AbortController()
      const abortCase = fetchSubscriptionWithRedirects(
        'https://sub.example.invalid/late-reject',
        {
          allowedHosts: new Set(['sub.example.invalid']),
          timeoutMs: 5000,
          maxBytes: 65536,
          maxRedirects: 5,
          allowPrivateHosts: false,
        },
        {
          signal: abortController.signal,
          lookup: () =>
            new Promise((_resolve, reject) => {
              rejectLateDns = reject
            }),
          httpsRequest: () => {
            httpCalls += 1
            return new EventEmitter()
          },
        },
      )
      await vi.advanceTimersByTimeAsync(0)
      abortController.abort('cancelled')
      await expect(abortCase).rejects.toMatchObject({
        statusCode: 499,
        message: 'request_aborted',
      })

      rejectLateDns(new Error('late ENOTFOUND'))
      await vi.advanceTimersByTimeAsync(10)
      expect(httpCalls).toBe(0)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('R04-T04: 多跳重定向共用唯一总预算，前一跳消耗预算后第二跳慢 DNS 不会重置超时', async () => {
    vi.useFakeTimers()
    let lookupIndex = 0
    let httpCalls = 0

    const pending = fetchSubscriptionWithRedirects(
      'http://sub.example.invalid/hop-1',
      {
        allowedHosts: new Set(['sub.example.invalid']),
        timeoutMs: 100,
        maxBytes: 65536,
        maxRedirects: 5,
        allowPrivateHosts: false,
      },
      {
        lookup: () => {
          lookupIndex += 1
          if (lookupIndex === 1) {
            return Promise.resolve([{ address: '93.184.216.34', family: 4 }])
          }
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve([{ address: '93.184.216.34', family: 4 }])
            }, 60)
          })
        },
        httpRequest: (_options, cb) => {
          httpCalls += 1
          const req = new EventEmitter()
          req.destroy = () => {}
          req.end = () => {
            setTimeout(() => {
              const res = new EventEmitter()
              res.statusCode = 302
              res.headers = { location: '/hop-2' }
              res.destroy = () => {}
              cb(res)
            }, 65)
          }
          return req
        },
      },
    )

    const assertion = expect(pending).rejects.toMatchObject({
      statusCode: 504,
      message: 'upstream_timeout',
    })
    // 第一跳在 65ms 后返回 302；第二跳 DNS 需 60ms（累计 125ms > 100ms 总预算）
    await vi.advanceTimersByTimeAsync(70)
    await vi.advanceTimersByTimeAsync(35)
    await assertion
    expect(httpCalls).toBe(1)
  })

  it('R04-T05: 正常 DNS、禁止地址拦截与 IP 固定 / TLS 校验在引入截止约束后保持有效', async () => {
    await expect(
      resolveAndValidateTarget(
        new URL('https://sub.example.invalid/blocked'),
        { allowPrivateHosts: false },
        async () => [{ address: '127.0.0.1', family: 4 }],
      ),
    ).rejects.toMatchObject({ statusCode: 403, message: 'blocked_host' })

    let seenReqOptions = null
    const okContent = await fetchSubscriptionWithRedirects(
      'https://sub.example.invalid/ok',
      {
        allowedHosts: new Set(['sub.example.invalid']),
        timeoutMs: 2000,
        maxBytes: 65536,
        maxRedirects: 5,
        allowPrivateHosts: false,
      },
      {
        lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        httpsRequest: (options, cb) => {
          seenReqOptions = options
          const req = new EventEmitter()
          req.destroy = () => {}
          req.end = () => {
            const res = new PassThrough()
            res.statusCode = 200
            res.headers = {}
            cb(res)
            res.end('ok-verified')
          }
          return req
        },
      },
    )

    expect(okContent).toBe('ok-verified')
    expect(seenReqOptions.servername).toBe('sub.example.invalid')
    expect(seenReqOptions.headers.host).toBe('sub.example.invalid')
    expect(seenReqOptions.rejectUnauthorized).not.toBe(false)
  })
})
