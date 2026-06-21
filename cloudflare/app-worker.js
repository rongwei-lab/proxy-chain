const INTERNAL_FETCHER_ERROR_STATUS = {
  invalid_url: 400,
  unsupported_protocol: 400,
  host_not_allowed: 403,
  blocked_host: 403,
  upstream_response_too_large: 413,
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/api/healthz' && request.method === 'GET') {
      return jsonResponse({ ok: true, mode: 'worker-app' }, 200)
    }

    if (url.pathname === '/api/fetch-subscription') {
      return handleFetchSubscription(request, env)
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

function jsonResponse(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
