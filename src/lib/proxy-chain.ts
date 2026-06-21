import { parse as parseYamlDocument } from 'yaml'

export type ProxyNodeType = 'vless' | 'socks5' | 'hysteria2' | 'ss'
type ProxyScalar = string | number | boolean

export interface BaseProxyNode {
  id: string
  type: ProxyNodeType
  name: string
  server: string
  port: number
  raw?: string
}

export interface VlessProxyNode extends BaseProxyNode {
  type: 'vless'
  uuid: string
  flow?: string
  sni?: string
  fp?: string
  pbk?: string
  packetType?: string
  headerType?: string
}

export interface Socks5ProxyNode extends BaseProxyNode {
  type: 'socks5'
  username?: string
  password?: string
  udp?: boolean
}

export interface Hysteria2ProxyNode extends BaseProxyNode {
  type: 'hysteria2'
  password?: string
  sni?: string
  skipCertVerify?: boolean
  udp?: boolean
}

export interface ShadowsocksProxyNode extends BaseProxyNode {
  type: 'ss'
  cipher: string
  password: string
  plugin?: string
  pluginOpts?: Record<string, ProxyScalar>
  udp?: boolean
  udpOverTcp?: boolean
}

export type NormalizedProxyNode = VlessProxyNode | Socks5ProxyNode | Hysteria2ProxyNode | ShadowsocksProxyNode

type LooseYamlValue = string | number | boolean | undefined
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

export interface ParseResult {
  nodes: NormalizedProxyNode[]
  warnings: string[]
}

const HY2_TYPES = new Set(['hysteria2', 'hy2'])
const SUPPORTED_TYPES = new Set<ProxyNodeType>(['vless', 'socks5', 'hysteria2', 'ss'])

/**
 * 解析用户粘贴的链接或订阅文本。这里刻意不 fetch 远程订阅 URL：
 * 代理凭据、Reality public key、SOCKS 密码等敏感信息只应在浏览器本地处理。
 */
export function parseProxyInput(input: string): ParseResult {
  const text = input.trim()

  if (!text) {
    return { nodes: [], warnings: ['输入为空，未解析到代理节点。'] }
  }

  const warnings: string[] = []
  const nodes: NormalizedProxyNode[] = []

  for (const chunk of splitInput(text)) {
    if (chunk.startsWith('vless://')) {
      const parsed = parseVlessLink(chunk)
      if (parsed) {
        nodes.push(parsed)
      } else {
        warnings.push('发现 VLESS 链接，但链接格式不完整。')
      }
      continue
    }

    if (chunk.startsWith('socks5://')) {
      const parsed = parseSocks5Link(chunk)
      if (parsed) {
        nodes.push(parsed)
      } else {
        warnings.push('发现 SOCKS5 链接，但链接格式不完整。')
      }
      continue
    }

    if (chunk.startsWith('ss://')) {
      const parsed = parseShadowsocksLink(chunk)
      if (parsed) {
        nodes.push(parsed)
      } else {
        warnings.push('发现 Shadowsocks/SS 链接，但链接格式不完整。')
      }
      continue
    }

    if (chunk.startsWith('hysteria2://') || chunk.startsWith('hy2://')) {
      const parsed = parseHysteria2Link(chunk)
      if (parsed) {
        nodes.push(parsed)
      } else {
        warnings.push('发现 Hysteria2 链接，但链接格式不完整。')
      }
      continue
    }

    const yamlNodes = parseYamlProxies(chunk)
    if (yamlNodes.length > 0) {
      nodes.push(...yamlNodes)
      continue
    }

    warnings.push('有一段输入未能识别为 VLESS、SOCKS5、Hysteria2、Shadowsocks/SS 或受支持的 YAML 节点。')
  }

  return { nodes: dedupeNodes(nodes), warnings }
}

export function parseVlessLink(link: string): VlessProxyNode | undefined {
  try {
    const url = new URL(link)
    const uuid = decodeURIComponent(url.username)
    const server = url.hostname
    const port = parsePort(url.port)

    if (!uuid || !server || port === undefined) {
      return undefined
    }

    const params = url.searchParams
    const name = decodeName(url.hash, `${server}:${port}`)

    return {
      id: stableNodeId('vless', name, server, port, uuid),
      type: 'vless',
      name,
      server,
      port,
      uuid,
      flow: optionalParam(params, 'flow'),
      sni: optionalParam(params, 'sni') ?? optionalParam(params, 'servername'),
      fp: optionalParam(params, 'fp') ?? optionalParam(params, 'client-fingerprint'),
      pbk: optionalParam(params, 'pbk') ?? optionalParam(params, 'public-key'),
      packetType: optionalParam(params, 'type'),
      headerType: optionalParam(params, 'headerType') ?? optionalParam(params, 'header-type'),
      raw: link,
    }
  } catch {
    return undefined
  }
}

export function parseSocks5Link(link: string): Socks5ProxyNode | undefined {
  try {
    const url = new URL(link)
    const server = url.hostname
    const port = parsePort(url.port)

    if (!server || port === undefined) {
      return undefined
    }

    const username = decodeURIComponent(url.username)
    const password = decodeURIComponent(url.password)
    const name = decodeName(url.hash, `${server}:${port}`)

    return {
      id: stableNodeId('socks5', name, server, port, username),
      type: 'socks5',
      name,
      server,
      port,
      username: username || undefined,
      password: password || undefined,
      raw: link,
    }
  } catch {
    return undefined
  }
}

export function parseHysteria2Link(link: string): Hysteria2ProxyNode | undefined {
  try {
    const url = new URL(link)
    const server = url.hostname
    const port = parsePort(url.port)

    if (!server || port === undefined) {
      return undefined
    }

    const params = url.searchParams
    const password = decodeURIComponent(url.username || url.password)
    const name = decodeName(url.hash, `${server}:${port}`)

    return {
      id: stableNodeId('hysteria2', name, server, port, password),
      type: 'hysteria2',
      name,
      server,
      port,
      password: password || optionalParam(params, 'password'),
      sni: optionalParam(params, 'sni') ?? optionalParam(params, 'servername'),
      skipCertVerify: optionalBooleanParam(params, 'insecure') ?? optionalBooleanParam(params, 'skip-cert-verify'),
      udp: optionalBooleanParam(params, 'udp'),
      raw: link,
    }
  } catch {
    return undefined
  }
}

export function parseShadowsocksLink(link: string): ShadowsocksProxyNode | undefined {
  try {
    const [withoutHash, hash = ''] = link.split('#', 2)
    const nameFromHash = hash ? decodeURIComponent(hash).trim() : ''

    if (withoutHash.includes('@')) {
      const url = new URL(link)
      const userInfo = url.password
        ? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`
        : decodeBase64Url(decodeURIComponent(url.username))
      const separatorIndex = userInfo.indexOf(':')
      const cipher = separatorIndex >= 0 ? userInfo.slice(0, separatorIndex) : ''
      const password = separatorIndex >= 0 ? userInfo.slice(separatorIndex + 1) : ''
      const server = url.hostname
      const port = parsePort(url.port)

      if (!cipher || !password || !server || port === undefined) {
        return undefined
      }

      return buildShadowsocksNode({
        cipher,
        password,
        server,
        port,
        name: nameFromHash || decodeName(url.hash, `${server}:${port}`),
        params: url.searchParams,
        raw: link,
      })
    }

    const [withoutQuery, rawQuery = ''] = withoutHash.slice('ss://'.length).split('?', 2)
    const decoded = decodeBase64Url(withoutQuery)
    const parsed = parseShadowsocksAuthority(decoded)
    if (!parsed) {
      return undefined
    }

    return buildShadowsocksNode({
      ...parsed,
      name: nameFromHash || `${parsed.server}:${parsed.port}`,
      params: new URLSearchParams(rawQuery),
      raw: link,
    })
  } catch {
    return undefined
  }
}

export function parseYamlProxies(yamlText: string): NormalizedProxyNode[] {
  let parsed: LooseYamlObject | LooseYamlObject[]

  try {
    const document = parseYamlDocument(yamlText) as unknown
    parsed = isYamlObject(document) || isYamlObjectArray(document) ? document : parseLooseYaml(yamlText)
  } catch {
    try {
      parsed = parseLooseYaml(yamlText)
    } catch {
      // 订阅文本可能包含当前工具不支持的 YAML 结构；解析失败时返回空数组，让上层给出可读 warning。
      return []
    }
  }

  const proxies = readProxyEntries(parsed)

  return proxies
    .map((proxy) => normalizeYamlProxy(proxy, yamlText))
    .filter((node): node is NormalizedProxyNode => Boolean(node))
}

export interface ChainConfigOptions {
  entryNodeName?: string
  exitNodeName?: string
}

export function generateClashYaml(
  entryNode: NormalizedProxyNode,
  exitNode: NormalizedProxyNode,
  options: ChainConfigOptions = {},
): string {
  const { entryName, exitName } = resolveChainNames(entryNode, exitNode, options)
  const entryGroupName = '入口节点'
  const entryProxy = toClashProxy(entryNode, entryName)
  const exitProxy = {
    ...toClashProxy(exitNode, exitName),
    // Clash/Mihomo 的 relay 策略已废弃且兼容性差；链式出口应直接用 dialer-proxy 指向入口节点。
    'dialer-proxy': entryGroupName,
  }
  const config: LooseYamlObject = {
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
    proxies: [entryProxy, exitProxy],
    'proxy-groups': [
      {
        name: entryGroupName,
        type: 'select',
        proxies: [entryName],
      },
      {
        name: 'PROXY',
        type: 'select',
        proxies: [exitName],
      },
    ],
    rules: ['GEOIP,CN,DIRECT', 'MATCH,PROXY'],
  }

  return stringifyYaml(config)
}

export function generateXrayJson(
  entryNode: NormalizedProxyNode,
  exitNode: NormalizedProxyNode,
  options: ChainConfigOptions = {},
): string {
  const { entryTag, exitTag } = resolveChainTags(entryNode, exitNode, options)
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
      {
        ...toXrayOutbound(exitNode, exitTag),
        // v2rayN/Xray 自定义 JSON 的链式写法是 proxySettings.tag，而不是 Clash relay。
        proxySettings: { tag: entryTag },
      },
      toXrayOutbound(entryNode, entryTag),
    ],
  }

  return JSON.stringify(config, null, 2)
}

export function generateImportLinks(nodes: NormalizedProxyNode[]): string {
  return nodes.map((node) => toImportLink(node)).join('\n')
}

function splitInput(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const linkOnly = lines.every((line) => isSupportedProxyLink(line))
  if (linkOnly) {
    return lines
  }

  return [text]
}

function isSupportedProxyLink(line: string): boolean {
  return (
    line.startsWith('vless://') ||
    line.startsWith('socks5://') ||
    line.startsWith('ss://') ||
    line.startsWith('hysteria2://') ||
    line.startsWith('hy2://')
  )
}

function decodeName(hash: string, fallback: string): string {
  if (!hash) {
    return fallback
  }

  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  return decodeURIComponent(raw).trim() || fallback
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

  const server = hostPort.slice(0, portSeparatorIndex)
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
  return {
    id: stableNodeId('ss', name, server, port, password),
    type: 'ss',
    name,
    server,
    port,
    cipher,
    password,
    plugin: optionalParam(params, 'plugin'),
    raw,
  }
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  return atob(padded)
}

function encodeBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function parsePort(value: string | number | undefined): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value)
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

  if (isYamlObject(parsed) && parsed.type && parsed.server && parsed.port) {
    return [parsed as ClashProxyEntry]
  }

  return []
}

function normalizeYamlProxy(proxy: ClashProxyEntry, raw: string): NormalizedProxyNode | undefined {
  const originalType = asString(proxy.type)?.toLowerCase()
  const type = normalizeType(originalType)
  const server = asString(proxy.server)
  const port = parsePort(proxy.port as string | number | undefined)
  const name = asString(proxy.name) ?? (server && port ? `${server}:${port}` : undefined)

  if (!type || !server || port === undefined || !name) {
    return undefined
  }

  if (type === 'vless') {
    const uuid = asString(proxy.uuid)
    if (!uuid) {
      return undefined
    }

    const realityOpts = isYamlObject(proxy['reality-opts']) ? proxy['reality-opts'] : undefined
    const node: VlessProxyNode = {
      id: stableNodeId('vless', name, server, port, uuid),
      type: 'vless',
      name,
      server,
      port,
      uuid,
      flow: asString(proxy.flow),
      sni: asString(proxy.servername) ?? asString(proxy.sni),
      fp: asString(proxy['client-fingerprint']),
      pbk: asString(realityOpts?.['public-key']) ?? asString(proxy['public-key']),
      packetType: asString(proxy.network),
      headerType: asString(proxy['header-type']) ?? asString(proxy.headerType),
      raw,
    }
    return node
  }

  if (type === 'socks5') {
    return {
      id: stableNodeId('socks5', name, server, port, asString(proxy.username) ?? ''),
      type: 'socks5',
      name,
      server,
      port,
      username: asString(proxy.username),
      password: asString(proxy.password),
      udp: asBoolean(proxy.udp),
      raw,
    }
  }

  if (type === 'ss') {
    const cipher = asString(proxy.cipher)
    const password = asString(proxy.password)
    if (!cipher || !password) {
      return undefined
    }

    return {
      id: stableNodeId('ss', name, server, port, password),
      type: 'ss',
      name,
      server,
      port,
      cipher,
      password,
      plugin: asString(proxy.plugin),
      pluginOpts: readScalarRecord(proxy['plugin-opts']),
      udp: asBoolean(proxy.udp),
      udpOverTcp: asBoolean(proxy['udp-over-tcp']),
      raw,
    }
  }

  return {
    id: stableNodeId('hysteria2', name, server, port, asString(proxy.password) ?? ''),
    type: 'hysteria2',
    name,
    server,
    port,
    password: asString(proxy.password),
    sni: asString(proxy.sni) ?? asString(proxy.servername),
    skipCertVerify: asBoolean(proxy['skip-cert-verify']),
    udp: asBoolean(proxy.udp),
    raw,
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
  const cleaned = unquote(value.trim())

  if (cleaned === '') {
    return ''
  }
  if (/^(true|false)$/i.test(cleaned)) {
    return cleaned.toLowerCase() === 'true'
  }
  if (/^-?\d+$/.test(cleaned)) {
    return Number(cleaned)
  }

  return cleaned
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

function toClashProxy(node: NormalizedProxyNode, name: string): LooseYamlObject {
  const common = {
    name,
    type: node.type,
    server: node.server,
    port: node.port,
  }

  if (node.type === 'vless') {
    return dropUndefined({
      ...common,
      uuid: node.uuid,
      flow: node.flow,
      servername: node.sni,
      'client-fingerprint': node.fp,
      network: node.packetType ?? 'tcp',
      tls: true,
      'reality-opts': node.pbk
        ? {
            'public-key': node.pbk,
          }
        : undefined,
    })
  }

  if (node.type === 'socks5') {
    return dropUndefined({
      ...common,
      username: node.username,
      password: node.password,
      udp: node.udp ?? true,
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
  })
}

function toXrayOutbound(node: NormalizedProxyNode, tag: string): Record<string, unknown> {
  if (node.type === 'vless') {
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
                encryption: 'none',
                flow: node.flow,
              }),
            ],
          },
        ],
      },
      streamSettings: dropUndefined({
        network: node.packetType ?? 'tcp',
        security: 'reality',
        realitySettings: dropUndefined({
          serverName: node.sni,
          fingerprint: node.fp,
          publicKey: node.pbk,
          spiderX: '/',
        }),
      }),
    }
  }

  if (node.type === 'socks5') {
    const server = dropUndefined({
      address: node.server,
      port: node.port,
      users:
        node.username || node.password
          ? [
              {
                user: node.username ?? '',
                pass: node.password ?? '',
              },
            ]
          : undefined,
    })

    return {
      tag,
      protocol: 'socks',
      settings: {
        servers: [server],
      },
    }
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

  return {
    tag,
    protocol: 'hysteria2',
    settings: {
      servers: [
        dropUndefined({
          address: node.server,
          port: node.port,
          password: node.password,
        }),
      ],
    },
    streamSettings: dropUndefined({
      security: 'tls',
      tlsSettings: dropUndefined({
        serverName: node.sni,
        allowInsecure: node.skipCertVerify,
      }),
    }),
  }
}

function toImportLink(node: NormalizedProxyNode): string {
  if (node.type === 'vless') {
    const params = new URLSearchParams()
    addParam(params, 'encryption', 'none')
    addParam(params, 'security', node.pbk ? 'reality' : undefined)
    addParam(params, 'flow', node.flow)
    addParam(params, 'sni', node.sni)
    addParam(params, 'fp', node.fp)
    addParam(params, 'pbk', node.pbk)
    addParam(params, 'type', node.packetType ?? 'tcp')
    addParam(params, 'headerType', node.headerType)

    const query = params.toString()
    return `vless://${encodeURIComponent(node.uuid)}@${node.server}:${node.port}${query ? `?${query}` : ''}#${encodeURIComponent(node.name)}`
  }

  if (node.type === 'socks5') {
    const auth =
      node.username || node.password
        ? `${encodeURIComponent(node.username ?? '')}:${encodeURIComponent(node.password ?? '')}@`
        : ''
    return `socks5://${auth}${node.server}:${node.port}#${encodeURIComponent(node.name)}`
  }

  if (node.type === 'ss') {
    const userInfo = encodeBase64Url(`${node.cipher}:${node.password}`)
    const params = new URLSearchParams()
    addParam(params, 'plugin', node.plugin)
    const query = params.toString()
    return `ss://${userInfo}@${node.server}:${node.port}${query ? `?${query}` : ''}#${encodeURIComponent(node.name)}`
  }

  const params = new URLSearchParams()
  addParam(params, 'sni', node.sni)
  addParam(params, 'insecure', node.skipCertVerify === undefined ? undefined : String(node.skipCertVerify))
  const query = params.toString()
  const auth = node.password ? `${encodeURIComponent(node.password)}@` : ''
  return `hysteria2://${auth}${node.server}:${node.port}${query ? `?${query}` : ''}#${encodeURIComponent(node.name)}`
}

function addParam(params: URLSearchParams, key: string, value: string | undefined): void {
  if (value !== undefined && value !== '') {
    params.set(key, value)
  }
}

function stringifyYaml(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent)

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (isYamlObject(item)) {
          const entries = Object.entries(item)
          if (entries.length === 0) {
            return `${pad}- {}`
          }

          const [firstKey, firstValue] = entries[0]
          const firstLine = `${pad}- ${firstKey}: ${formatYamlScalar(firstValue)}`
          const rest = entries
            .slice(1)
            .map(([key, nested]) => stringifyYamlEntry(key, nested, indent + 2))
            .join('\n')

          return rest ? `${firstLine}\n${rest}` : firstLine
        }

        return `${pad}- ${formatYamlScalar(item)}`
      })
      .join('\n')
  }

  if (isYamlObject(value)) {
    return Object.entries(value)
      .map(([key, nested]) => stringifyYamlEntry(key, nested, indent))
      .join('\n')
  }

  return `${pad}${formatYamlScalar(value)}`
}

function stringifyYamlEntry(key: string, value: unknown, indent: number): string {
  const pad = ' '.repeat(indent)

  if (Array.isArray(value) || isYamlObject(value)) {
    return `${pad}${key}:\n${stringifyYaml(value, indent + 2)}`
  }

  return `${pad}${key}: ${formatYamlScalar(value)}`
}

function formatYamlScalar(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  const stringValue = String(value ?? '')
  if (stringValue === '' || /[:#,[\]{}&*!|>'"%@`]/.test(stringValue) || /\s/.test(stringValue)) {
    return JSON.stringify(stringValue)
  }
  return stringValue
}

function stableNodeId(type: ProxyNodeType, name: string, server: string, port: number, secretHint: string): string {
  const source = `${type}|${name}|${server}|${port}|${secretHint}`
  let hash = 0
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0
  }
  return `${type}-${hash.toString(36)}`
}

function safeTag(name: string, fallback: string): string {
  const tag = name
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return tag || fallback
}

function resolveChainNames(
  entryNode: NormalizedProxyNode,
  exitNode: NormalizedProxyNode,
  options: ChainConfigOptions,
): { entryName: string; exitName: string } {
  const requestedEntryName = options.entryNodeName ?? entryNode.name
  const requestedExitName = options.exitNodeName ?? exitNode.name
  const entryName = makeUniqueProxyName(requestedEntryName, '入口')
  const exitName = makeUniqueProxyName(requestedExitName, '出口', new Set([entryName]))

  return { entryName, exitName }
}

function resolveChainTags(
  entryNode: NormalizedProxyNode,
  exitNode: NormalizedProxyNode,
  options: ChainConfigOptions,
): { entryTag: string; exitTag: string } {
  const requestedEntryName = options.entryNodeName ?? entryNode.name
  const requestedExitName = options.exitNodeName ?? exitNode.name
  const entryTag = makeUniqueProxyTag(requestedEntryName, 'entry')
  const exitTag = makeUniqueProxyTag(requestedExitName, 'exit', new Set([entryTag]))

  return { entryTag, exitTag }
}

function makeUniqueProxyName(baseName: string, role: '入口' | '出口', usedNames = new Set<string>()): string {
  const readableBaseName = baseName.trim() || role
  let candidate = `${readableBaseName}-${role}`
  let index = 2

  // Clash/Mihomo 在 proxies 列表里要求 name 全局唯一；订阅节点常有同名情况，
  // 因此导出链式配置时主动加角色后缀，避免 Clash Verge 校验报 duplicate name。
  while (usedNames.has(candidate)) {
    candidate = `${readableBaseName}-${role}-${index}`
    index += 1
  }

  return candidate
}

function makeUniqueProxyTag(baseName: string, role: 'entry' | 'exit', usedTags = new Set<string>()): string {
  const readableBaseTag = safeTag(baseName, role)
  let candidate = `${readableBaseTag}-${role}`
  let index = 2

  // Xray outbound tag 也需要全局唯一；使用英文角色后缀，避免中文后缀在 safeTag 中被清理。
  while (usedTags.has(candidate)) {
    candidate = `${readableBaseTag}-${role}-${index}`
    index += 1
  }

  return candidate
}

function dedupeNodes(nodes: NormalizedProxyNode[]): NormalizedProxyNode[] {
  const seen = new Set<string>()
  const result: NormalizedProxyNode[] = []

  for (const node of nodes) {
    const key = `${node.type}|${node.server}|${node.port}|${node.name}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push(node)
    }
  }

  return result
}

function dropUndefined<T extends LooseYamlObject | Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function isYamlObject(value: unknown): value is LooseYamlObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isYamlObjectArray(value: unknown): value is LooseYamlObject[] {
  return Array.isArray(value) && value.every(isYamlObject)
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number') {
    return String(value)
  }
  return undefined
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

function readScalarRecord(value: unknown): Record<string, ProxyScalar> | undefined {
  if (!isYamlObject(value)) {
    return undefined
  }

  const entries = Object.entries(value).filter((entry): entry is [string, ProxyScalar] => {
    const [, item] = entry
    return typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
  })

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}
