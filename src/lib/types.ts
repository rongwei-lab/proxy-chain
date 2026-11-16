export type ProxyNodeType = 'vless' | 'socks5' | 'hysteria2' | 'ss'
export type ProxyScalar = string | number | boolean
export type VlessSecurity = 'none' | 'tls' | 'reality'
export type TargetFormat = 'clash-mihomo' | 'clash-snippet' | 'xray-json' | 'import-links'
export type DiagnosticSeverity = 'error' | 'warning'

export interface NodeDiagnostic {
  severity: DiagnosticSeverity
  formats: TargetFormat[]
  field?: string
  code: string
  message: string
}

export interface VlessWsOpts {
  path?: string
  headers?: Record<string, string>
  maxEarlyData?: number
  earlyDataHeaderName?: string
  v2rayHttpUpgrade?: boolean
}

export interface VlessGrpcOpts {
  serviceName?: string
  mode?: string
}

export interface BaseProxyNode {
  id: string
  type: ProxyNodeType
  name: string
  server: string
  port: number
  raw?: string
  issues?: NodeDiagnostic[]
}

export interface VlessProxyNode extends BaseProxyNode {
  type: 'vless'
  uuid: string
  security: VlessSecurity
  encryption?: string
  flow?: string
  sni?: string
  fp?: string
  pbk?: string
  sid?: string
  spx?: string
  skipCertVerify?: boolean
  alpn?: string[]
  packetType?: string
  headerType?: string
  wsOpts?: VlessWsOpts
  grpcOpts?: VlessGrpcOpts
  packetEncoding?: string
  udp?: boolean
}

export interface Socks5ProxyNode extends BaseProxyNode {
  type: 'socks5'
  username?: string
  password?: string
  udp?: boolean
  tls?: boolean
  sni?: string
  fp?: string
  skipCertVerify?: boolean
}

export interface Hysteria2ProxyNode extends BaseProxyNode {
  type: 'hysteria2'
  password?: string
  sni?: string
  skipCertVerify?: boolean
  udp?: boolean
  obfs?: string
  obfsPassword?: string
  fingerprint?: string
  alpn?: string[]
  ports?: string
  up?: string
  down?: string
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

export type NormalizedProxyNode =
  | VlessProxyNode
  | Socks5ProxyNode
  | Hysteria2ProxyNode
  | ShadowsocksProxyNode

export type NormalizedProxyNodeWithoutId =
  | Omit<VlessProxyNode, 'id'>
  | Omit<Socks5ProxyNode, 'id'>
  | Omit<Hysteria2ProxyNode, 'id'>
  | Omit<ShadowsocksProxyNode, 'id'>

export interface ParseIssue {
  kind: 'unsupported' | 'invalid' | 'warning'
  label: string
  field?: string
  message: string
}

export interface ParseResult {
  nodes: NormalizedProxyNode[]
  warnings: string[]
}

export interface DetailedParseResult {
  nodes: NormalizedProxyNode[]
  validCount: number
  unsupportedCount: number
  invalidCount: number
  issues: ParseIssue[]
  warnings: string[]
}

export type SourceKind = 'subscription' | 'paste' | 'manual'
export type SourceStatus = 'idle' | 'loading' | 'success' | 'failed'

export interface NodeSource {
  id: string
  name: string
  kind: SourceKind
  nodeIds: string[]
  status: SourceStatus
  lastSuccessAt?: string
  errorMessage?: string
  parseStats?: {
    validCount: number
    unsupportedCount: number
    invalidCount: number
    issues: ParseIssue[]
  }
}

export interface ManagedNodeEntry {
  node: NormalizedProxyNode
  sourceIds: string[]
  sourceAliases: Record<string, string>
  displayName: string
  /**
   * 用户显式设置的显示别名。刷新订阅时按稳定连接 ID 关联并优先保留；
   * 未设置时 displayName 跟随来源提供的最新原始名称。
   */
  userAlias?: string
}

export type SelectionStrategy = 'select' | 'url-test' | 'fallback'
export type RoutingPreset = 'all-proxy' | 'cn-direct' | 'custom'
export type CustomRoutingMatchType = 'DOMAIN' | 'DOMAIN-SUFFIX' | 'DOMAIN-KEYWORD'

export interface StageProbeConfig {
  url: string
  intervalSeconds: number
  toleranceMs?: number
}

export interface ChainStage {
  id: string
  name: string
  enabled: boolean
  candidateNodeIds: string[]
  strategy: SelectionStrategy
  probe?: StageProbeConfig
}

export type CustomRoutingTarget =
  | { kind: 'plan'; planId: string }
  | { kind: 'direct' }
  | { kind: 'reject' }

export interface CustomRoutingRule {
  id: string
  matchType: CustomRoutingMatchType
  pattern: string
  target: CustomRoutingTarget
}

export interface NodeReferenceHint {
  id: string
  name: string
  type: ProxyNodeType
  server: string
  port: number
}

export interface ChainPlan {
  schemaVersion: 1
  id: string
  name: string
  mode: 'simple' | 'advanced'
  entry: ChainStage
  relays: ChainStage[]
  exit: ChainStage
  routingPreset: RoutingPreset
  customRules: CustomRoutingRule[]
  customFallbackTarget: CustomRoutingTarget
  nodeHints?: Record<string, NodeReferenceHint>
  hasInitializedSelection?: boolean
}

export interface ChainDiagnostic {
  severity: DiagnosticSeverity
  scope: 'plan' | 'stage' | 'node' | 'rule' | 'source'
  planId?: string
  stageId?: string
  nodeId?: string
  field?: string
  code: string
  message: string
}

export interface ChainPreviewCandidate {
  nodeId: string
  name: string
  type?: ProxyNodeType
  missing: boolean
}

export interface ChainPreviewStage {
  stageId: string
  role: 'entry' | 'relay' | 'exit'
  name: string
  strategy: SelectionStrategy
  isFinalExit: boolean
  candidates: ChainPreviewCandidate[]
  missingSelection: boolean
}

export interface ChainPreviewModel {
  stages: ChainPreviewStage[]
  finalExitStageName?: string
  routingPreset: RoutingPreset
  disabledStageNames: string[]
  hiddenRelayCount: number
  isComplete: boolean
}

export interface ChainExportResult {
  valid: boolean
  diagnostics: ChainDiagnostic[]
  output: string
  format: TargetFormat
  preview: ChainPreviewModel
  exportedNodeCount: number
  groupNames: string[]
}

export interface BatchPlanExportItem {
  planId: string
  planName: string
  fileName: string
  result: ChainExportResult
}

export interface SourceDeletionImpact {
  sourceId: string
  sourceName: string
  removedExclusiveNodeIds: string[]
  keptSharedNodeIds: string[]
  affectedPlans: Array<{
    planId: string
    planName: string
    stageNames: string[]
    brokenNodeIds: string[]
  }>
}

export interface SavedWorkspaceEnvelope {
  schemaVersion: 1
  savedAt: string
  includesCredentials: boolean
  activePlanId: string
  plans: ChainPlan[]
  sources: NodeSource[]
  nodes?: ManagedNodeEntry[]
}
