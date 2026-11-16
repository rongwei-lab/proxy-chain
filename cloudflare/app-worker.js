import { DurableObject } from 'cloudflare:workers'
import { createHttpError } from '../shared/ssrf-guard.mjs'

const INTERNAL_FETCHER_ERROR_STATUS = {
  invalid_url: 400,
  unsupported_protocol: 400,
  host_not_allowed: 403,
  blocked_host: 403,
  upstream_response_too_large: 413,
  invalid_redirect_location: 502,
  redirect_loop: 502,
  too_many_redirects: 502,
  empty_upstream_body: 502,
  dns_lookup_failed: 502,
  upstream_connection_failed: 502,
  upstream_read_failed: 502,
  upstream_timeout: 504,
}
const MAX_INLINE_CONFIG_BYTES = 2 * 1024 * 1024
const DEFAULT_CLASH_IMPORT_TTL_SECONDS = 600
const API_VERSION = 1

/**
 * 临时 Clash 配置的全局权威存储（SQLite-backed Durable Object）。
 * 按 192 bit 随机配置 ID 路由到唯一对象，避免 Cloudflare Cache API 单机房不跨区的问题。
 */
export class TemporaryClashConfigStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.schemaInitialized = false
    this.ensureSchema()
  }

  ensureSchema() {
    if (this.schemaInitialized) {
      return
    }
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS temporary_configs (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `)
    this.schemaInitialized = true
  }

  async clearAllStorage() {
    await this.ctx.blockConcurrencyWhile(async () => {
      this.schemaInitialized = false
      await this.ctx.storage.deleteAll()
    })
  }

  async putConfig(id, content, ttlMs = DEFAULT_CLASH_IMPORT_TTL_SECONDS * 1000) {
    this.ensureSchema()
    const now = Date.now()
    const expiresAt = now + ttlMs
    this.ctx.storage.sql.exec(
      `INSERT OR REPLACE INTO temporary_configs (id, content, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
      id,
      content,
      now,
      expiresAt,
    )
    await this.ctx.storage.setAlarm(expiresAt)
    return {
      createdAt: now,
      expiresAt,
    }
  }

  async getConfig(id) {
    this.ensureSchema()
    const rows = this.ctx.storage.sql
      .exec('SELECT content, created_at, expires_at FROM temporary_configs WHERE id = ?', id)
      .toArray()

    if (rows.length === 0) {
      return null
    }

    const row = rows[0]
    const now = Date.now()
    const expiresAt = Number(row.expires_at)

    // 严格校验绝对过期时间，读取绝不续期；到期后立即清理访问记录。
    if (now >= expiresAt) {
      await this.clearAllStorage()
      return null
    }

    return {
      content: String(row.content),
      createdAt: Number(row.created_at),
      expiresAt,
    }
  }

  async alarm() {
    this.ensureSchema()
    const now = Date.now()
    const rows = this.ctx.storage.sql
      .exec('SELECT MAX(expires_at) AS max_expires_at FROM temporary_configs')
      .toArray()
    const maxExpiresAt = rows[0]?.max_expires_at

    if (maxExpiresAt === null || maxExpiresAt === undefined || now >= Number(maxExpiresAt)) {
      await this.clearAllStorage()
      return
    }

    await this.ctx.storage.setAlarm(Number(maxExpiresAt))
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const apiPathname = normalizeApiPathname(url.pathname)

    if (apiPathname === '/api/healthz') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return jsonResponse({ error: 'method_not_allowed' }, 405, request.method)
      }
      return jsonResponse(buildHealthPayload(env), 200, request.method)
    }

    if (apiPathname === '/api/fetch-subscription') {
      return handleFetchSubscription(request, env)
    }

    if (apiPathname === '/api/clash-config' || apiPathname.startsWith('/api/clash-config/')) {
      return handleClashConfig(request, env, apiPathname)
    }

    if (apiPathname === '/api' || apiPathname.startsWith('/api/')) {
      return jsonResponse({ error: 'not_found' }, 404, request.method)
    }

    return env.ASSETS.fetch(normalizeAssetRequest(request))
  },
}

function buildHealthPayload(env) {
  return {
    ok: true,
    mode: 'worker-app',
    apiVersion: API_VERSION,
    capabilities: {
      fetchSubscription: Boolean(env.SUBSCRIPTION_FETCHER?.fetchSubscription),
      temporaryClashConfig: Boolean(env.CLASH_CONFIG_STORE?.idFromName),
    },
  }
}

function normalizeApiPathname(pathname) {
  if (pathname === '/proxy-chain/api' || pathname.startsWith('/proxy-chain/api/')) {
    return pathname.slice('/proxy-chain'.length)
  }
  return pathname
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
    return jsonResponse({ error: 'method_not_allowed' }, 405, request.method)
  }

  if (!env.SUBSCRIPTION_FETCHER?.fetchSubscription) {
    return jsonResponse({ error: 'fetcher_binding_missing' }, 503)
  }

  let body
  try {
    body = await readJsonWithByteLimit(request, 8192)
  } catch (error) {
    return jsonResponse({ error: error?.message || 'invalid_json_body' }, error?.statusCode || 400)
  }

  try {
    const content = await env.SUBSCRIPTION_FETCHER.fetchSubscription(body?.url)

    return jsonResponse(
      {
        content,
        contentType: 'text/plain; charset=utf-8',
      },
      200,
    )
  } catch (error) {
    const message = typeof error?.message === 'string' ? error.message : 'fetch_failed'
    const status =
      INTERNAL_FETCHER_ERROR_STATUS[message] ??
      (message.startsWith('upstream_http_') ? 502 : 500)
    return jsonResponse({ error: message }, status)
  }
}

async function handleClashConfig(request, env, apiPathname) {
  if (request.method === 'POST' && apiPathname === '/api/clash-config') {
    return createTemporaryClashConfig(request, env)
  }

  if ((request.method === 'GET' || request.method === 'HEAD') && apiPathname.startsWith('/api/clash-config/')) {
    return readTemporaryClashConfig(request, env, apiPathname)
  }

  if (apiPathname === '/api/clash-config' || apiPathname.startsWith('/api/clash-config/')) {
    return jsonResponse({ error: 'method_not_allowed' }, 405, request.method)
  }

  return jsonResponse({ error: 'not_found' }, 404, request.method)
}

async function createTemporaryClashConfig(request, env) {
  if (!env.CLASH_CONFIG_STORE?.idFromName) {
    return jsonResponse({ error: 'temporary_config_store_unavailable' }, 503)
  }

  let payload
  try {
    payload = await readJsonWithByteLimit(request, MAX_INLINE_CONFIG_BYTES)
  } catch (error) {
    return jsonResponse({ error: error?.message || 'invalid_config' }, error?.statusCode || 400)
  }

  const configText = typeof payload?.content === 'string' ? payload.content : ''
  const configBytes = new TextEncoder().encode(configText)

  if (configBytes.byteLength > MAX_INLINE_CONFIG_BYTES) {
    return jsonResponse({ error: 'config_too_large' }, 413)
  }

  if (!looksLikeClashConfig(configText)) {
    return jsonResponse({ error: 'invalid_config' }, 400)
  }

  const ttlSeconds = parseTtlSeconds(env.CLASH_IMPORT_TTL_SECONDS)
  const ttlMs = Math.round(ttlSeconds * 1000)
  const id = createConfigId()
  const configPath = `/api/clash-config/${id}`

  try {
    const stub = env.CLASH_CONFIG_STORE.get(env.CLASH_CONFIG_STORE.idFromName(id))
    await stub.putConfig(id, configText, ttlMs)
  } catch {
    return jsonResponse({ error: 'temporary_config_store_error' }, 503)
  }

  return jsonResponse(
    {
      url: configPath,
      expiresInSeconds: ttlSeconds,
      storage: 'durable-object-sqlite',
    },
    200,
  )
}

async function readTemporaryClashConfig(request, env, apiPathname) {
  const id = apiPathname.slice('/api/clash-config/'.length)
  if (!/^[a-zA-Z0-9_-]{32}$/.test(id)) {
    return jsonResponse({ error: 'not_found' }, 404, request.method)
  }

  if (!env.CLASH_CONFIG_STORE?.idFromName) {
    return jsonResponse({ error: 'temporary_config_store_unavailable' }, 503, request.method)
  }

  let record
  try {
    const stub = env.CLASH_CONFIG_STORE.get(env.CLASH_CONFIG_STORE.idFromName(id))
    record = await stub.getConfig(id)
  } catch {
    return jsonResponse({ error: 'temporary_config_store_error' }, 503, request.method)
  }

  if (!record) {
    return jsonResponse({ error: 'not_found' }, 404, request.method)
  }

  const headers = {
    'content-type': 'text/yaml; charset=utf-8',
    'content-disposition': 'inline; filename="proxy-chain.yaml"',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  }

  return request.method === 'HEAD'
    ? new Response(null, { status: 200, headers })
    : new Response(record.content, { status: 200, headers })
}

async function readJsonWithByteLimit(request, maxBytes) {
  const rawContentLength = request.headers.get('content-length')
  if (rawContentLength !== null && rawContentLength !== '') {
    const parsedLength = Number(rawContentLength)
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      throw createHttpError(413, 'config_too_large')
    }
  }

  if (!request.body) {
    throw createHttpError(400, 'invalid_json_body')
  }

  const reader = request.body.getReader()
  const chunks = []
  let received = 0
  let completed = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        completed = true
        break
      }

      received += value.byteLength
      if (received > maxBytes) {
        throw createHttpError(413, 'config_too_large')
      }
      chunks.push(value)
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => {})
    }
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }

  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const text = new TextDecoder().decode(bytes)
    return JSON.parse(text)
  } catch {
    throw createHttpError(400, 'invalid_json_body')
  }
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

function parseTtlSeconds(rawValue) {
  const numeric = Number(rawValue)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_CLASH_IMPORT_TTL_SECONDS
  }
  return numeric
}

function looksLikeClashConfig(configText) {
  const text = configText.trim()
  if (!text || text.includes('\0') || text.startsWith('<') || text.startsWith('{')) {
    return false
  }

  return (
    /^proxies:\s*(?:#.*)?$/m.test(text) &&
    /^proxy-groups:\s*(?:#.*)?$/m.test(text) &&
    /^rules:\s*(?:#.*)?$/m.test(text) &&
    /^\s*-\s+/m.test(text)
  )
}

function jsonResponse(payload, status, method = 'GET') {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  }

  if (method === 'HEAD') {
    return new Response(null, { status, headers })
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers,
  })
}
