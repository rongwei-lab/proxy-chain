import http from 'node:http'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const port = Number(process.env.PORT ?? 8787)
const fetchToken = process.env.FETCH_TOKEN
const allowedOrigins = parseList(process.env.ALLOWED_ORIGINS)
const allowedHosts = parseList(process.env.ALLOWED_SUBSCRIPTION_HOSTS)
const timeoutMs = Number(process.env.FETCH_TIMEOUT_MS ?? 12000)
const maxBytes = Number(process.env.MAX_RESPONSE_BYTES ?? 2 * 1024 * 1024)
const allowPrivateHosts = process.env.ALLOW_PRIVATE_SUBSCRIPTION_HOSTS === 'true'

if (!fetchToken) {
  console.error('FETCH_TOKEN is required. Refusing to start an open subscription fetcher.')
  process.exit(1)
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin
  setCorsHeaders(response, origin)

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  if (request.url === '/healthz' && request.method === 'GET') {
    writeJson(response, 200, { ok: true })
    return
  }

  if (request.url !== '/fetch-subscription' || request.method !== 'POST') {
    writeJson(response, 404, { error: 'not_found' })
    return
  }

  if (!isOriginAllowed(origin)) {
    writeJson(response, 403, { error: 'origin_not_allowed' })
    return
  }

  if (request.headers.authorization !== `Bearer ${fetchToken}`) {
    writeJson(response, 401, { error: 'unauthorized' })
    return
  }

  try {
    const body = await readJsonBody(request)
    const url = await validateTargetUrl(body.url)
    const content = await fetchSubscription(url)

    writeJson(response, 200, {
      content,
      contentType: 'text/plain; charset=utf-8',
    })
  } catch (error) {
    const status = error.statusCode ?? 500
    writeJson(response, status, { error: error.message || 'fetch_failed' })
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`subscription fetcher listening on :${port}`)
})

function parseList(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

function setCorsHeaders(response, origin) {
  if (isOriginAllowed(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  }
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
  response.setHeader('Access-Control-Max-Age', '86400')
}

function isOriginAllowed(origin) {
  if (!origin) {
    return allowedOrigins.size === 0
  }
  return allowedOrigins.has(origin)
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''

    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 4096) {
        reject(httpError(413, 'request_body_too_large'))
        request.destroy()
      }
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        reject(httpError(400, 'invalid_json_body'))
      }
    })
    request.on('error', reject)
  })
}

async function validateTargetUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) {
    throw httpError(400, 'invalid_url')
  }

  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw httpError(400, 'invalid_url')
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw httpError(400, 'unsupported_protocol')
  }

  if (!allowedHosts.has(url.hostname)) {
    throw httpError(403, 'host_not_allowed')
  }

  if (!allowPrivateHosts && await isBlockedHost(url.hostname)) {
    throw httpError(403, 'blocked_host')
  }

  return url
}

async function isBlockedHost(hostname) {
  const normalized = hostname.toLowerCase()
  const ipType = isIP(normalized)

  if (ipType === 0) {
    if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
      return true
    }

    try {
      const addresses = await lookup(normalized, { all: true, verbatim: false })
      return addresses.some((address) => isBlockedIpAddress(address.address))
    } catch {
      throw httpError(502, 'dns_lookup_failed')
    }
  }

  return isBlockedIpAddress(normalized)
}

function isBlockedIpAddress(address) {
  if (address === '127.0.0.1' || address === '0.0.0.0' || address === '::1') {
    return true
  }

  return (
    address.startsWith('10.') ||
    address.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address) ||
    address.startsWith('169.254.') ||
    address.startsWith('fc') ||
    address.startsWith('fd') ||
    address.startsWith('fe80:')
  )
}

async function fetchSubscription(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const upstream = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/plain, application/yaml, application/x-yaml, text/yaml, */*',
        'user-agent': 'proxy-chain-subscription-fetcher/1.0',
      },
    })

    if (!upstream.ok) {
      throw httpError(502, `upstream_http_${upstream.status}`)
    }

    const reader = upstream.body?.getReader()
    if (!reader) {
      throw httpError(502, 'empty_upstream_body')
    }

    const chunks = []
    let received = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      received += value.byteLength
      if (received > maxBytes) {
        throw httpError(413, 'upstream_response_too_large')
      }
      chunks.push(value)
    }

    return new TextDecoder().decode(concatChunks(chunks, received))
  } finally {
    clearTimeout(timer)
  }
}

function concatChunks(chunks, totalLength) {
  const result = new Uint8Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }

  return result
}

function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}
