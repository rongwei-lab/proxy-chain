const INTERNAL_FETCHER_ERROR_STATUS = {
  invalid_url: 400,
  unsupported_protocol: 400,
  host_not_allowed: 403,
  blocked_host: 403,
  upstream_response_too_large: 413,
}
const MAX_INLINE_CONFIG_BYTES = 2 * 1024 * 1024
const CLASH_IMPORT_TTL_SECONDS = 600

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/healthz' && request.method === 'GET') {
      return jsonResponse({ ok: true, mode: 'worker-app' }, 200)
    }

    if (url.pathname === '/api/fetch-subscription') {
      return handleFetchSubscription(request, env)
    }

    if (url.pathname === '/api/clash-config' || url.pathname.startsWith('/api/clash-config/')) {
      return handleClashConfig(request)
    }

    return env.ASSETS.fetch(normalizeAssetRequest(request))
  },
}

function normalizeAssetRequest(request) {
  const url = new URL(request.url)

  // GitHub Pages 的线上路径是 /proxy-chain/。公开 Worker 通常部署在根路径，
  // 但保留这个前缀兼容可以避免用户从旧链接迁移时遇到白屏或静态资源 404。
  if (url.pathname === '/proxy-chain' || url.pathname.startsWith('/proxy-chain/')) {
    url.pathname = url.pathname.slice('/proxy-chain'.length) || '/'
    return new Request(url, request)
  }

  return request
}

async function handleFetchSubscription(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  if (!env.SUBSCRIPTION_FETCHER?.fetchSubscription) {
    return jsonResponse({ error: 'fetcher_binding_missing' }, 500)
  }

  try {
    const body = await request.json()
    const content = await env.SUBSCRIPTION_FETCHER.fetchSubscription(body?.url)

    return jsonResponse(
      {
        content,
        contentType: 'text/plain; charset=utf-8',
      },
      200,
    )
  } catch (error) {
    const message = error?.message || 'fetch_failed'
    return jsonResponse({ error: message }, INTERNAL_FETCHER_ERROR_STATUS[message] || 500)
  }
}

async function handleClashConfig(request) {
  if (request.method === 'POST') {
    return createTemporaryClashConfig(request)
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    return readTemporaryClashConfig(request)
  }

  return jsonResponse({ error: 'method_not_allowed' }, 405)
}

async function createTemporaryClashConfig(request) {
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > MAX_INLINE_CONFIG_BYTES) {
    return jsonResponse({ error: 'config_too_large' }, 413)
  }

  try {
    const payload = await request.json()
    const configText = typeof payload?.content === 'string' ? payload.content : ''
    const configBytes = new TextEncoder().encode(configText)

    if (configBytes.byteLength > MAX_INLINE_CONFIG_BYTES || !looksLikeClashConfig(configText)) {
      return jsonResponse({ error: 'invalid_config' }, 400)
    }

    const id = createConfigId()
    const configPath = `/api/clash-config/${id}`
    const configUrl = `${getRequestOrigin(request)}${configPath}`
    const configResponse = new Response(configText, {
      headers: {
        'content-type': 'text/yaml; charset=utf-8',
        'content-disposition': 'inline; filename="proxy-chain.yaml"',
        'cache-control': `public, max-age=${CLASH_IMPORT_TTL_SECONDS}`,
        'x-content-type-options': 'nosniff',
      },
    })

    await caches.default.put(new Request(configUrl), configResponse)

    return jsonResponse(
      {
        url: configPath,
        expiresInSeconds: CLASH_IMPORT_TTL_SECONDS,
      },
      200,
    )
  } catch {
    return jsonResponse({ error: 'invalid_config' }, 400)
  }
}

async function readTemporaryClashConfig(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return jsonResponse({ error: 'method_not_allowed' }, 405)
  }

  const url = new URL(request.url)
  const id = url.pathname.slice('/api/clash-config/'.length)
  if (!/^[a-zA-Z0-9_-]{32}$/.test(id)) {
    return jsonResponse({ error: 'not_found' }, 404)
  }

  const cacheRequest = new Request(`${url.origin}/api/clash-config/${id}`)
  const cached = await caches.default.match(cacheRequest)
  if (!cached) {
    return jsonResponse({ error: 'not_found' }, 404)
  }

  return request.method === 'HEAD'
    ? new Response(null, { headers: cached.headers })
    : cached
}

function createConfigId() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function getRequestOrigin(request) {
  const url = new URL(request.url)
  const host = request.headers.get('host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const protocol = forwardedProto ? `${forwardedProto}:` : url.protocol

  return host ? `${protocol}//${host}` : url.origin
}

function looksLikeClashConfig(configText) {
  return (
    configText.includes('proxies:') &&
    configText.includes('proxy-groups:') &&
    configText.includes('rules:')
  )
}

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
