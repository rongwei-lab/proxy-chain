export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin')
    const corsHeaders = buildCorsHeaders(origin, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    const url = new URL(request.url)
    if (url.pathname === '/healthz' && request.method === 'GET') {
      return jsonResponse({ ok: true }, 200, corsHeaders)
    }

    if (url.pathname !== '/fetch-subscription' || request.method !== 'POST') {
      return jsonResponse({ error: 'not_found' }, 404, corsHeaders)
    }

    if (!isOriginAllowed(origin, env)) {
      return jsonResponse({ error: 'origin_not_allowed' }, 403, corsHeaders)
    }

    if (!env.FETCH_TOKEN || request.headers.get('authorization') !== `Bearer ${env.FETCH_TOKEN}`) {
      return jsonResponse({ error: 'unauthorized' }, 401, corsHeaders)
    }

    try {
      const body = await request.json()
      const targetUrl = validateTargetUrl(body.url, env)
      const content = await fetchSubscription(targetUrl, env)

      return jsonResponse(
        {
          content,
          contentType: 'text/plain; charset=utf-8',
        },
        200,
        corsHeaders,
      )
    } catch (error) {
      return jsonResponse(
        { error: error.message || 'fetch_failed' },
        error.statusCode || 500,
        corsHeaders,
      )
    }
  },
}

function buildCorsHeaders(origin, env) {
  const headers = {
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
  }

  if (isOriginAllowed(origin, env)) {
    headers['access-control-allow-origin'] = origin
    headers.vary = 'Origin'
  }

  return headers
}

function isOriginAllowed(origin, env) {
  if (!origin) {
    return false
  }

  return parseList(env.ALLOWED_ORIGINS).has(origin)
}

function validateTargetUrl(rawUrl, env) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) {
    throw httpError(400, 'invalid_url')
  }

  let targetUrl
  try {
    targetUrl = new URL(rawUrl)
  } catch {
    throw httpError(400, 'invalid_url')
  }

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    throw httpError(400, 'unsupported_protocol')
  }

  if (!parseList(env.ALLOWED_SUBSCRIPTION_HOSTS).has(targetUrl.hostname)) {
    throw httpError(403, 'host_not_allowed')
  }

  if (isBlockedHost(targetUrl.hostname)) {
    throw httpError(403, 'blocked_host')
  }

  return targetUrl
}

async function fetchSubscription(targetUrl, env) {
  const timeoutMs = Number(env.FETCH_TIMEOUT_MS || 12000)
  const maxBytes = Number(env.MAX_RESPONSE_BYTES || 2 * 1024 * 1024)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)

  try {
    const upstream = await fetch(targetUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        accept: 'text/plain, application/yaml, application/x-yaml, text/yaml, */*',
        'user-agent': 'proxy-chain-cloudflare-worker/1.0',
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

function parseList(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

function isBlockedHost(hostname) {
  const normalized = hostname.toLowerCase()

  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized) ||
    normalized.startsWith('169.254.')
  )
}

function httpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function jsonResponse(payload, status, corsHeaders) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
