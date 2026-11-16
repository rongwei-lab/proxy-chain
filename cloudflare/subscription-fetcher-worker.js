import { WorkerEntrypoint } from 'cloudflare:workers'
import { parseOriginList } from '../shared/ssrf-guard.mjs'
import { fetchSubscriptionContent } from './subscription-fetcher-core.js'

/**
 * Cloudflare Worker 订阅拉取实现。
 *
 * 运行时限制说明：
 * 标准 Workers fetch() 由 Cloudflare 边缘网络栈执行 DNS 解析与建连，无法像 Node.js 那样
 * 在应用层将单次 DNS 查询结果固定到 TCP/TLS socket（无底层 socket lookup 钩子）。
 * 本 Worker 在能力边界内严格执行：每跳协议校验、ALLOWED_SUBSCRIPTION_HOSTS 白名单校验、
 * IPv4/IPv6/IPv4-mapped 字面量拦截、手动重定向（上限 MAX_REDIRECTS）、全链路总超时与响应体大小上限，
 * 且绝不向上游转发服务访问令牌或泄露完整订阅 URL。
 */
export default class SubscriptionFetcherWorker extends WorkerEntrypoint {
  async fetchSubscription(url) {
    return fetchSubscriptionContent(url, this.env)
  }

  async fetch(request) {
    const env = this.env
    const origin = request.headers.get('origin')
    const corsHeaders = buildCorsHeaders(origin, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    const url = new URL(request.url)
    if (url.pathname === '/healthz' && request.method === 'GET') {
      return jsonResponse({ ok: true, mode: 'worker-fetcher' }, 200, corsHeaders)
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

    let body
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: 'invalid_json_body' }, 400, corsHeaders)
    }

    try {
      const content = await fetchSubscriptionContent(body?.url, env)

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
        { error: sanitizeWorkerErrorMessage(error) },
        error?.statusCode || 500,
        corsHeaders,
      )
    }
  }
}

function buildCorsHeaders(origin, env) {
  const headers = {
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
  }

  if (isOriginAllowed(origin, env) && origin) {
    headers['access-control-allow-origin'] = origin
    headers.vary = 'Origin'
  }

  return headers
}

function isOriginAllowed(origin, env) {
  if (!origin) {
    return false
  }

  return parseOriginList(env.ALLOWED_ORIGINS).has(origin)
}

function sanitizeWorkerErrorMessage(error) {
  if (error?.statusCode && typeof error?.message === 'string') {
    return error.message
  }
  return 'fetch_failed'
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
