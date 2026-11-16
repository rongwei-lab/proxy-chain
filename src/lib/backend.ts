export type FetchMode = 'auto' | 'hosted' | 'direct' | 'service'

export interface BackendCapabilities {
  status: 'checking' | 'available' | 'unavailable'
  fetchSubscription: boolean
  temporaryClashConfig: boolean
  mode?: string
  apiVersion?: number
}

const DEFAULT_HEALTHZ_TIMEOUT_MS = 5000

/**
 * 严格校验 /api/healthz 响应：
 * 拒绝 Vite SPA 回退返回的 HTML 200、非 JSON、超时或缺少身份字段的响应。
 */
export async function probeSameOriginCapabilities({
  fetchImpl = globalThis.fetch,
  signal,
  timeoutMs = DEFAULT_HEALTHZ_TIMEOUT_MS,
}: {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
} = {}): Promise<BackendCapabilities> {
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort()

  if (signal) {
    if (signal.aborted) {
      return {
        status: 'unavailable',
        fetchSubscription: false,
        temporaryClashConfig: false,
      }
    }
    signal.addEventListener('abort', onExternalAbort, { once: true })
  }

  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchImpl('/api/healthz', {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
      },
    })

    const contentType = response.headers.get('content-type') || ''
    if (!response.ok || !contentType.toLowerCase().includes('application/json')) {
      return {
        status: 'unavailable',
        fetchSubscription: false,
        temporaryClashConfig: false,
      }
    }

    const payload = (await response.json()) as unknown
    return parseHealthzPayload(payload)
  } catch {
    return {
      status: 'unavailable',
      fetchSubscription: false,
      temporaryClashConfig: false,
    }
  } finally {
    clearTimeout(timer)
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort)
    }
  }
}

export function parseHealthzPayload(payload: unknown): BackendCapabilities {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return {
      status: 'unavailable',
      fetchSubscription: false,
      temporaryClashConfig: false,
    }
  }

  const record = payload as Record<string, unknown>
  const capabilities =
    typeof record.capabilities === 'object' &&
    record.capabilities !== null &&
    !Array.isArray(record.capabilities)
      ? (record.capabilities as Record<string, unknown>)
      : null

  if (
    record.ok !== true ||
    record.mode !== 'worker-app' ||
    record.apiVersion !== 1 ||
    !capabilities
  ) {
    return {
      status: 'unavailable',
      fetchSubscription: false,
      temporaryClashConfig: false,
    }
  }

  const fetchSubscription = capabilities.fetchSubscription === true
  const temporaryClashConfig = capabilities.temporaryClashConfig === true

  return {
    status: fetchSubscription || temporaryClashConfig ? 'available' : 'unavailable',
    fetchSubscription,
    temporaryClashConfig,
    mode: 'worker-app',
    apiVersion: 1,
  }
}

export async function loadSubscriptionContent(
  sourceUrl: string,
  options: {
    endpoint: string
    sameOriginFetchAvailable: boolean
    token: string
    mode: FetchMode
    signal?: AbortSignal
    fetchImpl?: typeof fetch
  },
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch

  if (options.mode === 'hosted') {
    return fetchSameOriginSubscription(sourceUrl, fetchImpl, options.signal)
  }

  if (options.mode === 'service') {
    return fetchViaSubscriptionService(sourceUrl, options, fetchImpl)
  }

  if (options.mode === 'direct') {
    return fetchDirectSubscription(sourceUrl, fetchImpl, options.signal)
  }

  if (options.sameOriginFetchAvailable) {
    try {
      return await fetchSameOriginSubscription(sourceUrl, fetchImpl, options.signal)
    } catch (error) {
      if (options.signal?.aborted) {
        throw error
      }
      // 同源 Worker 可用但拉取失败时，继续尝试浏览器直连。
    }
  }

  return fetchDirectSubscription(sourceUrl, fetchImpl, options.signal)
}

export function looksLikeHtmlDocument(text: string): boolean {
  const trimmed = text.trim().slice(0, 512).toLowerCase()
  return (
    trimmed.startsWith('<!doctype html') ||
    trimmed.startsWith('<html') ||
    (trimmed.includes('<html') && trimmed.includes('<body'))
  )
}

async function fetchDirectSubscription(
  sourceUrl: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetchImpl(sourceUrl, { cache: 'no-store', signal })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const text = await response.text()
  if (looksLikeHtmlDocument(text)) {
    throw new Error('订阅地址返回了 HTML 页面而非代理配置文本')
  }
  return text
}

async function fetchSameOriginSubscription(
  sourceUrl: string,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetchImpl('/api/fetch-subscription', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url: sourceUrl }),
  })

  if (!response.ok) {
    throw new Error(`同源服务返回 HTTP ${response.status}`)
  }

  const content = await readFetcherContent(response)
  if (looksLikeHtmlDocument(content)) {
    throw new Error('订阅地址返回了 HTML 页面而非代理配置文本')
  }
  return content
}

async function fetchViaSubscriptionService(
  sourceUrl: string,
  options: { endpoint: string; token: string; signal?: AbortSignal },
  fetchImpl: typeof fetch,
): Promise<string> {
  if (!options.endpoint || !options.token) {
    throw new Error('请填写外部订阅服务地址与访问令牌')
  }

  const response = await fetchImpl(options.endpoint, {
    method: 'POST',
    cache: 'no-store',
    signal: options.signal,
    headers: {
      authorization: `Bearer ${options.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url: sourceUrl }),
  })

  if (!response.ok) {
    throw new Error(`外部拉取服务返回 HTTP ${response.status}`)
  }

  const content = await readFetcherContent(response)
  if (looksLikeHtmlDocument(content)) {
    throw new Error('订阅地址返回了 HTML 页面而非代理配置文本')
  }
  return content
}

async function readFetcherContent(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  const rawText = await response.text()
  if (contentType.includes('text/html') || looksLikeHtmlDocument(rawText)) {
    throw new Error('订阅地址返回了 HTML 页面而非代理配置文本')
  }
  let payload: { content?: unknown }
  try {
    payload = JSON.parse(rawText) as { content?: unknown }
  } catch {
    throw new Error('拉取服务未返回合法 JSON 响应')
  }
  if (typeof payload.content !== 'string') {
    throw new Error('拉取响应缺少 content 字段')
  }
  return payload.content
}

export async function createTemporaryClashConfigUrl(
  configYaml: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ configUrl: string; expiresInSeconds: number }> {
  const response = await fetchImpl('/api/clash-config', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ content: configYaml }),
  })

  if (!response.ok) {
    throw new Error(`临时配置创建失败 (HTTP ${response.status})`)
  }

  const payload = (await response.json()) as { url?: unknown; expiresInSeconds?: unknown }
  if (typeof payload.url !== 'string') {
    throw new Error('临时配置响应缺少 url')
  }

  const configUrl = new URL(payload.url, window.location.origin).toString()
  const expiresInSeconds =
    typeof payload.expiresInSeconds === 'number' ? payload.expiresInSeconds : 600

  return { configUrl, expiresInSeconds }
}

export async function buildClashImportUrl(
  configYaml: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ importUrl: string; configUrl: string; expiresInSeconds: number }> {
  const { configUrl, expiresInSeconds } = await createTemporaryClashConfigUrl(configYaml, fetchImpl)
  return {
    importUrl: `clash://install-config?url=${encodeURIComponent(configUrl)}`,
    configUrl,
    expiresInSeconds,
  }
}
