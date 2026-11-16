import {
  createHttpError,
  isRedirectStatus,
  parseHostOrOriginList,
  parseMaxRedirects,
  resolveRedirectTarget,
  validateSubscriptionUrlFormat,
} from '../shared/ssrf-guard.mjs'

const DEFAULT_TIMEOUT_MS = 12000
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 5

export async function fetchSubscriptionContent(rawUrl, env = {}, fetchImpl = globalThis.fetch) {
  const allowedHosts = parseHostOrOriginList(env.ALLOWED_SUBSCRIPTION_HOSTS)
  const allowPrivateHosts = env.ALLOW_PRIVATE_SUBSCRIPTION_HOSTS === 'true'
  const timeoutMs = parsePositiveInt(env.FETCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)
  const maxBytes = parsePositiveInt(env.MAX_RESPONSE_BYTES, DEFAULT_MAX_BYTES)
  const maxRedirects = parseMaxRedirects(env.MAX_REDIRECTS, DEFAULT_MAX_REDIRECTS)

  let currentUrl = validateSubscriptionUrlFormat(rawUrl, {
    allowedHosts,
    allowPrivateHosts,
  })

  const controller = new AbortController()
  const deadline = Date.now() + timeoutMs
  const visitedUrls = new Set([currentUrl.toString()])
  let redirectCount = 0
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs)

  try {
    while (true) {
      if (controller.signal.aborted || Date.now() >= deadline) {
        throw createHttpError(504, 'upstream_timeout')
      }

      let upstream
      try {
        upstream = await fetchImpl(currentUrl.toString(), {
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            accept: 'text/plain, application/yaml, application/x-yaml, text/yaml, */*',
            'user-agent': 'proxy-chain-cloudflare-worker/1.0',
          },
        })
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
          throw createHttpError(504, 'upstream_timeout')
        }
        throw createHttpError(502, 'upstream_connection_failed')
      }

      if (isRedirectStatus(upstream.status)) {
        const locationHeader = upstream.headers.get('location')
        await upstream.body?.cancel().catch(() => {})

        const next = resolveRedirectTarget({
          locationHeader,
          currentUrl,
          visitedUrls,
          redirectCount,
          maxRedirects,
          allowedHosts,
          allowPrivateHosts,
        })
        currentUrl = next.nextUrl
        redirectCount = next.redirectCount
        continue
      }

      if (!upstream.ok) {
        await upstream.body?.cancel().catch(() => {})
        throw createHttpError(502, `upstream_http_${upstream.status}`)
      }

      const reader = upstream.body?.getReader()
      if (!reader) {
        throw createHttpError(502, 'empty_upstream_body')
      }

      return await readResponseWithLimit(reader, maxBytes, controller.signal)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function readResponseWithLimit(reader, maxBytes, signal) {
  const chunks = []
  let received = 0
  let completed = false

  try {
    while (true) {
      if (signal.aborted) {
        throw createHttpError(504, 'upstream_timeout')
      }

      const { done, value } = await reader.read()
      if (done) {
        completed = true
        break
      }

      received += value.byteLength
      if (received > maxBytes) {
        throw createHttpError(413, 'upstream_response_too_large')
      }
      chunks.push(value)
    }

    return new TextDecoder().decode(concatChunks(chunks, received))
  } catch (error) {
    if (error?.statusCode) {
      throw error
    }
    if (signal.aborted || error?.name === 'AbortError') {
      throw createHttpError(504, 'upstream_timeout')
    }
    throw createHttpError(502, 'upstream_read_failed')
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => {})
    }
    try {
      reader.releaseLock()
    } catch {
      // ignore if stream already closed
    }
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

function parsePositiveInt(value, fallback) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback
  }
  return Math.floor(numeric)
}
