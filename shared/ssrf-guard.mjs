const DEFAULT_MAX_REDIRECTS = 5
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308])

/**
 * 解析逗号分隔的域名或来源配置。
 */
export function parseHostOrOriginList(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((item) => normalizeHostname(item))
      .filter(Boolean),
  )
}

/**
 * 解析严格匹配的来源列表（保留协议与端口）。
 */
export function parseOriginList(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  )
}

export function normalizeHostname(hostname) {
  const trimmed = String(hostname ?? '').trim().toLowerCase()
  const withoutBrackets =
    trimmed.startsWith('[') && trimmed.endsWith(']') ? trimmed.slice(1, -1) : trimmed
  const zoneIndex = withoutBrackets.indexOf('%')
  const withoutZone = zoneIndex >= 0 ? withoutBrackets.slice(0, zoneIndex) : withoutBrackets
  return withoutZone.replace(/\.+$/, '')
}

export function isRedirectStatus(statusCode) {
  return REDIRECT_STATUS_CODES.has(Number(statusCode))
}

export function parseMaxRedirects(value, fallback = DEFAULT_MAX_REDIRECTS) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 20) {
    return fallback
  }
  return numeric
}

/**
 * 校验单跳 URL 的协议、主机白名单与字面量地址安全边界。
 * 失败时只返回安全错误码，绝不在错误消息中回显完整订阅 URL 或凭据。
 */
export function validateSubscriptionUrlFormat(
  rawUrl,
  { allowedHosts, allowPrivateHosts = false },
) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > 2048) {
    throw createHttpError(400, 'invalid_url')
  }

  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw createHttpError(400, 'invalid_url')
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw createHttpError(400, 'unsupported_protocol')
  }

  const normalizedHost = normalizeHostname(url.hostname)
  if (!normalizedHost) {
    throw createHttpError(400, 'invalid_url')
  }

  if (!allowPrivateHosts && isBlockedHostLiteral(normalizedHost)) {
    throw createHttpError(403, 'blocked_host')
  }

  if (!allowedHosts || !allowedHosts.has(normalizedHost)) {
    throw createHttpError(403, 'host_not_allowed')
  }

  return url
}

/**
 * 解析并校验重定向 Location，检测循环跳转与超限。
 */
export function resolveRedirectTarget({
  locationHeader,
  currentUrl,
  visitedUrls,
  redirectCount,
  maxRedirects,
  allowedHosts,
  allowPrivateHosts = false,
}) {
  if (typeof locationHeader !== 'string' || !locationHeader.trim()) {
    throw createHttpError(502, 'invalid_redirect_location')
  }

  const nextRedirectCount = redirectCount + 1
  if (nextRedirectCount > maxRedirects) {
    throw createHttpError(502, 'too_many_redirects')
  }

  let nextUrl
  try {
    nextUrl = new URL(locationHeader.trim(), currentUrl)
  } catch {
    throw createHttpError(502, 'invalid_redirect_location')
  }

  const validatedUrl = validateSubscriptionUrlFormat(nextUrl.toString(), {
    allowedHosts,
    allowPrivateHosts,
  })

  const canonical = validatedUrl.toString()
  if (visitedUrls.has(canonical)) {
    throw createHttpError(502, 'redirect_loop')
  }
  visitedUrls.add(canonical)

  return {
    nextUrl: validatedUrl,
    redirectCount: nextRedirectCount,
  }
}

/**
 * 检查主机名或 IP 字面量是否命中本地/私网/链路本地/保留地址段。
 */
export function isBlockedHostLiteral(rawHost) {
  const host = normalizeHostname(rawHost)
  if (!host) {
    return true
  }

  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true
  }

  const ipv4 = parseIpv4Int(host)
  if (ipv4 !== null) {
    return isBlockedIpv4Int(ipv4)
  }

  const ipv6 = parseIpv6BigInt(host)
  if (ipv6 !== null) {
    return isBlockedIpv6BigInt(ipv6)
  }

  return false
}

export function isBlockedIpAddress(rawIp) {
  const normalized = normalizeHostname(rawIp)
  const ipv4 = parseIpv4Int(normalized)
  if (ipv4 !== null) {
    return isBlockedIpv4Int(ipv4)
  }

  const ipv6 = parseIpv6BigInt(normalized)
  if (ipv6 !== null) {
    return isBlockedIpv6BigInt(ipv6)
  }

  return true
}

export function parseIpv4Int(ip) {
  const parts = String(ip).split('.')
  if (parts.length !== 4) {
    return null
  }

  let value = 0
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) {
      return null
    }
    const octet = Number(part)
    if (octet < 0 || octet > 255) {
      return null
    }
    value = ((value << 8) | octet) >>> 0
  }

  return value
}

function ipv4CidrContains(ipInt, networkInt, prefixLen) {
  const mask = prefixLen === 0 ? 0 : (0xffffffff << (32 - prefixLen)) >>> 0
  return (ipInt & mask) === (networkInt & mask)
}

const BLOCKED_IPV4_CIDRS = [
  [0x00000000, 8], // 0.0.0.0/8 (this network / unspecified)
  [0x0a000000, 8], // 10.0.0.0/8 (RFC1918 private)
  [0x64400000, 10], // 100.64.0.0/10 (RFC6598 CGNAT)
  [0x7f000000, 8], // 127.0.0.0/8 (full loopback range)
  [0xa9fe0000, 16], // 169.254.0.0/16 (link-local / metadata)
  [0xac100000, 12], // 172.16.0.0/12 (RFC1918 private)
  [0xc0000000, 24], // 192.0.0.0/24 (IETF protocol assignments)
  [0xc0586300, 24], // 192.88.99.0/24 (6to4 relay anycast)
  [0xc0a80000, 16], // 192.168.0.0/16 (RFC1918 private)
  [0xc6120000, 15], // 198.18.0.0/15 (benchmarking)
  [0xe0000000, 4], // 224.0.0.0/4 (multicast)
  [0xf0000000, 4], // 240.0.0.0/4 (reserved & broadcast 255.255.255.255)
]

export function isBlockedIpv4Int(ipInt) {
  return BLOCKED_IPV4_CIDRS.some(([network, prefix]) => ipv4CidrContains(ipInt, network, prefix))
}

/**
 * 解析 IPv6 文本（支持 :: 压缩及内嵌 IPv4 尾段，如 ::ffff:127.0.0.1）为 128 位 BigInt。
 */
export function parseIpv6BigInt(rawIp) {
  const ip = normalizeHostname(rawIp)
  if (!ip.includes(':')) {
    return null
  }

  const doubleColonParts = ip.split('::')
  if (doubleColonParts.length > 2) {
    return null
  }

  const parseSegmentList = (segmentText, allowEmbeddedIpv4) => {
    if (!segmentText) {
      return []
    }
    const items = segmentText.split(':')
    const hextets = []

    for (let index = 0; index < items.length; index += 1) {
      const token = items[index]
      if (!token) {
        return null
      }
      if (token.includes('.')) {
        if (!allowEmbeddedIpv4 || index !== items.length - 1) {
          return null
        }
        const ipv4Int = parseIpv4Int(token)
        if (ipv4Int === null) {
          return null
        }
        hextets.push((ipv4Int >>> 16) & 0xffff, ipv4Int & 0xffff)
      } else {
        if (!/^[0-9a-f]{1,4}$/i.test(token)) {
          return null
        }
        hextets.push(Number.parseInt(token, 16))
      }
    }
    return hextets
  }

  const hasCompression = doubleColonParts.length === 2
  const left = parseSegmentList(doubleColonParts[0], !hasCompression)
  const right = hasCompression ? parseSegmentList(doubleColonParts[1], true) : []

  if (!left || !right) {
    return null
  }

  const totalHextets = left.length + right.length
  if (hasCompression ? totalHextets >= 8 : totalHextets !== 8) {
    return null
  }

  const missingZeros = hasCompression ? 8 - totalHextets : 0
  const full = [...left, ...new Array(missingZeros).fill(0), ...right]
  if (full.length !== 8) {
    return null
  }

  let result = 0n
  for (const h of full) {
    result = (result << 16n) | BigInt(h)
  }
  return result
}

function ipv6CidrContains(ipBigInt, prefixBigInt, prefixLen) {
  const shift = BigInt(128 - prefixLen)
  return (ipBigInt >> shift) === (prefixBigInt >> shift)
}

const IPV6_FFFF_PREFIX = 0x00000000000000000000ffff00000000n

const BLOCKED_IPV6_CIDRS = [
  [0x00000000000000000000000000000000n, 96], // ::/96 (includes ::/128, ::1/128 when checked below, IPv4-compatible)
  [0x0064ff9b000000000000000000000000n, 96], // 64:ff9b::/96 (NAT64)
  [0x0064ff9b000100000000000000000000n, 48], // 64:ff9b:1::/48 (NAT64 local-use)
  [0x01000000000000000000000000000000n, 64], // 100::/64 (discard-only)
  [0x20010000000000000000000000000000n, 32], // 2001::/32 (Teredo)
  [0x20010002000000000000000000000000n, 48], // 2001:2::/48 (benchmarking)
  [0x20020000000000000000000000000000n, 16], // 2002::/16 (6to4)
  [0xfc000000000000000000000000000000n, 7], // fc00::/7 (Unique Local Addresses)
  [0xfe800000000000000000000000000000n, 10], // fe80::/10 (Link-local)
  [0xfec00000000000000000000000000000n, 10], // fec0::/10 (Site-local)
  [0xff000000000000000000000000000000n, 8], // ff00::/8 (Multicast)
]

export function isBlockedIpv6BigInt(ipBigInt) {
  if (ipBigInt === 0n || ipBigInt === 1n) {
    return true
  }

  // 检查 IPv4-mapped IPv6 (::ffff:0:0/96)：直接拦截内嵌私网/回环/保留 IPv4，
  // 且为防 SSRF 绕过默认对整个 ::ffff:0:0/96 拒绝访问。
  if (ipv6CidrContains(ipBigInt, IPV6_FFFF_PREFIX, 96)) {
    return true
  }

  return BLOCKED_IPV6_CIDRS.some(([network, prefix]) => ipv6CidrContains(ipBigInt, network, prefix))
}

export function createHttpError(statusCode, message) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}
