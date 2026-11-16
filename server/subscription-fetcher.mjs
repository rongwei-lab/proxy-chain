import http from 'node:http'
import https from 'node:https'
import { lookup as defaultDnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createHttpError,
  isBlockedIpAddress,
  isRedirectStatus,
  normalizeHostname,
  parseHostOrOriginList,
  parseMaxRedirects,
  parseOriginList,
  resolveRedirectTarget,
  validateSubscriptionUrlFormat,
} from '../shared/ssrf-guard.mjs'

const DEFAULT_PORT = 8787
const DEFAULT_TIMEOUT_MS = 12000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 5
const MAX_JSON_BODY_BYTES = 4096

export function loadFetcherConfigFromEnv(env = process.env) {
  return {
    port: Number(env.PORT ?? DEFAULT_PORT),
    fetchToken: env.FETCH_TOKEN || '',
    allowedOrigins: parseOriginList(env.ALLOWED_ORIGINS),
    allowedHosts: parseHostOrOriginList(env.ALLOWED_SUBSCRIPTION_HOSTS),
    timeoutMs: parsePositiveInt(env.FETCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    maxBytes: parsePositiveInt(env.MAX_RESPONSE_BYTES, DEFAULT_MAX_BYTES),
    maxRedirects: parseMaxRedirects(env.MAX_REDIRECTS, DEFAULT_MAX_REDIRECTS),
    allowPrivateHosts: env.ALLOW_PRIVATE_SUBSCRIPTION_HOSTS === 'true',
  }
}

export function createSubscriptionFetcherHandler(config, deps = {}) {
  const lookupFn = deps.lookup ?? defaultDnsLookup
  const httpRequestFn = deps.httpRequest ?? http.request
  const httpsRequestFn = deps.httpsRequest ?? https.request
  const extraHttpsOptions = deps.httpsOptions ?? {}

  return async function handleRequest(request, response) {
    const origin = request.headers.origin
    setCorsHeaders(response, origin, config.allowedOrigins)

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    const requestPath = getRequestPath(request.url)

    if (requestPath === '/healthz' && request.method === 'GET') {
      writeJson(response, 200, { ok: true, mode: 'node-fetcher' })
      return
    }

    if (requestPath !== '/fetch-subscription' || request.method !== 'POST') {
      writeJson(response, 404, { error: 'not_found' })
      return
    }

    if (!isOriginAllowed(origin, config.allowedOrigins)) {
      writeJson(response, 403, { error: 'origin_not_allowed' })
      return
    }

    if (!config.fetchToken || request.headers.authorization !== `Bearer ${config.fetchToken}`) {
      writeJson(response, 401, { error: 'unauthorized' })
      return
    }

    const clientAbortController = new AbortController()
    let clientDisconnected = false
    const onRequestClose = () => {
      clientDisconnected = true
      if (!response.writableEnded) {
        clientAbortController.abort('client_disconnected')
      }
    }
    request.on('aborted', onRequestClose)
    response.on('close', onRequestClose)

    try {
      const body = await readJsonBody(request)
      const content = await fetchSubscriptionWithRedirects(body?.url, config, {
        lookup: lookupFn,
        httpRequest: httpRequestFn,
        httpsRequest: httpsRequestFn,
        httpsOptions: extraHttpsOptions,
        signal: clientAbortController.signal,
      })

      if (!clientDisconnected && !response.destroyed) {
        writeJson(response, 200, {
          content,
          contentType: 'text/plain; charset=utf-8',
        })
      }
    } catch (error) {
      // 客户端已断开时不再尝试写入任何响应。
      if (!response.writableEnded && !clientDisconnected && !response.destroyed) {
        const status = error?.statusCode ?? 500
        writeJson(response, status, { error: sanitizeErrorMessage(error) })
      }
    } finally {
      request.off('aborted', onRequestClose)
      response.off('close', onRequestClose)
    }
  }
}

export function createSubscriptionFetcherServer(config, deps = {}) {
  const handler = createSubscriptionFetcherHandler(config, deps)
  return http.createServer(handler)
}

/**
 * 解析域名（非字面 IP）并校验所有返回地址，返回固定给单跳 TCP 连接使用的地址列表。
 * 这样可确保预检与实际 TCP/TLS 连接绑定到同一已校验 IP，避免两次 DNS 解析之间的竞态。
 */
export async function resolveAndValidateTarget(url, config, lookupFn = defaultDnsLookup) {
  const normalizedHost = normalizeHostname(url.hostname)
  const ipFamily = isIP(normalizedHost)

  if (ipFamily !== 0) {
    if (!config.allowPrivateHosts && isBlockedIpAddress(normalizedHost)) {
      throw createHttpError(403, 'blocked_host')
    }
    return [{ address: normalizedHost, family: ipFamily }]
  }

  let records
  try {
    records = await lookupFn(normalizedHost, { all: true, verbatim: false })
  } catch {
    throw createHttpError(502, 'dns_lookup_failed')
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw createHttpError(502, 'dns_lookup_failed')
  }

  for (const record of records) {
    if (!record?.address || (!config.allowPrivateHosts && isBlockedIpAddress(record.address))) {
      throw createHttpError(403, 'blocked_host')
    }
  }

  return records.map((record) => ({
    address: record.address,
    family: record.family || (isIP(record.address) === 6 ? 6 : 4),
  }))
}

export async function fetchSubscriptionWithRedirects(rawUrl, config, deps = {}) {
  const lookupFn = deps.lookup ?? defaultDnsLookup
  const httpRequestFn = deps.httpRequest ?? http.request
  const httpsRequestFn = deps.httpsRequest ?? https.request
  const httpsOptions = deps.httpsOptions ?? {}

  let currentUrl = validateSubscriptionUrlFormat(rawUrl, {
    allowedHosts: config.allowedHosts,
    allowPrivateHosts: config.allowPrivateHosts,
  })

  const totalTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = config.maxRedirects ?? DEFAULT_MAX_REDIRECTS

  const controller = new AbortController()
  const deadline = Date.now() + totalTimeoutMs
  const visitedUrls = new Set([currentUrl.toString()])
  let redirectCount = 0

  const onExternalAbort = () => controller.abort(deps.signal?.reason ?? 'aborted')
  if (deps.signal) {
    if (deps.signal.aborted) {
      throw createHttpError(499, 'request_aborted')
    }
    deps.signal.addEventListener('abort', onExternalAbort, { once: true })
  }

  const timer = setTimeout(() => {
    controller.abort('timeout')
  }, totalTimeoutMs)

  try {
    while (true) {
      if (controller.signal.aborted || Date.now() >= deadline) {
        throw createHttpError(504, 'upstream_timeout')
      }

      const resolvedAddresses = await raceDnsAgainstAbort(
        resolveAndValidateTarget(currentUrl, config, lookupFn),
        controller.signal,
        deps.signal,
      )
      const { response, request } = await sendSingleHopRequest(currentUrl, resolvedAddresses, {
        signal: controller.signal,
        httpRequest: httpRequestFn,
        httpsRequest: httpsRequestFn,
        httpsOptions,
      })

      const statusCode = response.statusCode ?? 0
      if (isRedirectStatus(statusCode)) {
        const locationHeader = Array.isArray(response.headers.location)
          ? response.headers.location[0]
          : response.headers.location
        response.destroy()
        request.destroy()

        const next = resolveRedirectTarget({
          locationHeader,
          currentUrl,
          visitedUrls,
          redirectCount,
          maxRedirects,
          allowedHosts: config.allowedHosts,
          allowPrivateHosts: config.allowPrivateHosts,
        })
        currentUrl = next.nextUrl
        redirectCount = next.redirectCount
        continue
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.destroy()
        request.destroy()
        throw createHttpError(502, `upstream_http_${statusCode}`)
      }

      return await readUpstreamBodyWithLimit(response, request, maxBytes, controller.signal)
    }
  } finally {
    clearTimeout(timer)
    if (deps.signal) {
      deps.signal.removeEventListener('abort', onExternalAbort)
    }
  }
}

/**
 * DNS 等待 Promise 本身不接受取消信号；通过与总截止/外部取消控制的信号竞争，
 * 保证在超时或取消时立即停止等待并返回错误。注意这只是“停止等待”：
 * 底层系统 DNS 查询无法取消，其迟到结果由 Promise.race 已附加的处理器吸收，
 * 不会继续建连，也不会产生未处理的 rejection。
 */
async function raceDnsAgainstAbort(dnsPromise, signal, externalSignal) {
  if (signal.aborted) {
    dnsPromise.catch(() => {})
    throw abortErrorFrom(externalSignal)
  }

  let onAbort
  const stopWaiting = new Promise((resolve, reject) => {
    onAbort = () => reject(abortErrorFrom(externalSignal))
    signal.addEventListener('abort', onAbort, { once: true })
  })

  try {
    return await Promise.race([dnsPromise, stopWaiting])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

function abortErrorFrom(externalSignal) {
  if (externalSignal?.aborted) {
    return createHttpError(499, 'request_aborted')
  }
  return createHttpError(504, 'upstream_timeout')
}

function sendSingleHopRequest(
  targetUrl,
  resolvedAddresses,
  { signal, httpRequest, httpsRequest, httpsOptions },
) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(createHttpError(504, 'upstream_timeout'))
      return
    }

    const isHttps = targetUrl.protocol === 'https:'
    const requestFn = isHttps ? httpsRequest : httpRequest
    const normalizedHost = normalizeHostname(targetUrl.hostname)
    const primary = resolvedAddresses[0]

    // 通过自定义 lookup 将 TCP 连接固定到已校验 IP，同时保留原始 hostname 用于 Host 头、TLS SNI 与证书域名校验。
    const pinnedLookup = (_hostname, options, callback) => {
      if (typeof options === 'function') {
        options(null, primary.address, primary.family)
        return
      }
      if (options?.all) {
        callback(null, resolvedAddresses)
        return
      }
      callback(null, primary.address, primary.family)
    }

    const options = {
      protocol: targetUrl.protocol,
      hostname: normalizedHost,
      port: targetUrl.port ? Number(targetUrl.port) : isHttps ? 443 : 80,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: 'GET',
      lookup: pinnedLookup,
      signal,
      headers: {
        accept: 'text/plain, application/yaml, application/x-yaml, text/yaml, */*',
        host: targetUrl.host,
        'user-agent': 'proxy-chain-subscription-fetcher/1.0',
      },
      ...(isHttps ? { servername: normalizedHost, ...httpsOptions } : {}),
    }

    let settled = false
    const req = requestFn(options, (res) => {
      if (settled) {
        res.destroy()
        return
      }
      settled = true
      resolve({ response: res, request: req })
    })

    req.on('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      if (signal.aborted || error?.name === 'AbortError') {
        reject(createHttpError(504, 'upstream_timeout'))
        return
      }
      reject(createHttpError(502, 'upstream_connection_failed'))
    })

    req.end()
  })
}

function readUpstreamBodyWithLimit(response, request, maxBytes, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      response.destroy()
      request.destroy()
      reject(createHttpError(504, 'upstream_timeout'))
      return
    }

    const chunks = []
    let received = 0
    let finished = false

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort)
      response.off('data', onData)
      response.off('end', onEnd)
      response.off('error', onError)
      response.off('aborted', onResponseAborted)
    }

    const fail = (error) => {
      if (finished) {
        return
      }
      finished = true
      cleanup()
      response.destroy()
      request.destroy()
      reject(error)
    }

    const onAbort = () => {
      fail(createHttpError(504, 'upstream_timeout'))
    }

    const onResponseAborted = () => {
      fail(createHttpError(502, 'upstream_aborted'))
    }

    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      received += buffer.byteLength
      if (received > maxBytes) {
        fail(createHttpError(413, 'upstream_response_too_large'))
        return
      }
      chunks.push(buffer)
    }

    const onEnd = () => {
      if (finished) {
        return
      }
      finished = true
      cleanup()
      resolve(Buffer.concat(chunks, received).toString('utf8'))
    }

    const onError = (error) => {
      if (signal.aborted || error?.name === 'AbortError') {
        fail(createHttpError(504, 'upstream_timeout'))
        return
      }
      fail(createHttpError(502, 'upstream_read_failed'))
    }

    signal.addEventListener('abort', onAbort, { once: true })
    response.on('data', onData)
    response.on('end', onEnd)
    response.on('error', onError)
    response.on('aborted', onResponseAborted)
  })
}

function setCorsHeaders(response, origin, allowedOrigins) {
  if (isOriginAllowed(origin, allowedOrigins) && origin) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  }
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
  response.setHeader('Access-Control-Max-Age', '86400')
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) {
    return allowedOrigins.size === 0
  }
  return allowedOrigins.has(origin)
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let received = 0
    let done = false

    const cleanup = () => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
    }

    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      received += buffer.byteLength
      if (received > MAX_JSON_BODY_BYTES) {
        done = true
        cleanup()
        request.destroy()
        reject(createHttpError(413, 'request_body_too_large'))
        return
      }
      chunks.push(buffer)
    }

    const onEnd = () => {
      if (done) {
        return
      }
      done = true
      cleanup()
      try {
        const text = Buffer.concat(chunks, received).toString('utf8')
        resolve(JSON.parse(text || '{}'))
      } catch {
        reject(createHttpError(400, 'invalid_json_body'))
      }
    }

    const onError = (error) => {
      if (done) {
        return
      }
      done = true
      cleanup()
      reject(error)
    }

    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
  })
}

function getRequestPath(rawUrl) {
  try {
    return new URL(rawUrl || '/', 'http://localhost').pathname
  } catch {
    return rawUrl
  }
}

function parsePositiveInt(value, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback
  }
  return Math.floor(numeric)
}

function sanitizeErrorMessage(error) {
  if (error?.statusCode && typeof error?.message === 'string') {
    return error.message
  }
  return 'fetch_failed'
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

function isExecutedAsMainModule() {
  if (!process.argv[1]) {
    return false
  }
  return pathToFileURL(resolvePath(process.argv[1])).href === import.meta.url
}

if (isExecutedAsMainModule()) {
  const config = loadFetcherConfigFromEnv(process.env)
  if (!config.fetchToken) {
    console.error('FETCH_TOKEN is required. Refusing to start an open subscription fetcher.')
    process.exit(1)
  }

  const server = createSubscriptionFetcherServer(config)
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`subscription fetcher listening on :${config.port}`)
  })
}
