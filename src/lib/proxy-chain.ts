import { parse as parseYamlDocument, stringify as stringifyYamlDocument } from 'yaml'
import { sha256Hex } from './hash'
import type {
  ChainConfigOptions,
  ChainSelectionConfigOptions,
} from './legacy-types'
import type {
  DetailedParseResult,
  Hysteria2ProxyNode,
  NodeDiagnostic,
  NormalizedProxyNode,
  NormalizedProxyNodeWithoutId,
  ParseIssue,
  ParseResult,
  ProxyNodeType,
  ProxyScalar,
  ShadowsocksProxyNode,
  Socks5ProxyNode,
  TargetFormat,
  VlessGrpcOpts,
  VlessProxyNode,
  VlessSecurity,
  VlessWsOpts,
} from './types'

export type { ChainConfigOptions, ChainSelectionConfigOptions }

type LooseYamlValue = string | number | boolean | null | undefined
type LooseYamlNode = LooseYamlValue | LooseYamlObject | LooseYamlNode[]

interface LooseYamlObject {
  [key: string]: LooseYamlNode
}

interface ClashProxyEntry extends LooseYamlObject {
  type?: LooseYamlNode
  name?: LooseYamlNode
  server?: LooseYamlNode
  port?: LooseYamlNode
}

const HY2_TYPES = new Set(['hysteria2', 'hy2'])
const SUPPORTED_TYPES = new Set<ProxyNodeType>(['vless', 'socks5', 'hysteria2', 'ss'])
const SUPPORTED_VLESS_TRANSPORTS = new Set(['tcp', 'ws', 'grpc'])
const SUPPORTED_VLESS_SECURITIES = new Set<VlessSecurity>(['none', 'tls', 'reality'])
const SUPPORTED_SS_PLUGINS = new Set(['obfs', 'v2ray-plugin', 'shadow-tls', 'gost-plugin', 'restls', 'kcptun'])

const COMMON_KNOWN_YAML_KEYS = new Set([
  'name',
  'type',
  'server',
  'port',
  'udp',
  'ip-version',
  'interface-name',
  'routing-mark',
  'tfo',
  'mptcp',
  'dialer-proxy',
])

const IGNORED_OPTIONAL_YAML_KEYS = new Set([
  'ip-version',
  'interface-name',
  'routing-mark',
  'tfo',
  'mptcp',
])

const CONNECTION_AFFECTING_UNSUPPORTED_YAML_KEYS = new Set([
  'smux',
  'ech-opts',
  'h2-opts',
  'http-opts',
  'xhttp-opts',
  'kcp-opts',
  'ss-opts',
  'shadow-tls-password',
  'shadow-tls-sni',
  'shadow-tls-version',
  'restls-password',
  'restls-version-hint',
])

export const PROTOCOL_CAPABILITY_MATRIX = {
  vless: {
    securities: ['none', 'tls', 'reality'] as const,
    transports: ['tcp', 'ws', 'grpc'] as const,
    formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'] as const,
  },
  socks5: {
    securities: ['none', 'tls'] as const,
    transports: ['tcp'] as const,
    formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'] as const,
    notes: 'socks5:// 普通链接不支持保存 TLS 参数',
  },
  hysteria2: {
    securities: ['tls'] as const,
    transports: ['quic'] as const,
    formats: ['clash-mihomo', 'clash-snippet', 'import-links'] as const,
    notes: 'Xray JSON 导出不支持 Hysteria2 协议',
  },
  ss: {
    securities: ['none'] as const,
    transports: ['tcp'] as const,
    plugins: ['obfs', 'v2ray-plugin', 'shadow-tls', 'gost-plugin', 'restls', 'kcptun'] as const,
    formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'] as const,
    notes: '带 SIP003 插件的 SS 节点不支持导出为 Xray JSON',
  },
} as const

/**
 * 解析用户粘贴的链接或订阅文本（仅本地解析，不发起网络请求）。
 */
export function parseProxyInput(input: string): ParseResult {
  const detailed = parseProxyInputDetailed(input)
  return {
    nodes: detailed.nodes,
    warnings: detailed.warnings,
  }
}

export function parseProxyInputDetailed(input: string): DetailedParseResult {
  const text = input.trim()
  if (!text) {
    return {
      nodes: [],
      validCount: 0,
      unsupportedCount: 0,
      invalidCount: 0,
      issues: [],
      warnings: ['输入为空，未解析到代理节点。'],
    }
  }

  const issues: ParseIssue[] = []
  const warnings: string[] = []
  const nodes: NormalizedProxyNode[] = []
  let unsupportedCount = 0
  let invalidCount = 0

  for (const chunk of splitInput(text)) {
    if (isUriLine(chunk)) {
      const lower = chunk.toLowerCase()
      if (lower.startsWith('vless://')) {
        const res = parseVlessLinkDetailed(chunk)
        if (res.node) {
          nodes.push(res.node)
        } else {
          const issue = res.issue ?? {
            kind: 'invalid',
            label: 'VLESS URI',
            message: '发现 VLESS 链接，但必填连接字段不完整或格式无效。',
          }
          if (issue.kind === 'unsupported') {
            unsupportedCount += 1
          } else {
            invalidCount += 1
          }
          issues.push(issue)
          warnings.push(issue.message)
        }
        continue
      }

      if (lower.startsWith('socks5://') || lower.startsWith('socks://')) {
        const res = parseSocks5LinkDetailed(chunk)
        if (res.node) {
          nodes.push(res.node)
        } else {
          const issue = res.issue ?? {
            kind: 'invalid',
            label: 'SOCKS5 URI',
            message: '发现 SOCKS5 链接，但服务器或端口格式无效。',
          }
          if (issue.kind === 'unsupported') {
            unsupportedCount += 1
          } else {
            invalidCount += 1
          }
          issues.push(issue)
          warnings.push(issue.message)
        }
        continue
      }

      if (lower.startsWith('ss://')) {
        const res = parseShadowsocksLinkDetailed(chunk)
        if (res.node) {
          nodes.push(res.node)
        } else {
          const issue = res.issue ?? {
            kind: 'invalid',
            label: 'Shadowsocks URI',
            message: '发现 Shadowsocks/SS 链接，但链接格式或加密字段不完整。',
          }
          if (issue.kind === 'unsupported') {
            unsupportedCount += 1
          } else {
            invalidCount += 1
          }
          issues.push(issue)
          warnings.push(issue.message)
        }
        continue
      }

      if (lower.startsWith('hysteria2://') || lower.startsWith('hy2://')) {
        const res = parseHysteria2LinkDetailed(chunk)
        if (res.node) {
          nodes.push(res.node)
        } else {
          const issue = res.issue ?? {
            kind: 'invalid',
            label: 'Hysteria2 URI',
            message: '发现 Hysteria2 链接，但服务器或端口格式无效。',
          }
          if (issue.kind === 'unsupported') {
            unsupportedCount += 1
          } else {
            invalidCount += 1
          }
          issues.push(issue)
          warnings.push(issue.message)
        }
        continue
      }

      const scheme = chunk.slice(0, chunk.indexOf('://'))
      unsupportedCount += 1
      const msg = `发现暂不支持的协议链接 (${scheme}://)，已跳过。`
      issues.push({ kind: 'unsupported', label: `${scheme}://`, message: msg })
      warnings.push(msg)
      continue
    }

    const yamlResult = parseYamlProxiesDetailed(chunk)
    if (
      yamlResult.nodes.length > 0 ||
      yamlResult.unsupportedCount > 0 ||
      yamlResult.invalidCount > 0
    ) {
      nodes.push(...yamlResult.nodes)
      unsupportedCount += yamlResult.unsupportedCount
      invalidCount += yamlResult.invalidCount
      issues.push(...yamlResult.issues)
      warnings.push(...yamlResult.warnings)
      continue
    }

    invalidCount += 1
    const msg =
      '有一段输入未能识别为 VLESS、SOCKS5、Hysteria2、Shadowsocks/SS 或受支持的 YAML 节点（整段 Base64 订阅尚未默认支持）。'
    issues.push({ kind: 'invalid', label: '输入片段', message: msg })
    warnings.push(msg)
  }

  const deduped = dedupeNodes(nodes)
  return {
    nodes: deduped,
    validCount: deduped.length,
    unsupportedCount,
    invalidCount,
    issues,
    warnings: Array.from(new Set(warnings)),
  }
}

export function parseVlessLink(link: string): VlessProxyNode | undefined {
  return parseVlessLinkDetailed(link).node
}

function parseVlessLinkDetailed(link: string): { node?: VlessProxyNode; issue?: ParseIssue } {
  try {
    const url = new URL(link)
    const uuid = decodeSafeComponent(url.username)
    const server = normalizeParsedServer(url.hostname)
    const port = parsePort(url.port)

    if (!uuid || !server || port === undefined) {
      return {
        issue: {
          kind: 'invalid',
          label: 'VLESS URI',
          message: 'VLESS 链接缺少有效的 UUID、服务器或端口。',
        },
      }
    }

    const params = url.searchParams
    const name = decodeName(url.hash, `${server}:${port}`)
    const issues: NodeDiagnostic[] = []

    const rawSecurity = optionalParam(params, 'security')?.toLowerCase()
    const pbk = optionalParam(params, 'pbk') ?? optionalParam(params, 'public-key')
    const sid = params.has('sid')
      ? (params.get('sid') ?? '')
      : params.has('shortId')
        ? (params.get('shortId') ?? '')
        : params.has('short-id')
          ? (params.get('short-id') ?? '')
          : undefined

    let security: VlessSecurity
    if (rawSecurity !== undefined) {
      if (SUPPORTED_VLESS_SECURITIES.has(rawSecurity as VlessSecurity)) {
        security = rawSecurity as VlessSecurity
      } else {
        security = 'none'
        issues.push({
          severity: 'error',
          formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
          field: 'security',
          code: 'unsupported_security',
          message: `VLESS 安全层 '${rawSecurity}' 尚未受支持，无法安全导出。`,
        })
      }
    } else {
      // 兼容规则：未显式声明 security 时，若包含 pbk 则推断为 reality，否则按 none 处理（不默认开启 TLS）。
      security = pbk ? 'reality' : 'none'
    }

    if (security === 'reality' && !pbk) {
      issues.push({
        severity: 'error',
        formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
        field: 'pbk',
        code: 'missing_reality_public_key',
        message: 'VLESS Reality 节点缺少 public-key (pbk)。',
      })
    }

    const encryption = optionalParam(params, 'encryption')
    if (encryption && encryption.toLowerCase() !== 'none') {
      issues.push({
        severity: 'error',
        formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
        field: 'encryption',
        code: 'unsupported_vless_encryption',
        message: `VLESS encryption '${encryption}' 尚未受支持（仅支持 none）。`,
      })
    }

    const rawNetwork = optionalParam(params, 'type')?.toLowerCase()
    const packetType = rawNetwork ?? 'tcp'
    const headerType = optionalParam(params, 'headerType') ?? optionalParam(params, 'header-type')

    if (!SUPPORTED_VLESS_TRANSPORTS.has(packetType)) {
      issues.push({
        severity: 'error',
        formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
        field: 'network',
        code: 'unsupported_transport',
        message: `VLESS 传输类型 '${packetType}' 尚未受支持，不会降级为 tcp。`,
      })
    } else if (packetType === 'tcp' && headerType && headerType.toLowerCase() !== 'none') {
      issues.push({
        severity: 'error',
        formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
        field: 'headerType',
        code: 'unsupported_tcp_header_type',
        message: `TCP 伪装头类型 '${headerType}' 尚未受支持。`,
      })
    }

    let wsOpts: VlessWsOpts | undefined
    if (packetType === 'ws') {
      const wsPath = optionalParam(params, 'path')
      const wsHost = optionalParam(params, 'host')
      if (wsPath !== undefined || wsHost !== undefined) {
        wsOpts = {
          ...(wsPath !== undefined ? { path: wsPath } : {}),
          ...(wsHost !== undefined ? { headers: { Host: wsHost } } : {}),
        }
      }
    }

    let grpcOpts: VlessGrpcOpts | undefined
    if (packetType === 'grpc') {
      const serviceName =
        optionalParam(params, 'serviceName') ??
        optionalParam(params, 'service-name') ??
        optionalParam(params, 'grpc-service-name')
      const mode = optionalParam(params, 'mode')
      if (serviceName !== undefined || mode !== undefined) {
        grpcOpts = {
          ...(serviceName !== undefined ? { serviceName } : {}),
          ...(mode !== undefined ? { mode } : {}),
        }
      }
      if (mode && mode !== 'gun' && mode !== 'multi') {
        issues.push({
          severity: 'warning',
          formats: ['clash-mihomo', 'clash-snippet'],
          field: 'mode',
          code: 'unverified_grpc_mode',
          message: `gRPC mode '${mode}' 在 Mihomo 中可能不被单独映射。`,
        })
      }
    }

    const alpnRaw = optionalParam(params, 'alpn')
    const alpn = alpnRaw
      ? alpnRaw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined

    const knownVlessParams = new Set([
      'encryption',
      'security',
      'flow',
      'sni',
      'servername',
      'fp',
      'client-fingerprint',
      'pbk',
      'public-key',
      'sid',
      'shortId',
      'short-id',
      'spx',
      'spiderX',
      'type',
      'headerType',
      'header-type',
      'path',
      'host',
      'serviceName',
      'service-name',
      'grpc-service-name',
      'mode',
      'alpn',
      'allowInsecure',
      'insecure',
      'skip-cert-verify',
      'packetEncoding',
      'packet-encoding',
      'udp',
    ])

    for (const [key] of params.entries()) {
      if (!knownVlessParams.has(key)) {
        issues.push({
          severity: 'warning',
          formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
          field: key,
          code: 'unknown_uri_param',
          message: `VLESS 链接包含未识别参数 '${key}'，导出时可能不会保留。`,
        })
      }
    }

    const blockingError = issues.find((issue) => issue.severity === 'error')
    if (blockingError) {
      const isUnsupported =
        blockingError.code === 'unsupported_security' ||
        blockingError.code === 'unsupported_vless_encryption' ||
        blockingError.code === 'unsupported_transport' ||
        blockingError.code === 'unsupported_tcp_header_type'
      return {
        issue: {
          kind: isUnsupported ? 'unsupported' : 'invalid',
          label: name,
          field: blockingError.field,
          message: blockingError.message,
        },
      }
    }

    const draft: Omit<VlessProxyNode, 'id'> = {
      type: 'vless',
      name,
      server,
      port,
      uuid,
      security,
      encryption,
      flow: optionalParam(params, 'flow'),
      sni: optionalParam(params, 'sni') ?? optionalParam(params, 'servername'),
      fp: optionalParam(params, 'fp') ?? optionalParam(params, 'client-fingerprint'),
      pbk,
      sid,
      spx: optionalParam(params, 'spx') ?? optionalParam(params, 'spiderX'),
      skipCertVerify:
        optionalBooleanParam(params, 'allowInsecure') ??
        optionalBooleanParam(params, 'insecure') ??
        optionalBooleanParam(params, 'skip-cert-verify'),
      alpn,
      packetType,
      headerType,
      wsOpts,
      grpcOpts,
      packetEncoding: optionalParam(params, 'packetEncoding') ?? optionalParam(params, 'packet-encoding'),
      udp: optionalBooleanParam(params, 'udp'),
      raw: link,
      ...(issues.length > 0 ? { issues } : {}),
    }

    return {
      node: {
        ...draft,
        id: computeStableNodeId(draft),
      },
    }
  } catch {
    return {}
  }
}

export function parseSocks5Link(link: string): Socks5ProxyNode | undefined {
  return parseSocks5LinkDetailed(link).node
}

function parseSocks5LinkDetailed(link: string): { node?: Socks5ProxyNode; issue?: ParseIssue } {
  try {
    const url = new URL(link)
    const server = normalizeParsedServer(url.hostname)
    const port = parsePort(url.port)

    if (!server || port === undefined) {
      return {
        issue: {
          kind: 'invalid',
          label: 'SOCKS5 URI',
          message: 'SOCKS5 链接缺少有效的服务器或端口。',
        },
      }
    }

    const username = decodeSafeComponent(url.username)
    const password = decodeSafeComponent(url.password)
    const name = decodeName(url.hash, `${server}:${port}`)
    const params = url.searchParams
    const tls = optionalBooleanParam(params, 'tls')
    const sni = optionalParam(params, 'sni') ?? optionalParam(params, 'servername')
    const fp = optionalParam(params, 'fp') ?? optionalParam(params, 'client-fingerprint')
    const skipCertVerify =
      optionalBooleanParam(params, 'insecure') ?? optionalBooleanParam(params, 'skip-cert-verify')

    const draft: Omit<Socks5ProxyNode, 'id'> = {
      type: 'socks5',
      name,
      server,
      port,
      username: username || undefined,
      password: password !== '' || url.password !== '' ? password : undefined,
      udp: optionalBooleanParam(params, 'udp'),
      tls,
      sni,
      fp,
      skipCertVerify,
      raw: link,
    }

    return {
      node: {
        ...draft,
        id: computeStableNodeId(draft),
      },
    }
  } catch {
    return {}
  }
}

export function parseHysteria2Link(link: string): Hysteria2ProxyNode | undefined {
  return parseHysteria2LinkDetailed(link).node
}

function parseHysteria2LinkDetailed(link: string): { node?: Hysteria2ProxyNode; issue?: ParseIssue } {
  try {
    const url = new URL(link)
    const server = normalizeParsedServer(url.hostname)
    const port = parsePort(url.port)

    if (!server || port === undefined) {
      return {
        issue: {
          kind: 'invalid',
          label: 'Hysteria2 URI',
          message: 'Hysteria2 链接缺少有效的服务器或端口。',
        },
      }
    }

    const params = url.searchParams
    const rawUser = url.username ? decodeSafeComponent(url.username) : ''
    const rawPass = url.password ? decodeSafeComponent(url.password) : ''
    const authPassword = rawPass ? `${rawUser}:${rawPass}` : rawUser
    const password = authPassword || optionalParam(params, 'password')
    const name = decodeName(url.hash, `${server}:${port}`)

    const alpnRaw = optionalParam(params, 'alpn')
    const alpn = alpnRaw
      ? alpnRaw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined

    const draft: Omit<Hysteria2ProxyNode, 'id'> = {
      type: 'hysteria2',
      name,
      server,
      port,
      password: password || undefined,
      sni: optionalParam(params, 'sni') ?? optionalParam(params, 'servername'),
      skipCertVerify:
        optionalBooleanParam(params, 'insecure') ?? optionalBooleanParam(params, 'skip-cert-verify'),
      udp: optionalBooleanParam(params, 'udp'),
      obfs: optionalParam(params, 'obfs'),
      obfsPassword: optionalParam(params, 'obfs-password'),
      fingerprint: optionalParam(params, 'pinSHA256') ?? optionalParam(params, 'fingerprint'),
      alpn,
      ports: optionalParam(params, 'mport') ?? optionalParam(params, 'ports'),
      up: optionalParam(params, 'up'),
      down: optionalParam(params, 'down'),
      raw: link,
    }

    return {
      node: {
        ...draft,
        id: computeStableNodeId(draft),
      },
    }
  } catch {
    return {}
  }
}

export function parseShadowsocksLink(link: string): ShadowsocksProxyNode | undefined {
  return parseShadowsocksLinkDetailed(link).node
}

function parseShadowsocksLinkDetailed(link: string): { node?: ShadowsocksProxyNode; issue?: ParseIssue } {
  try {
    const [withoutHash, hash = ''] = link.split('#', 2)
    const nameFromHash = hash ? decodeSafeComponent(hash).trim() : ''

    if (withoutHash.includes('@')) {
      const url = new URL(link)
      const userInfo = url.password
        ? `${decodeSafeComponent(url.username)}:${decodeSafeComponent(url.password)}`
        : decodeBase64Url(decodeSafeComponent(url.username))
      const separatorIndex = userInfo.indexOf(':')
      const cipher = separatorIndex >= 0 ? userInfo.slice(0, separatorIndex) : ''
      const password = separatorIndex >= 0 ? userInfo.slice(separatorIndex + 1) : ''
      const server = normalizeParsedServer(url.hostname)
      const port = parsePort(url.port)

      if (!cipher || !password || !server || port === undefined) {
        return {
          issue: {
            kind: 'invalid',
            label: 'Shadowsocks URI',
            message: 'Shadowsocks 链接缺少加密方式、密码、服务器或端口。',
          },
        }
      }

      return {
        node: buildShadowsocksNode({
          cipher,
          password,
          server,
          port,
          name: nameFromHash || decodeName(url.hash, `${server}:${port}`),
          params: url.searchParams,
          raw: link,
        }),
      }
    }

    const [withoutQuery, rawQuery = ''] = withoutHash.slice('ss://'.length).split('?', 2)
    const decoded = decodeBase64Url(withoutQuery)
    const parsed = parseShadowsocksAuthority(decoded)
    if (!parsed) {
      return {
        issue: {
          kind: 'invalid',
          label: 'Shadowsocks URI',
          message: 'Shadowsocks Base64 链接结构无法解析。',
        },
      }
    }

    return {
      node: buildShadowsocksNode({
        ...parsed,
        name: nameFromHash || `${parsed.server}:${parsed.port}`,
        params: new URLSearchParams(rawQuery),
        raw: link,
      }),
    }
  } catch {
    return {}
  }
}

export function parseYamlProxies(yamlText: string): NormalizedProxyNode[] {
  return parseYamlProxiesDetailed(yamlText).nodes
}

export function parseYamlProxiesDetailed(yamlText: string): DetailedParseResult {
  let parsed: LooseYamlObject | LooseYamlObject[] | undefined
  const issues: ParseIssue[] = []
  const warnings: string[] = []

  try {
    const document = parseYamlDocument(yamlText) as unknown
    if (isYamlObject(document) || isYamlObjectArray(document)) {
      parsed = document
    }
  } catch {
    try {
      parsed = parseLooseYaml(yamlText)
    } catch {
      return {
        nodes: [],
        validCount: 0,
        unsupportedCount: 0,
        invalidCount: 0,
        issues: [],
        warnings: [],
      }
    }
  }

  if (!parsed) {
    return {
      nodes: [],
      validCount: 0,
      unsupportedCount: 0,
      invalidCount: 0,
      issues: [],
      warnings: [],
    }
  }

  const proxies = readProxyEntries(parsed)
  const nodes: NormalizedProxyNode[] = []
  let unsupportedCount = 0
  let invalidCount = 0

  for (const proxy of proxies) {
    const res = normalizeYamlProxyDetailed(proxy, yamlText)
    if (res.node) {
      nodes.push(res.node)
      if (res.warnings.length > 0) {
        warnings.push(...res.warnings)
      }
      if (res.issues.length > 0) {
        issues.push(...res.issues)
      }
    } else if (res.kind === 'unsupported') {
      unsupportedCount += 1
      issues.push(...res.issues)
      warnings.push(...res.warnings)
    } else {
      invalidCount += 1
      issues.push(...res.issues)
      warnings.push(...res.warnings)
    }
  }

  const deduped = dedupeNodes(nodes)
  return {
    nodes: deduped,
    validCount: deduped.length,
    unsupportedCount,
    invalidCount,
    issues,
    warnings: Array.from(new Set(warnings)),
  }
}

export function generateClashYaml(
  entryNode: NormalizedProxyNode,
  exitNode: NormalizedProxyNode,
  options: ChainConfigOptions = {},
): string {
  return generateClashYamlForSelections([entryNode], [exitNode], {
    entryNodeNames: options.entryNodeName ? [options.entryNodeName] : undefined,
    exitNodeNames: options.exitNodeName ? [options.exitNodeName] : undefined,
  })
}

export function generateClashYamlForSelections(
  entryNodes: NormalizedProxyNode[],
  exitNodes: NormalizedProxyNode[],
  options: ChainSelectionConfigOptions = {},
): string {
  const { entryNames, exitNames } = resolveChainSelectionNames(entryNodes, exitNodes, options)
  const entryGroupName = '入口节点'
  const entryProxies = entryNodes.map((entryNode, index) => toClashProxy(entryNode, entryNames[index]))
  const exitProxies = exitNodes.map((exitNode, index) => ({
    ...toClashProxy(exitNode, exitNames[index]),
    // Clash/Mihomo 的 relay 策略已废弃且兼容性差；链式出口应直接用 dialer-proxy 指向入口选择组。
    'dialer-proxy': entryGroupName,
  }))

  const config: Record<string, unknown> = {
    'mixed-port': 7890,
    'allow-lan': false,
    mode: 'rule',
    'log-level': 'info',
    ipv6: false,
    dns: {
      enable: true,
      listen: '127.0.0.1:1053',
      'enhanced-mode': 'fake-ip',
      nameserver: ['223.5.5.5', '119.29.29.29'],
      fallback: ['1.1.1.1', '8.8.8.8'],
    },
    proxies: [...entryProxies, ...exitProxies],
    'proxy-groups': [
      {
        name: entryGroupName,
        type: 'select',
        proxies: entryNames,
      },
      {
        name: 'PROXY',
        type: 'select',
        proxies: exitNames,
      },
    ],
    rules: ['GEOIP,CN,DIRECT', 'MATCH,PROXY'],
  }

  return stringifyYamlConfig(config)
}

export function generateXrayJson(
  entryNode: NormalizedProxyNode,
  exitNode: NormalizedProxyNode,
  options: ChainConfigOptions = {},
): string {
  return generateXrayJsonForSelections([entryNode], [exitNode], {
    entryNodeNames: options.entryNodeName ? [options.entryNodeName] : undefined,
    exitNodeNames: options.exitNodeName ? [options.exitNodeName] : undefined,
  })
}

export function generateXrayJsonForSelections(
  entryNodes: NormalizedProxyNode[],
  exitNodes: NormalizedProxyNode[],
  options: ChainSelectionConfigOptions = {},
): string {
  for (const node of [...entryNodes, ...exitNodes]) {
    const errors = validateNodeForFormat(node, 'xray-json').filter((d) => d.severity === 'error')
    if (errors.length > 0) {
      throw new Error(errors.map((e) => e.message).join('；'))
    }
  }

  const { entryTags, exitTags } = resolveChainSelectionTags(entryNodes, exitNodes, options)
  const activeEntryTag = entryTags[0]
  const config = {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        tag: 'socks-in',
        listen: '127.0.0.1',
        port: 10808,
        protocol: 'socks',
        settings: { udp: true },
      },
    ],
    outbounds: [
      ...exitNodes.map((exitNode, index) => ({
        ...toXrayOutbound(exitNode, exitTags[index]),
        proxySettings: { tag: activeEntryTag },
      })),
      ...entryNodes.map((entryNode, index) => toXrayOutbound(entryNode, entryTags[index])),
    ],
  }

  return JSON.stringify(config, null, 2)
}

export function generateImportLinks(nodes: NormalizedProxyNode[]): string {
  for (const node of nodes) {
    const errors = validateNodeForFormat(node, 'import-links').filter((d) => d.severity === 'error')
    if (errors.length > 0) {
      throw new Error(errors.map((e) => e.message).join('；'))
    }
  }
  return nodes.map((node) => toImportLink(node)).join('\n')
}

export function stringifyYamlConfig(value: unknown): string {
  return stringifyYamlDocument(value, { lineWidth: 0 }).trimEnd() + '\n'
}

export function validateNodeForFormat(
  node: NormalizedProxyNode,
  format: TargetFormat,
): NodeDiagnostic[] {
  const diagnostics: NodeDiagnostic[] = []

  if (!node.server.trim()) {
    diagnostics.push({
      severity: 'error',
      formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
      field: 'server',
      code: 'missing_server',
      message: `节点 "${node.name}" 缺少服务器地址。`,
    })
  }
  if (!Number.isInteger(node.port) || node.port < 1 || node.port > 65535) {
    diagnostics.push({
      severity: 'error',
      formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
      field: 'port',
      code: 'invalid_port',
      message: `节点 "${node.name}" 的端口超出有效范围 (1-65535)。`,
    })
  }

  if (node.issues) {
    for (const issue of node.issues) {
      if (issue.formats.includes(format)) {
        diagnostics.push(issue)
      }
    }
  }

  if (node.type === 'vless') {
    if (!node.uuid.trim()) {
      diagnostics.push({
        severity: 'error',
        formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
        field: 'uuid',
        code: 'missing_uuid',
        message: `VLESS 节点 "${node.name}" 缺少 UUID。`,
      })
    }
    if (node.security === 'reality' && !node.pbk?.trim()) {
      diagnostics.push({
        severity: 'error',
        formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
        field: 'pbk',
        code: 'missing_reality_public_key',
        message: `VLESS Reality 节点 "${node.name}" 缺少 public-key。`,
      })
    }
    const transport = (node.packetType ?? 'tcp').toLowerCase()
    if (!SUPPORTED_VLESS_TRANSPORTS.has(transport)) {
      diagnostics.push({
        severity: 'error',
        formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
        field: 'network',
        code: 'unsupported_transport',
        message: `VLESS 节点 "${node.name}" 使用未受支持的传输 '${transport}'，拒绝静默降级为 tcp。`,
      })
    }
    if (format === 'import-links' && transport === 'ws' && node.wsOpts) {
      diagnostics.push(...collectInexpressibleWsDiagnostics(node, node.wsOpts))
    }
  }

  if (node.type === 'socks5') {
    if (node.tls && format === 'import-links') {
      diagnostics.push({
        severity: 'error',
        formats: ['import-links'],
        field: 'tls',
        code: 'socks5_tls_unsupported_in_uri',
        message: `SOCKS5 节点 "${node.name}" 开启了 TLS，普通 socks5:// 链接无法完整保留 TLS 参数。`,
      })
    }
  }

  if (node.type === 'hysteria2') {
    if (format === 'xray-json') {
      diagnostics.push({
        severity: 'error',
        formats: ['xray-json'],
        field: 'type',
        code: 'hysteria2_unsupported_in_xray',
        message: `Hysteria2 节点 "${node.name}" 不受 Xray JSON 导出格式支持。`,
      })
    }
    if (format === 'import-links' && (node.up || node.down)) {
      diagnostics.push({
        severity: 'warning',
        formats: ['import-links'],
        field: 'up/down',
        code: 'hy2_bandwidth_omitted_in_uri',
        message: `Hysteria2 节点 "${node.name}" 的 up/down 速率限制不会完整写入普通 URI。`,
      })
    }
  }

  if (node.type === 'ss') {
    if (!node.cipher.trim() || !node.password) {
      diagnostics.push({
        severity: 'error',
        formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
        field: 'cipher/password',
        code: 'missing_ss_credentials',
        message: `Shadowsocks 节点 "${node.name}" 缺少加密方式或密码。`,
      })
    }
    if (node.plugin) {
      if (format === 'xray-json') {
        diagnostics.push({
          severity: 'error',
          formats: ['xray-json'],
          field: 'plugin',
          code: 'ss_plugin_unsupported_in_xray',
          message: `Shadowsocks 节点 "${node.name}" 配置了插件 '${node.plugin}'，Xray JSON 导出不支持该插件。`,
        })
      }
      if (
        (format === 'clash-mihomo' || format === 'clash-snippet') &&
        !SUPPORTED_SS_PLUGINS.has(node.plugin)
      ) {
        diagnostics.push({
          severity: 'error',
          formats: ['clash-mihomo', 'clash-snippet'],
          field: 'plugin',
          code: 'ss_plugin_unsupported_in_clash',
          message: `Shadowsocks 插件 '${node.plugin}' 未在 Mihomo 能力表中声明支持。`,
        })
      }
    }
    if (node.udpOverTcp && format === 'import-links') {
      diagnostics.push({
        severity: 'warning',
        formats: ['import-links'],
        field: 'udpOverTcp',
        code: 'ss_uot_omitted_in_uri',
        message: `Shadowsocks 节点 "${node.name}" 的 udp-over-tcp 选项无法可靠写入标准 ss:// 链接。`,
      })
    }
  }

  return deduplicateDiagnostics(diagnostics)
}

export function toClashProxy(node: NormalizedProxyNode, name: string): Record<string, unknown> {
  const common = {
    name,
    type: node.type,
    server: node.server,
    port: node.port,
  }

  if (node.type === 'vless') {
    const network = node.packetType ?? 'tcp'
    const wsOpts =
      network === 'ws' && node.wsOpts
        ? dropUndefined({
            path: node.wsOpts.path,
            headers: node.wsOpts.headers,
            'max-early-data': node.wsOpts.maxEarlyData,
            'early-data-header-name': node.wsOpts.earlyDataHeaderName,
            'v2ray-http-upgrade': node.wsOpts.v2rayHttpUpgrade,
          })
        : undefined
    const grpcOpts =
      network === 'grpc' && node.grpcOpts?.serviceName !== undefined
        ? { 'grpc-service-name': node.grpcOpts.serviceName }
        : undefined

    const realityOpts =
      node.security === 'reality'
        ? dropUndefined({
            'public-key': node.pbk,
            ...(node.sid !== undefined ? { 'short-id': node.sid } : {}),
          })
        : undefined

    return dropUndefined({
      ...common,
      uuid: node.uuid,
      flow: node.flow,
      network,
      tls: node.security === 'tls' || node.security === 'reality',
      servername: node.security === 'none' ? undefined : node.sni,
      'client-fingerprint': node.security === 'none' ? undefined : node.fp,
      'skip-cert-verify': node.security === 'tls' ? node.skipCertVerify : undefined,
      alpn: node.security === 'none' ? undefined : node.alpn,
      'packet-encoding': node.packetEncoding,
      udp: node.udp,
      'reality-opts': realityOpts,
      'ws-opts': wsOpts && Object.keys(wsOpts).length > 0 ? wsOpts : undefined,
      'grpc-opts': grpcOpts,
    })
  }

  if (node.type === 'socks5') {
    return dropUndefined({
      ...common,
      username: node.username,
      password: node.password,
      udp: node.udp ?? true,
      tls: node.tls,
      servername: node.tls ? node.sni : undefined,
      fingerprint: node.tls ? node.fp : undefined,
      'skip-cert-verify': node.tls ? node.skipCertVerify : undefined,
    })
  }

  if (node.type === 'ss') {
    return dropUndefined({
      ...common,
      cipher: node.cipher,
      password: node.password,
      plugin: node.plugin,
      'plugin-opts': node.pluginOpts,
      udp: node.udp ?? true,
      'udp-over-tcp': node.udpOverTcp,
    })
  }

  return dropUndefined({
    ...common,
    password: node.password,
    sni: node.sni,
    'skip-cert-verify': node.skipCertVerify,
    udp: node.udp ?? true,
    obfs: node.obfs,
    'obfs-password': node.obfsPassword,
    fingerprint: node.fingerprint,
    alpn: node.alpn,
    ports: node.ports,
    up: node.up,
    down: node.down,
  })
}

export function toXrayOutbound(node: NormalizedProxyNode, tag: string): Record<string, unknown> {
  if (node.type === 'vless') {
    const network = node.packetType ?? 'tcp'
    const streamSettings: Record<string, unknown> = {
      network,
      security: node.security,
    }

    if (node.security === 'reality') {
      streamSettings.realitySettings = dropUndefined({
        serverName: node.sni,
        fingerprint: node.fp,
        publicKey: node.pbk,
        ...(node.sid !== undefined ? { shortId: node.sid } : {}),
        spiderX: node.spx ?? '/',
      })
    } else if (node.security === 'tls') {
      streamSettings.tlsSettings = dropUndefined({
        serverName: node.sni,
        fingerprint: node.fp,
        allowInsecure: node.skipCertVerify,
        alpn: node.alpn,
      })
    }

    if (network === 'ws' && node.wsOpts) {
      streamSettings.wsSettings = dropUndefined({
        path: node.wsOpts.path,
        headers: node.wsOpts.headers,
      })
    }

    if (network === 'grpc' && node.grpcOpts) {
      streamSettings.grpcSettings = dropUndefined({
        serviceName: node.grpcOpts.serviceName,
        multiMode: node.grpcOpts.mode === 'multi' ? true : undefined,
      })
    }

    return {
      tag,
      protocol: 'vless',
      settings: {
        vnext: [
          {
            address: node.server,
            port: node.port,
            users: [
              dropUndefined({
                id: node.uuid,
                encryption: node.encryption ?? 'none',
                flow: node.flow,
              }),
            ],
          },
        ],
      },
      streamSettings,
    }
  }

  if (node.type === 'socks5') {
    const server = dropUndefined({
      address: node.server,
      port: node.port,
      users:
        node.username !== undefined || node.password !== undefined
          ? [
              {
                user: node.username ?? '',
                pass: node.password ?? '',
              },
            ]
          : undefined,
    })

    const outbound: Record<string, unknown> = {
      tag,
      protocol: 'socks',
      settings: {
        servers: [server],
      },
    }

    if (node.tls) {
      outbound.streamSettings = {
        security: 'tls',
        tlsSettings: dropUndefined({
          serverName: node.sni,
          fingerprint: node.fp,
          allowInsecure: node.skipCertVerify,
        }),
      }
    }

    return outbound
  }

  if (node.type === 'ss') {
    return {
      tag,
      protocol: 'shadowsocks',
      settings: {
        servers: [
          dropUndefined({
            address: node.server,
            port: node.port,
            method: node.cipher,
            password: node.password,
          }),
        ],
      },
    }
  }

  throw new Error(`Xray JSON 不支持协议 ${node.type}`)
}

/**
 * 普通 vless:// 链接仅能可靠表达 WebSocket 的 path 与 Host 头（Host 头名称大小写不敏感）；
 * 自定义请求头、early-data、v2ray-http-upgrade 等参数没有公认的 URI 表达方式，
 * 导出前必须显式阻止，避免依赖这些参数的节点被静默降级后无法等价还原。
 */
function collectInexpressibleWsDiagnostics(
  node: VlessProxyNode,
  wsOpts: VlessWsOpts,
): NodeDiagnostic[] {
  const diagnostics: NodeDiagnostic[] = []
  const nonHostHeaders = Object.keys(wsOpts.headers ?? {}).filter((key) => !/^host$/i.test(key))

  if (nonHostHeaders.length > 0) {
    diagnostics.push({
      severity: 'error',
      formats: ['import-links'],
      field: `ws-opts.headers.${nonHostHeaders[0]}`,
      code: 'ws_header_inexpressible_in_uri',
      message: `VLESS 节点 "${node.name}" 的 WebSocket 自定义请求头 (${nonHostHeaders.join(', ')}) 无法写入普通 vless:// 链接，已阻止导出以免静默丢失参数。`,
    })
  }
  if (wsOpts.maxEarlyData !== undefined || wsOpts.earlyDataHeaderName !== undefined) {
    diagnostics.push({
      severity: 'error',
      formats: ['import-links'],
      field: 'ws-opts.max-early-data',
      code: 'ws_early_data_inexpressible_in_uri',
      message: `VLESS 节点 "${node.name}" 的 WebSocket early-data 设置 (max-early-data / early-data-header-name) 无法写入普通 vless:// 链接，已阻止导出以免静默丢失参数。`,
    })
  }
  if (wsOpts.v2rayHttpUpgrade !== undefined) {
    diagnostics.push({
      severity: 'error',
      formats: ['import-links'],
      field: 'ws-opts.v2ray-http-upgrade',
      code: 'ws_http_upgrade_inexpressible_in_uri',
      message: `VLESS 节点 "${node.name}" 的 WebSocket v2ray-http-upgrade 选项无法写入普通 vless:// 链接，已阻止导出以免静默丢失参数。`,
    })
  }
  return diagnostics
}

function getWsHostHeader(wsOpts: VlessWsOpts): string | undefined {
  for (const [key, value] of Object.entries(wsOpts.headers ?? {})) {
    if (/^host$/i.test(key)) {
      return value
    }
  }
  return undefined
}

export function toImportLink(node: NormalizedProxyNode): string {
  const host = formatHostForUrl(node.server)

  if (node.type === 'vless') {
    const params = new URLSearchParams()
    addParam(params, 'encryption', node.encryption ?? 'none')
    addParam(params, 'security', node.security)
    if (node.security !== 'none') {
      addParam(params, 'flow', node.flow)
      addParam(params, 'sni', node.sni)
      addParam(params, 'fp', node.fp)
      if (node.security === 'reality') {
        addParam(params, 'pbk', node.pbk)
        if (node.sid !== undefined) {
          params.set('sid', node.sid)
        }
        addParam(params, 'spx', node.spx)
      } else if (node.skipCertVerify !== undefined) {
        addParam(params, 'allowInsecure', node.skipCertVerify ? '1' : '0')
      }
      if (node.alpn && node.alpn.length > 0) {
        addParam(params, 'alpn', node.alpn.join(','))
      }
    } else {
      addParam(params, 'flow', node.flow)
    }

    const network = node.packetType ?? 'tcp'
    addParam(params, 'type', network)
    if (network === 'tcp') {
      addParam(params, 'headerType', node.headerType)
    } else if (network === 'ws' && node.wsOpts) {
      // 无法等价表达的 WebSocket 参数必须在生成链接前拦截，防止导出后节点不可用。
      const inexpressible = collectInexpressibleWsDiagnostics(node, node.wsOpts)
      if (inexpressible.some((issue) => issue.severity === 'error')) {
        throw new Error(
          inexpressible.map((issue) => `${issue.field ?? ''} ${issue.message}`).join('；'),
        )
      }
      addParam(params, 'path', node.wsOpts.path)
      const wsHost = getWsHostHeader(node.wsOpts)
      addParam(params, 'host', wsHost)
    } else if (network === 'grpc' && node.grpcOpts) {
      addParam(params, 'serviceName', node.grpcOpts.serviceName)
      addParam(params, 'mode', node.grpcOpts.mode)
    }

    const query = params.toString()
    return `vless://${encodeURIComponent(node.uuid)}@${host}:${node.port}${query ? `?${query}` : ''}#${encodeURIComponent(node.name)}`
  }

  if (node.type === 'socks5') {
    const auth =
      node.username !== undefined || node.password !== undefined
        ? `${encodeURIComponent(node.username ?? '')}:${encodeURIComponent(node.password ?? '')}@`
        : ''
    const params = new URLSearchParams()
    if (node.udp !== undefined) {
      params.set('udp', String(node.udp))
    }
    const query = params.toString()
    return `socks5://${auth}${host}:${node.port}${query ? `?${query}` : ''}#${encodeURIComponent(node.name)}`
  }

  if (node.type === 'ss') {
    const userInfo = encodeBase64Url(`${node.cipher}:${node.password}`)
    const params = new URLSearchParams()
    const formattedPlugin = formatSip002PluginParam(node.plugin, node.pluginOpts)
    addParam(params, 'plugin', formattedPlugin)
    const query = params.toString()
    return `ss://${userInfo}@${host}:${node.port}${query ? `?${query}` : ''}#${encodeURIComponent(node.name)}`
  }

  const params = new URLSearchParams()
  addParam(params, 'sni', node.sni)
  if (node.skipCertVerify !== undefined) {
    addParam(params, 'insecure', node.skipCertVerify ? '1' : '0')
  }
  addParam(params, 'obfs', node.obfs)
  addParam(params, 'obfs-password', node.obfsPassword)
  addParam(params, 'pinSHA256', node.fingerprint)
  if (node.alpn && node.alpn.length > 0) {
    addParam(params, 'alpn', node.alpn.join(','))
  }
  addParam(params, 'mport', node.ports)
  if (node.udp !== undefined) {
    params.set('udp', String(node.udp))
  }
  const query = params.toString()
  const auth = node.password ? `${encodeURIComponent(node.password)}@` : ''
  return `hysteria2://${auth}${host}:${node.port}${query ? `?${query}` : ''}#${encodeURIComponent(node.name)}`
}

/**
 * 基于完整连接语义计算规范化指纹（不含显示名称与原始文本），用于去重及生成稳定 ID。
 */
export function computeConnectionFingerprint(node: NormalizedProxyNodeWithoutId): string {
  const server = node.server.trim().toLowerCase()

  if (node.type === 'vless') {
    return JSON.stringify({
      type: 'vless',
      server,
      port: node.port,
      uuid: node.uuid,
      security: node.security,
      encryption: node.encryption ?? 'none',
      flow: node.flow ?? null,
      sni: node.sni ?? null,
      fp: node.fp ?? null,
      pbk: node.pbk ?? null,
      sid: node.sid ?? null,
      spx: node.spx ?? null,
      skipCertVerify: node.skipCertVerify ?? null,
      alpn: node.alpn ?? null,
      packetType: node.packetType ?? 'tcp',
      headerType: node.headerType ?? null,
      wsOpts: node.wsOpts ? sortObjectKeys(node.wsOpts) : null,
      grpcOpts: node.grpcOpts ? sortObjectKeys(node.grpcOpts) : null,
      packetEncoding: node.packetEncoding ?? null,
      udp: node.udp ?? null,
    })
  }

  if (node.type === 'socks5') {
    return JSON.stringify({
      type: 'socks5',
      server,
      port: node.port,
      username: node.username ?? null,
      password: node.password ?? null,
      udp: node.udp ?? null,
      tls: node.tls ?? null,
      sni: node.sni ?? null,
      fp: node.fp ?? null,
      skipCertVerify: node.skipCertVerify ?? null,
    })
  }

  if (node.type === 'hysteria2') {
    return JSON.stringify({
      type: 'hysteria2',
      server,
      port: node.port,
      password: node.password ?? null,
      sni: node.sni ?? null,
      skipCertVerify: node.skipCertVerify ?? null,
      udp: node.udp ?? null,
      obfs: node.obfs ?? null,
      obfsPassword: node.obfsPassword ?? null,
      fingerprint: node.fingerprint ?? null,
      alpn: node.alpn ?? null,
      ports: node.ports ?? null,
      up: node.up ?? null,
      down: node.down ?? null,
    })
  }

  return JSON.stringify({
    type: 'ss',
    server,
    port: node.port,
    cipher: node.cipher,
    password: node.password,
    plugin: node.plugin ?? null,
    pluginOpts: node.pluginOpts ? sortObjectKeys(node.pluginOpts) : null,
    udp: node.udp ?? null,
    udpOverTcp: node.udpOverTcp ?? null,
  })
}

export function computeStableNodeId(node: NormalizedProxyNodeWithoutId): string {
  const fingerprint = computeConnectionFingerprint(node)
  return `${node.type}-${sha256Hex(fingerprint).slice(0, 16)}`
}

function splitInput(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length > 0 && lines.every((line) => isUriLine(line))) {
    return lines
  }

  return [text]
}

function isUriLine(line: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(line)
}

function normalizeParsedServer(hostname: string): string {
  const trimmed = hostname.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function formatHostForUrl(server: string): string {
  const clean = normalizeParsedServer(server)
  return clean.includes(':') ? `[${clean}]` : clean
}

function decodeSafeComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function decodeName(hash: string, fallback: string): string {
  if (!hash) {
    return fallback
  }

  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  return decodeSafeComponent(raw).trim() || fallback
}

function optionalParam(params: URLSearchParams, key: string): string | undefined {
  const value = params.get(key)
  return value && value.trim() ? value : undefined
}

function optionalBooleanParam(params: URLSearchParams, key: string): boolean | undefined {
  const value = optionalParam(params, key)
  if (!value) {
    return undefined
  }

  if (/^(1|true|yes)$/i.test(value)) {
    return true
  }
  if (/^(0|false|no)$/i.test(value)) {
    return false
  }

  return undefined
}

function parseShadowsocksAuthority(
  decoded: string,
): { cipher: string; password: string; server: string; port: number } | undefined {
  const atIndex = decoded.lastIndexOf('@')
  const colonIndex = decoded.indexOf(':')
  if (atIndex < 0 || colonIndex < 0 || colonIndex > atIndex) {
    return undefined
  }

  const cipher = decoded.slice(0, colonIndex)
  const password = decoded.slice(colonIndex + 1, atIndex)
  const hostPort = decoded.slice(atIndex + 1)
  const portSeparatorIndex = hostPort.lastIndexOf(':')
  if (!cipher || !password || portSeparatorIndex < 0) {
    return undefined
  }

  const server = normalizeParsedServer(hostPort.slice(0, portSeparatorIndex))
  const port = parsePort(hostPort.slice(portSeparatorIndex + 1))
  if (!server || port === undefined) {
    return undefined
  }

  return { cipher, password, server, port }
}

function buildShadowsocksNode({
  cipher,
  password,
  server,
  port,
  name,
  params,
  raw,
}: {
  cipher: string
  password: string
  server: string
  port: number
  name: string
  params: URLSearchParams
  raw: string
}): ShadowsocksProxyNode {
  const rawPlugin = optionalParam(params, 'plugin')
  const { plugin, pluginOpts } = parseSip002PluginParam(rawPlugin)
  const udpOverTcp = optionalBooleanParam(params, 'uot') ?? optionalBooleanParam(params, 'udp-over-tcp')

  const draft: Omit<ShadowsocksProxyNode, 'id'> = {
    type: 'ss',
    name,
    server,
    port,
    cipher,
    password,
    plugin,
    pluginOpts,
    udp: optionalBooleanParam(params, 'udp'),
    udpOverTcp,
    raw,
  }

  return {
    ...draft,
    id: computeStableNodeId(draft),
  }
}

function parseSip002PluginParam(rawPlugin: string | undefined): {
  plugin?: string
  pluginOpts?: Record<string, ProxyScalar>
} {
  if (!rawPlugin) {
    return {}
  }

  const parts = rawPlugin.split(';')
  const rawName = parts[0]?.trim()
  if (!rawName) {
    return {}
  }

  const plugin = rawName === 'obfs-local' || rawName === 'simple-obfs' ? 'obfs' : rawName
  if (parts.length === 1) {
    return { plugin }
  }

  const opts: Record<string, ProxyScalar> = {}
  for (const part of parts.slice(1)) {
    const trimmed = part.trim()
    if (!trimmed) {
      continue
    }
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx < 0) {
      opts[trimmed] = true
      continue
    }
    const rawKey = trimmed.slice(0, eqIdx).trim()
    const rawVal = trimmed.slice(eqIdx + 1)
    if (plugin === 'obfs') {
      if (rawKey === 'obfs') {
        opts.mode = rawVal
      } else if (rawKey === 'obfs-host') {
        opts.host = rawVal
      } else {
        opts[rawKey] = rawVal
      }
    } else if (plugin === 'shadow-tls' && rawKey === 'passwd') {
      opts.password = rawVal
    } else {
      opts[rawKey] = rawVal
    }
  }

  return {
    plugin,
    pluginOpts: Object.keys(opts).length > 0 ? opts : undefined,
  }
}

function formatSip002PluginParam(
  plugin: string | undefined,
  pluginOpts: Record<string, ProxyScalar> | undefined,
): string | undefined {
  if (!plugin) {
    return undefined
  }
  if (!pluginOpts || Object.keys(pluginOpts).length === 0) {
    return plugin
  }

  if (plugin === 'obfs') {
    const segments = ['obfs-local']
    if (pluginOpts.mode !== undefined) {
      segments.push(`obfs=${String(pluginOpts.mode)}`)
    }
    if (pluginOpts.host !== undefined) {
      segments.push(`obfs-host=${String(pluginOpts.host)}`)
    }
    for (const [k, v] of Object.entries(pluginOpts)) {
      if (k !== 'mode' && k !== 'host') {
        segments.push(`${k}=${String(v)}`)
      }
    }
    return segments.join(';')
  }

  const segments = [plugin]
  for (const [k, v] of Object.entries(pluginOpts)) {
    if (typeof v === 'boolean') {
      if (v) {
        segments.push(k)
      }
    } else {
      segments.push(`${k}=${String(v)}`)
    }
  }
  return segments.join(';')
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new TextDecoder().decode(bytes)
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function parsePort(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') {
    return undefined
  }
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    return undefined
  }
  const numeric = typeof value === 'number' ? value : Number(value.trim())
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    return undefined
  }
  return numeric
}

function readProxyEntries(parsed: LooseYamlObject | LooseYamlObject[]): ClashProxyEntry[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(isYamlObject) as ClashProxyEntry[]
  }

  const proxies = parsed.proxies
  if (Array.isArray(proxies)) {
    return proxies.filter(isYamlObject) as ClashProxyEntry[]
  }

  if (isYamlObject(parsed) && parsed.type && parsed.server && parsed.port !== undefined) {
    return [parsed as ClashProxyEntry]
  }

  return []
}

function normalizeYamlProxyDetailed(
  proxy: ClashProxyEntry,
  raw: string,
): {
  node?: NormalizedProxyNode
  kind: 'valid' | 'unsupported' | 'invalid'
  issues: ParseIssue[]
  warnings: string[]
} {
  const parseIssues: ParseIssue[] = []
  const warnings: string[] = []
  const nodeDiagnostics: NodeDiagnostic[] = []
  let hasFieldTypeError = false

  const readStrictString = (
    source: LooseYamlObject,
    key: string,
    labelPrefix: string,
    fieldPath = key,
  ): string | undefined => {
    const value = source[key]
    if (value === undefined) {
      return undefined
    }
    if (typeof value !== 'string') {
      hasFieldTypeError = true
      const kindDesc = value === null ? 'null' : typeof value
      const msg = `${labelPrefix} 字段 '${fieldPath}' 被 YAML 解析为 ${kindDesc}，无法可靠还原原始字符串（请使用引号包裹字符串）`
      parseIssues.push({ kind: 'invalid', label: labelPrefix, field: fieldPath, message: msg })
      warnings.push(msg)
      return undefined
    }
    return value
  }

  const originalType = readStrictString(proxy, 'type', 'YAML 节点')?.toLowerCase()
  const type = normalizeType(originalType)
  const rawName = readStrictString(proxy, 'name', 'YAML 节点')
  const server = readStrictString(proxy, 'server', rawName ?? 'YAML 节点')
  const port = parsePort(proxy.port)
  const label = rawName ?? (server && port ? `${server}:${port}` : 'YAML 节点')

  if (!originalType) {
    const msg = `YAML 节点 "${label}" 缺少有效的 type 字段。`
    return {
      kind: 'invalid',
      issues: [...parseIssues, { kind: 'invalid', label, field: 'type', message: msg }],
      warnings: [...warnings, msg],
    }
  }

  if (!type) {
    const msg = `发现暂不支持的 YAML 协议类型 '${originalType}'（节点 "${label}"），已跳过。`
    return {
      kind: 'unsupported',
      issues: [{ kind: 'unsupported', label, field: 'type', message: msg }],
      warnings: [msg],
    }
  }

  if (!server || port === undefined || hasFieldTypeError) {
    if (!server) {
      const msg = `YAML 节点 "${label}" 缺少有效的 server 字段。`
      parseIssues.push({ kind: 'invalid', label, field: 'server', message: msg })
      warnings.push(msg)
    }
    if (port === undefined) {
      const msg = `YAML 节点 "${label}" 的 port 无效。`
      parseIssues.push({ kind: 'invalid', label, field: 'port', message: msg })
      warnings.push(msg)
    }
    return {
      kind: 'invalid',
      issues: parseIssues,
      warnings,
    }
  }

  const name = rawName ?? `${server}:${port}`

  if (proxy['dialer-proxy'] !== undefined) {
    const msg = `节点 "${name}" 输入中包含原有 dialer-proxy，已在归一化时安全忽略；链式依赖将由当前方案生成。`
    nodeDiagnostics.push({
      severity: 'warning',
      formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
      field: 'dialer-proxy',
      code: 'ignored_input_dialer_proxy',
      message: msg,
    })
    warnings.push(msg)
  }

  const protocolSpecificKeys = new Set<string>()

  const checkUnknownKeys = () => {
    for (const key of Object.keys(proxy)) {
      if (COMMON_KNOWN_YAML_KEYS.has(key) || protocolSpecificKeys.has(key)) {
        continue
      }
      if (IGNORED_OPTIONAL_YAML_KEYS.has(key)) {
        nodeDiagnostics.push({
          severity: 'warning',
          formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
          field: key,
          code: 'ignored_optional_field',
          message: `节点 "${name}" 的可选字段 '${key}' 未在导出模型中保留。`,
        })
        continue
      }
      if (CONNECTION_AFFECTING_UNSUPPORTED_YAML_KEYS.has(key)) {
        const msg = `节点 "${name}" 包含未支持的关键连接字段 '${key}'，无法确保安全导出。`
        nodeDiagnostics.push({
          severity: 'error',
          formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
          field: key,
          code: 'unsupported_connection_field',
          message: msg,
        })
        parseIssues.push({ kind: 'unsupported', label: name, field: key, message: msg })
        warnings.push(msg)
        continue
      }
      const msg = `节点 "${name}" 包含未知字段 '${key}'，导出时不会保留。`
      nodeDiagnostics.push({
        severity: 'warning',
        formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
        field: key,
        code: 'unknown_yaml_field',
        message: msg,
      })
      warnings.push(msg)
    }
  }

  if (type === 'vless') {
    for (const k of [
      'uuid',
      'flow',
      'servername',
      'sni',
      'client-fingerprint',
      'fingerprint',
      'public-key',
      'network',
      'header-type',
      'headerType',
      'tls',
      'skip-cert-verify',
      'alpn',
      'reality-opts',
      'ws-opts',
      'grpc-opts',
      'packet-encoding',
      'encryption',
    ]) {
      protocolSpecificKeys.add(k)
    }

    const uuid = readStrictString(proxy, 'uuid', name)
    const flow = readStrictString(proxy, 'flow', name)
    const sni = readStrictString(proxy, 'servername', name) ?? readStrictString(proxy, 'sni', name)
    const fp =
      readStrictString(proxy, 'client-fingerprint', name) ?? readStrictString(proxy, 'fingerprint', name)
    const network = (readStrictString(proxy, 'network', name) ?? 'tcp').toLowerCase()
    const headerType = readStrictString(proxy, 'header-type', name) ?? readStrictString(proxy, 'headerType', name)
    const packetEncoding = readStrictString(proxy, 'packet-encoding', name)
    const encryption = readStrictString(proxy, 'encryption', name)

    const realityOptsRaw = proxy['reality-opts']
    const realityOpts = isYamlObject(realityOptsRaw) ? realityOptsRaw : undefined
    if (realityOptsRaw !== undefined && !realityOpts) {
      hasFieldTypeError = true
      const msg = `节点 "${name}" 的 reality-opts 格式无效。`
      parseIssues.push({ kind: 'invalid', label: name, field: 'reality-opts', message: msg })
      warnings.push(msg)
    }

    const pbk =
      (realityOpts
        ? readStrictString(realityOpts, 'public-key', `${name}.reality-opts`, 'reality-opts.public-key')
        : undefined) ?? readStrictString(proxy, 'public-key', name)
    const sid = realityOpts
      ? readStrictString(realityOpts, 'short-id', `${name}.reality-opts`, 'reality-opts.short-id')
      : undefined

    if (realityOpts) {
      for (const rk of Object.keys(realityOpts)) {
        if (rk !== 'public-key' && rk !== 'short-id') {
          nodeDiagnostics.push({
            severity: 'warning',
            formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
            field: `reality-opts.${rk}`,
            code: 'unknown_yaml_field',
            message: `节点 "${name}" 包含未知 reality-opts 字段 '${rk}'。`,
          })
        }
      }
    }

    const rawTls = asBoolean(proxy.tls)
    if (proxy.tls !== undefined && rawTls === undefined) {
      hasFieldTypeError = true
      const msg = `节点 "${name}" 的 tls 字段必须是布尔值。`
      parseIssues.push({ kind: 'invalid', label: name, field: 'tls', message: msg })
      warnings.push(msg)
    }

    let security: VlessSecurity = 'none'
    if (realityOpts || pbk) {
      security = 'reality'
      if (rawTls === false) {
        nodeDiagnostics.push({
          severity: 'error',
          formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
          field: 'tls',
          code: 'reality_requires_tls',
          message: `节点 "${name}" 配置了 reality-opts 但 tls 为 false，两者冲突。`,
        })
      }
      if (!pbk) {
        nodeDiagnostics.push({
          severity: 'error',
          formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
          field: 'reality-opts.public-key',
          code: 'missing_reality_public_key',
          message: `VLESS Reality 节点 "${name}" 缺少 public-key。`,
        })
      }
    } else if (rawTls === true) {
      security = 'tls'
    }

    let wsOpts: VlessWsOpts | undefined
    if (proxy['ws-opts'] !== undefined) {
      const rawWsOpts = proxy['ws-opts']
      if (!isYamlObject(rawWsOpts)) {
        hasFieldTypeError = true
        const msg = `节点 "${name}" 的 ws-opts 格式无效。`
        parseIssues.push({ kind: 'invalid', label: name, field: 'ws-opts', message: msg })
        warnings.push(msg)
      } else {
        const wsPath = readStrictString(rawWsOpts, 'path', `${name}.ws-opts`)
        const earlyDataHeaderName = readStrictString(
          rawWsOpts,
          'early-data-header-name',
          `${name}.ws-opts`,
        )
        const maxEarlyData =
          typeof rawWsOpts['max-early-data'] === 'number' ? rawWsOpts['max-early-data'] : undefined
        const v2rayHttpUpgrade = asBoolean(rawWsOpts['v2ray-http-upgrade'])
        let headers: Record<string, string> | undefined
        if (rawWsOpts.headers !== undefined) {
          if (!isYamlObject(rawWsOpts.headers)) {
            hasFieldTypeError = true
            const msg = `节点 "${name}" 的 ws-opts.headers 格式无效。`
            parseIssues.push({ kind: 'invalid', label: name, field: 'ws-opts.headers', message: msg })
            warnings.push(msg)
          } else {
            const entries: Array<[string, string]> = []
            for (const hk of Object.keys(rawWsOpts.headers)) {
              const hv = readStrictString(rawWsOpts.headers, hk, `${name}.ws-opts.headers`)
              if (hv !== undefined) {
                entries.push([hk, hv])
              }
            }
            if (entries.length > 0) {
              headers = Object.fromEntries(entries)
            }
          }
        }
        wsOpts = dropUndefined({
          path: wsPath,
          headers,
          maxEarlyData,
          earlyDataHeaderName,
          v2rayHttpUpgrade,
        })
      }
    }

    let grpcOpts: VlessGrpcOpts | undefined
    if (proxy['grpc-opts'] !== undefined) {
      const rawGrpcOpts = proxy['grpc-opts']
      if (!isYamlObject(rawGrpcOpts)) {
        hasFieldTypeError = true
        const msg = `节点 "${name}" 的 grpc-opts 格式无效。`
        parseIssues.push({ kind: 'invalid', label: name, field: 'grpc-opts', message: msg })
        warnings.push(msg)
      } else {
        const serviceName = readStrictString(
          rawGrpcOpts,
          'grpc-service-name',
          `${name}.grpc-opts`,
        )
        if (serviceName !== undefined) {
          grpcOpts = { serviceName }
        }
      }
    }

    if (!SUPPORTED_VLESS_TRANSPORTS.has(network)) {
      nodeDiagnostics.push({
        severity: 'error',
        formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
        field: 'network',
        code: 'unsupported_transport',
        message: `VLESS 传输类型 '${network}' 尚未受支持，不会降级为 tcp。`,
      })
    }

    if (encryption && encryption.toLowerCase() !== 'none') {
      nodeDiagnostics.push({
        severity: 'error',
        formats: ['clash-mihomo', 'clash-snippet', 'xray-json', 'import-links'],
        field: 'encryption',
        code: 'unsupported_vless_encryption',
        message: `VLESS encryption '${encryption}' 尚未受支持（仅支持 none）。`,
      })
    }

    const alpn = readStringArray(proxy.alpn)
    checkUnknownKeys()

    if (!uuid || hasFieldTypeError) {
      if (!uuid && !hasFieldTypeError) {
        const msg = `VLESS 节点 "${name}" 缺少 uuid。`
        parseIssues.push({ kind: 'invalid', label: name, field: 'uuid', message: msg })
        warnings.push(msg)
      }
      return { kind: 'invalid', issues: parseIssues, warnings }
    }

    const hardUnsupported = nodeDiagnostics.find(
      (diag) =>
        diag.severity === 'error' &&
        (diag.code === 'unsupported_transport' ||
          diag.code === 'unsupported_vless_encryption' ||
          diag.code === 'unsupported_connection_field'),
    )
    if (hardUnsupported) {
      warnings.push(hardUnsupported.message)
      return {
        kind: 'unsupported',
        issues: [
          ...parseIssues,
          {
            kind: 'unsupported',
            label: name,
            field: hardUnsupported.field,
            message: hardUnsupported.message,
          },
        ],
        warnings,
      }
    }

    const draft: Omit<VlessProxyNode, 'id'> = {
      type: 'vless',
      name,
      server,
      port,
      uuid,
      security,
      encryption,
      flow,
      sni,
      fp,
      pbk,
      sid,
      skipCertVerify: asBoolean(proxy['skip-cert-verify']),
      alpn,
      packetType: network,
      headerType,
      wsOpts,
      grpcOpts,
      packetEncoding,
      udp: asBoolean(proxy.udp),
      raw,
      ...(nodeDiagnostics.length > 0 ? { issues: nodeDiagnostics } : {}),
    }

    return {
      kind: 'valid',
      node: { ...draft, id: computeStableNodeId(draft) },
      issues: parseIssues,
      warnings,
    }
  }

  if (type === 'socks5') {
    for (const k of ['username', 'password', 'tls', 'servername', 'sni', 'fingerprint', 'client-fingerprint', 'skip-cert-verify']) {
      protocolSpecificKeys.add(k)
    }

    const username = readStrictString(proxy, 'username', name)
    const password = readStrictString(proxy, 'password', name)
    const tls = asBoolean(proxy.tls)
    const sni = readStrictString(proxy, 'servername', name) ?? readStrictString(proxy, 'sni', name)
    const fp = readStrictString(proxy, 'fingerprint', name) ?? readStrictString(proxy, 'client-fingerprint', name)
    const skipCertVerify = asBoolean(proxy['skip-cert-verify'])
    checkUnknownKeys()

    if (hasFieldTypeError) {
      return { kind: 'invalid', issues: parseIssues, warnings }
    }

    const hardUnsupported = nodeDiagnostics.find(
      (diag) =>
        diag.severity === 'error' &&
        (diag.code === 'unsupported_transport' ||
          diag.code === 'unsupported_vless_encryption' ||
          diag.code === 'unsupported_connection_field'),
    )
    if (hardUnsupported) {
      warnings.push(hardUnsupported.message)
      return {
        kind: 'unsupported',
        issues: [
          ...parseIssues,
          {
            kind: 'unsupported',
            label: name,
            field: hardUnsupported.field,
            message: hardUnsupported.message,
          },
        ],
        warnings,
      }
    }

    const draft: Omit<Socks5ProxyNode, 'id'> = {
      type: 'socks5',
      name,
      server,
      port,
      username,
      password,
      udp: asBoolean(proxy.udp),
      tls,
      sni,
      fp,
      skipCertVerify,
      raw,
      ...(nodeDiagnostics.length > 0 ? { issues: nodeDiagnostics } : {}),
    }

    return {
      kind: 'valid',
      node: { ...draft, id: computeStableNodeId(draft) },
      issues: parseIssues,
      warnings,
    }
  }

  if (type === 'ss') {
    for (const k of ['cipher', 'password', 'plugin', 'plugin-opts', 'udp-over-tcp']) {
      protocolSpecificKeys.add(k)
    }

    const cipher = readStrictString(proxy, 'cipher', name)
    const password = readStrictString(proxy, 'password', name)
    const plugin = readStrictString(proxy, 'plugin', name)

    let pluginOpts: Record<string, ProxyScalar> | undefined
    if (proxy['plugin-opts'] !== undefined) {
      const rawPluginOpts = proxy['plugin-opts']
      if (!isYamlObject(rawPluginOpts)) {
        hasFieldTypeError = true
        const msg = `Shadowsocks 节点 "${name}" 的 plugin-opts 格式无效。`
        parseIssues.push({ kind: 'invalid', label: name, field: 'plugin-opts', message: msg })
        warnings.push(msg)
      } else {
        const stringExpectedKeys = new Set(['mode', 'host', 'path', 'password'])
        const collected: Record<string, ProxyScalar> = {}
        for (const [pk, pv] of Object.entries(rawPluginOpts)) {
          if (stringExpectedKeys.has(pk) && pv !== undefined && typeof pv !== 'string') {
            hasFieldTypeError = true
            const msg = `节点 "${name}" 的 plugin-opts.${pk} 被解析为 ${pv === null ? 'null' : typeof pv}，无法可靠还原原值（请加引号）。`
            parseIssues.push({ kind: 'invalid', label: name, field: `plugin-opts.${pk}`, message: msg })
            warnings.push(msg)
          } else if (typeof pv === 'string' || typeof pv === 'number' || typeof pv === 'boolean') {
            collected[pk] = pv
          }
        }
        if (Object.keys(collected).length > 0) {
          pluginOpts = collected
        }
      }
    }

    checkUnknownKeys()

    if (!cipher || !password || hasFieldTypeError) {
      if (!cipher && !hasFieldTypeError) {
        const msg = `Shadowsocks 节点 "${name}" 缺少 cipher。`
        parseIssues.push({ kind: 'invalid', label: name, field: 'cipher', message: msg })
        warnings.push(msg)
      }
      if (!password && !hasFieldTypeError) {
        const msg = `Shadowsocks 节点 "${name}" 缺少 password。`
        parseIssues.push({ kind: 'invalid', label: name, field: 'password', message: msg })
        warnings.push(msg)
      }
      return { kind: 'invalid', issues: parseIssues, warnings }
    }

    const hardUnsupported = nodeDiagnostics.find(
      (diag) =>
        diag.severity === 'error' &&
        (diag.code === 'unsupported_transport' ||
          diag.code === 'unsupported_vless_encryption' ||
          diag.code === 'unsupported_connection_field'),
    )
    if (hardUnsupported) {
      warnings.push(hardUnsupported.message)
      return {
        kind: 'unsupported',
        issues: [
          ...parseIssues,
          {
            kind: 'unsupported',
            label: name,
            field: hardUnsupported.field,
            message: hardUnsupported.message,
          },
        ],
        warnings,
      }
    }

    const draft: Omit<ShadowsocksProxyNode, 'id'> = {
      type: 'ss',
      name,
      server,
      port,
      cipher,
      password,
      plugin,
      pluginOpts,
      udp: asBoolean(proxy.udp),
      udpOverTcp: asBoolean(proxy['udp-over-tcp']),
      raw,
      ...(nodeDiagnostics.length > 0 ? { issues: nodeDiagnostics } : {}),
    }

    return {
      kind: 'valid',
      node: { ...draft, id: computeStableNodeId(draft) },
      issues: parseIssues,
      warnings,
    }
  }

  for (const k of [
    'password',
    'sni',
    'servername',
    'skip-cert-verify',
    'obfs',
    'obfs-password',
    'fingerprint',
    'alpn',
    'ports',
    'up',
    'down',
  ]) {
    protocolSpecificKeys.add(k)
  }

  const password = readStrictString(proxy, 'password', name)
  const sni = readStrictString(proxy, 'sni', name) ?? readStrictString(proxy, 'servername', name)
  const obfs = readStrictString(proxy, 'obfs', name)
  const obfsPassword = readStrictString(proxy, 'obfs-password', name)
  const fingerprint = readStrictString(proxy, 'fingerprint', name)
  const ports = readStrictString(proxy, 'ports', name)
  const up = readStrictString(proxy, 'up', name)
  const down = readStrictString(proxy, 'down', name)
  const alpn = readStringArray(proxy.alpn)
  checkUnknownKeys()

  if (hasFieldTypeError) {
    return { kind: 'invalid', issues: parseIssues, warnings }
  }

  const draft: Omit<Hysteria2ProxyNode, 'id'> = {
    type: 'hysteria2',
    name,
    server,
    port,
    password,
    sni,
    skipCertVerify: asBoolean(proxy['skip-cert-verify']),
    udp: asBoolean(proxy.udp),
    obfs,
    obfsPassword,
    fingerprint,
    alpn,
    ports,
    up,
    down,
    raw,
    ...(nodeDiagnostics.length > 0 ? { issues: nodeDiagnostics } : {}),
  }

  return {
    kind: 'valid',
    node: { ...draft, id: computeStableNodeId(draft) },
    issues: parseIssues,
    warnings,
  }
}

function normalizeType(type: string | undefined): ProxyNodeType | undefined {
  if (!type) {
    return undefined
  }
  if (HY2_TYPES.has(type)) {
    return 'hysteria2'
  }
  if (SUPPORTED_TYPES.has(type as ProxyNodeType)) {
    return type as ProxyNodeType
  }
  return undefined
}

function parseLooseYaml(yamlText: string): LooseYamlObject {
  const root: LooseYamlObject = {}
  const lines = yamlText.replace(/\t/g, '  ').split(/\r?\n/)
  const stack: Array<{ indent: number; value: LooseYamlObject | LooseYamlObject[] }> = [{ indent: -1, value: root }]

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex]
    const withoutComment = stripComment(rawLine)
    if (!withoutComment.trim()) {
      continue
    }

    const indent = countIndent(withoutComment)
    const line = withoutComment.trim()

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }

    const parent = stack[stack.length - 1].value

    if (line.startsWith('- ')) {
      const itemLine = line.slice(2).trim()
      const targetArray = ensureArrayParent(stack)
      const item = parseInlineYamlObject(itemLine)
      targetArray.push(item)
      stack.push({ indent, value: item })
      continue
    }

    const keyValue = splitYamlKeyValue(line)
    if (!keyValue || Array.isArray(parent)) {
      continue
    }

    const [key, rawValue] = keyValue
    if (rawValue === '') {
      const nextContainer: LooseYamlObject | LooseYamlObject[] = shouldBecomeArray(lines, lineIndex) ? [] : {}
      parent[key] = nextContainer
      stack.push({ indent, value: nextContainer })
      continue
    }

    parent[key] = parseYamlValue(rawValue)
  }

  return root
}

function ensureArrayParent(
  stack: Array<{ indent: number; value: LooseYamlObject | LooseYamlObject[] }>,
): LooseYamlObject[] {
  const parent = stack[stack.length - 1].value
  if (Array.isArray(parent)) {
    return parent
  }

  throw new Error('YAML 列表项没有对应的数组父节点。')
}

function shouldBecomeArray(allLines: string[], currentIndex: number): boolean {
  const currentRawLine = allLines[currentIndex]
  const currentIndent = countIndent(currentRawLine)

  for (let index = currentIndex + 1; index < allLines.length; index += 1) {
    const candidate = stripComment(allLines[index])
    if (!candidate.trim()) {
      continue
    }

    const indent = countIndent(candidate)
    if (indent <= currentIndent) {
      return false
    }
    return candidate.trim().startsWith('- ')
  }

  return false
}

function parseInlineYamlObject(itemLine: string): LooseYamlObject {
  if (!itemLine) {
    return {}
  }

  const pair = splitYamlKeyValue(itemLine)
  if (!pair) {
    return {}
  }

  const [key, value] = pair
  return { [key]: parseYamlValue(value) }
}

function splitYamlKeyValue(line: string): [string, string] | undefined {
  const separatorIndex = line.indexOf(':')
  if (separatorIndex < 0) {
    return undefined
  }

  const key = line.slice(0, separatorIndex).trim()
  const value = line.slice(separatorIndex + 1).trim()

  if (!key) {
    return undefined
  }

  return [unquote(key), value]
}

function parseYamlValue(value: string): LooseYamlValue {
  const trimmed = value.trim()
  const isQuoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))

  if (isQuoted) {
    return unquote(trimmed)
  }

  if (trimmed === '') {
    return ''
  }
  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === 'true'
  }
  if (/^null|~$/.test(trimmed)) {
    return null
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed)
  }

  return trimmed
}

function stripComment(line: string): string {
  let quote: string | undefined
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if ((char === '"' || char === "'") && line[index - 1] !== '\\') {
      quote = quote === char ? undefined : char
    }
    if (char === '#' && !quote && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index)
    }
  }
  return line
}

function countIndent(line: string): number {
  const match = line.match(/^ */)
  return match ? match[0].length : 0
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function addParam(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value !== undefined && value !== '') {
    params.set(key, value)
  }
}

function safeTag(name: string, fallback: string): string {
  const tag = name
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return tag || fallback
}

function resolveChainSelectionNames(
  entryNodes: NormalizedProxyNode[],
  exitNodes: NormalizedProxyNode[],
  options: ChainSelectionConfigOptions,
): { entryNames: string[]; exitNames: string[] } {
  const usedNames = new Set<string>(['DIRECT', 'REJECT', 'GLOBAL', '入口节点', 'PROXY'])
  const entryNames = entryNodes.map((entryNode, index) => {
    const requestedName = options.entryNodeNames?.[index] ?? entryNode.name
    return makeUniqueProxyName(requestedName, '入口', usedNames)
  })
  const exitNames = exitNodes.map((exitNode, index) => {
    const requestedName = options.exitNodeNames?.[index] ?? exitNode.name
    return makeUniqueProxyName(requestedName, '出口', usedNames)
  })

  return { entryNames, exitNames }
}

function resolveChainSelectionTags(
  entryNodes: NormalizedProxyNode[],
  exitNodes: NormalizedProxyNode[],
  options: ChainSelectionConfigOptions,
): { entryTags: string[]; exitTags: string[] } {
  const usedTags = new Set<string>()
  const entryTags = entryNodes.map((entryNode, index) => {
    const requestedName = options.entryNodeNames?.[index] ?? entryNode.name
    return makeUniqueProxyTag(requestedName, 'entry', usedTags)
  })
  const exitTags = exitNodes.map((exitNode, index) => {
    const requestedName = options.exitNodeNames?.[index] ?? exitNode.name
    return makeUniqueProxyTag(requestedName, 'exit', usedTags)
  })

  return { entryTags, exitTags }
}

function makeUniqueProxyName(baseName: string, role: string, usedNames = new Set<string>()): string {
  const readableBaseName = baseName.trim() || role
  let candidate = `${readableBaseName}-${role}`
  let index = 2

  while (usedNames.has(candidate)) {
    candidate = `${readableBaseName}-${role}-${index}`
    index += 1
  }

  usedNames.add(candidate)
  return candidate
}

function makeUniqueProxyTag(baseName: string, role: 'entry' | 'exit', usedTags = new Set<string>()): string {
  const readableBaseTag = safeTag(baseName, role)
  let candidate = `${readableBaseTag}-${role}`
  let index = 2

  while (usedTags.has(candidate)) {
    candidate = `${readableBaseTag}-${role}-${index}`
    index += 1
  }

  usedTags.add(candidate)
  return candidate
}

function dedupeNodes(nodes: NormalizedProxyNode[]): NormalizedProxyNode[] {
  const seen = new Set<string>()
  const result: NormalizedProxyNode[] = []

  for (const node of nodes) {
    if (!seen.has(node.id)) {
      seen.add(node.id)
      result.push(node)
    }
  }

  return result
}

function deduplicateDiagnostics(items: NodeDiagnostic[]): NodeDiagnostic[] {
  const seen = new Set<string>()
  const out: NodeDiagnostic[] = []
  for (const item of items) {
    const key = `${item.severity}|${item.code}|${item.field ?? ''}|${item.message}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function sortObjectKeys<T extends object>(value: T): Record<string, unknown> {
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
  const sorted: Record<string, unknown> = {}
  for (const [k, v] of entries) {
    if (v !== undefined) {
      sorted[k] = isYamlObject(v) ? sortObjectKeys(v) : v
    }
  }
  return sorted
}

function isYamlObject(value: unknown): value is LooseYamlObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isYamlObjectArray(value: unknown): value is LooseYamlObject[] {
  return Array.isArray(value) && value.every(isYamlObject)
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string' && /^(true|false)$/i.test(value)) {
    return value.toLowerCase() === 'true'
  }
  return undefined
}

function readStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const strs = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    return strs.length > 0 ? strs : undefined
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return undefined
}
