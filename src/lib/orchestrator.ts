import {
  PROTOCOL_CAPABILITY_MATRIX,
  stringifyYamlConfig,
  toClashProxy,
  toImportLink,
  toXrayOutbound,
  validateNodeForFormat,
} from './proxy-chain'
import type {
  BatchPlanExportItem,
  ChainDiagnostic,
  ChainExportResult,
  ChainPlan,
  ChainPreviewModel,
  ChainPreviewStage,
  ChainStage,
  CustomRoutingRule,
  CustomRoutingTarget,
  ManagedNodeEntry,
  NodeDiagnostic,
  NodeReferenceHint,
  NodeSource,
  NormalizedProxyNode,
  ParseIssue,
  ProxyScalar,
  SavedWorkspaceEnvelope,
  SelectionStrategy,
  SourceDeletionImpact,
  StageProbeConfig,
  TargetFormat,
  VlessGrpcOpts,
  VlessSecurity,
  VlessWsOpts,
} from './types'

export const MAX_ENABLED_CHAIN_LAYERS = 5
export const WORKSPACE_SCHEMA_VERSION = 1 as const
export const MAX_PLAN_FILE_BYTES = 2 * 1024 * 1024
export const PLAN_FILE_TOO_LARGE_MESSAGE = '方案文件体积超过 2 MiB 上限。'

export const DEFAULT_PROBE_CONFIG: StageProbeConfig = {
  url: 'https://www.gstatic.com/generate_204',
  intervalSeconds: 300,
  toleranceMs: 50,
}

const RESERVED_CLASH_NAMES = new Set(['DIRECT', 'REJECT', 'GLOBAL'])

/**
 * 节点注册表、节点提示等字典的键来自导入文件等外部输入。
 * `constructor` / `toString` 等键会命中普通对象的原型属性，`__proto__` 的普通赋值
 * 还会改写原型而不是写入自有属性。因此所有读取都必须限定自有属性，
 * 所有写入都通过 defineProperty 落为自有数据属性。
 */
function hasOwnKey(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key)
}

export function readRegistryEntry(
  registry: Record<string, ManagedNodeEntry>,
  nodeId: string,
): ManagedNodeEntry | undefined {
  return hasOwnKey(registry, nodeId) ? registry[nodeId] : undefined
}

export function readNodeHint(
  hints: Record<string, NodeReferenceHint> | undefined,
  nodeId: string,
): NodeReferenceHint | undefined {
  if (!hints || !hasOwnKey(hints, nodeId)) {
    return undefined
  }
  return hints[nodeId]
}

function readSourceAlias(
  aliases: Record<string, string>,
  sourceId: string,
): string | undefined {
  return hasOwnKey(aliases, sourceId) ? aliases[sourceId] : undefined
}

function setOwnEntry<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

/** 用受校验的节点条目构建注册表，保证特殊标识也是自有数据属性。 */
export function createRegistryFromEntries(
  entries: ManagedNodeEntry[],
): Record<string, ManagedNodeEntry> {
  const registry: Record<string, ManagedNodeEntry> = {}
  for (const item of entries) {
    setOwnEntry(registry, item.node.id, item)
  }
  return registry
}

export function createDefaultStage(
  id: string,
  name: string,
  enabled = true,
  strategy: SelectionStrategy = 'select',
): ChainStage {
  return {
    id,
    name,
    enabled,
    candidateNodeIds: [],
    strategy,
    probe: { ...DEFAULT_PROBE_CONFIG },
  }
}

export function createDefaultChainPlan(id = 'plan-default', name = '默认方案'): ChainPlan {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id,
    name,
    mode: 'simple',
    entry: createDefaultStage('stage-entry', '入口节点', true, 'select'),
    relays: [],
    exit: createDefaultStage('stage-exit', '出口节点', true, 'select'),
    routingPreset: 'cn-direct',
    customRules: [],
    customFallbackTarget: { kind: 'plan', planId: id },
    nodeHints: {},
    hasInitializedSelection: false,
  }
}

export function duplicateChainPlan(source: ChainPlan, newId: string, newName: string): ChainPlan {
  return {
    ...structuredClone(source),
    id: newId,
    name: newName,
    customFallbackTarget:
      source.customFallbackTarget.kind === 'plan' && source.customFallbackTarget.planId === source.id
        ? { kind: 'plan', planId: newId }
        : structuredClone(source.customFallbackTarget),
  }
}

export function syncPlanNodeHints(
  plan: ChainPlan,
  registry: Record<string, ManagedNodeEntry>,
): ChainPlan {
  const nextHints: Record<string, NodeReferenceHint> = { ...(plan.nodeHints ?? {}) }
  const allStageIds = [
    ...plan.entry.candidateNodeIds,
    ...plan.relays.flatMap((relay) => relay.candidateNodeIds),
    ...plan.exit.candidateNodeIds,
  ]

  for (const nodeId of allStageIds) {
    const entry = readRegistryEntry(registry, nodeId)
    if (entry) {
      setOwnEntry(nextHints, nodeId, {
        id: nodeId,
        name: entry.displayName,
        type: entry.node.type,
        server: entry.node.server,
        port: entry.node.port,
      })
    }
  }

  return {
    ...plan,
    nodeHints: nextHints,
  }
}

export function upsertSourceNodes(
  registry: Record<string, ManagedNodeEntry>,
  sources: NodeSource[],
  incomingSource: NodeSource,
  parsedNodes: NormalizedProxyNode[],
): { registry: Record<string, ManagedNodeEntry>; sources: NodeSource[] } {
  const nextRegistry: Record<string, ManagedNodeEntry> = {}
  // 仅由本次来源提供的节点会先被摘除；按稳定连接 ID 暂存，
  // 相同连接重新出现时据此恢复用户别名等身份信息，而不是当成全新节点。
  const detachedById: Record<string, ManagedNodeEntry> = {}

  for (const [nodeId, entry] of Object.entries(registry)) {
    const remainingSourceIds = entry.sourceIds.filter((id) => id !== incomingSource.id)
    if (remainingSourceIds.length > 0) {
      const nextAliases = { ...entry.sourceAliases }
      delete nextAliases[incomingSource.id]
      setOwnEntry(nextRegistry, nodeId, {
        ...entry,
        sourceIds: remainingSourceIds,
        sourceAliases: nextAliases,
      })
    } else {
      setOwnEntry(detachedById, nodeId, entry)
    }
  }

  const dedupedIds: string[] = []
  const seenIds = new Set<string>()

  for (const node of parsedNodes) {
    if (!seenIds.has(node.id)) {
      seenIds.add(node.id)
      dedupedIds.push(node.id)
    }

    const existing = readRegistryEntry(nextRegistry, node.id)
    if (existing) {
      // 连接未变化的共享节点：更新解析数据与来源原始别名，保留当前显示身份。
      const nextAliases = { ...existing.sourceAliases }
      setOwnEntry(nextAliases, incomingSource.id, node.name)
      setOwnEntry(nextRegistry, node.id, {
        ...existing,
        node,
        sourceIds: existing.sourceIds.includes(incomingSource.id)
          ? existing.sourceIds
          : [...existing.sourceIds, incomingSource.id],
        sourceAliases: nextAliases,
      })
    } else {
      const detached = hasOwnKey(detachedById, node.id) ? detachedById[node.id] : undefined
      const userAlias = detached?.userAlias
      const sourceAliases: Record<string, string> = {}
      setOwnEntry(sourceAliases, incomingSource.id, node.name)
      setOwnEntry(nextRegistry, node.id, {
        node,
        sourceIds: [incomingSource.id],
        sourceAliases,
        displayName: userAlias ?? node.name,
        ...(userAlias !== undefined ? { userAlias } : {}),
      })
    }
  }

  const finalizedSource: NodeSource = {
    ...incomingSource,
    nodeIds: dedupedIds,
  }

  const exists = sources.some((src) => src.id === incomingSource.id)
  const nextSources = exists
    ? sources.map((src) => (src.id === incomingSource.id ? finalizedSource : src))
    : [...sources, finalizedSource]

  // 来源关系顺序与来源列表保持一致，刷新/恢复合并后仍可预测。
  const sourceOrder = new Map(nextSources.map((src, index) => [src.id, index]))
  for (const [nodeId, entry] of Object.entries(nextRegistry)) {
    if (entry.sourceIds.length > 1) {
      const ordered = [...entry.sourceIds].sort(
        (a, b) =>
          (sourceOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (sourceOrder.get(b) ?? Number.MAX_SAFE_INTEGER),
      )
      setOwnEntry(nextRegistry, nodeId, { ...entry, sourceIds: ordered })
    }
  }

  return {
    registry: nextRegistry,
    sources: nextSources,
  }
}

export function renameNodeDisplayAlias(
  registry: Record<string, ManagedNodeEntry>,
  nodeId: string,
  newDisplayName: string,
): Record<string, ManagedNodeEntry> {
  const entry = readRegistryEntry(registry, nodeId)
  if (!entry) {
    return registry
  }
  const trimmed = newDisplayName.trim()
  if (!trimmed) {
    return registry
  }

  const next = { ...registry }
  setOwnEntry(next, nodeId, {
    ...entry,
    displayName: trimmed,
    userAlias: trimmed,
    node: {
      ...entry.node,
      name: trimmed,
    },
  })
  return next
}

export function computeSourceDeletionImpact(
  registry: Record<string, ManagedNodeEntry>,
  sources: NodeSource[],
  plans: ChainPlan[],
  sourceId: string,
): SourceDeletionImpact {
  const source = sources.find((item) => item.id === sourceId)
  const removedExclusiveNodeIds: string[] = []
  const keptSharedNodeIds: string[] = []

  for (const [nodeId, entry] of Object.entries(registry)) {
    if (!entry.sourceIds.includes(sourceId)) {
      continue
    }
    const remaining = entry.sourceIds.filter((id) => id !== sourceId)
    if (remaining.length === 0) {
      removedExclusiveNodeIds.push(nodeId)
    } else {
      keptSharedNodeIds.push(nodeId)
    }
  }

  const removedSet = new Set(removedExclusiveNodeIds)
  const affectedPlans: SourceDeletionImpact['affectedPlans'] = []

  for (const plan of plans) {
    const stages: ChainStage[] = [plan.entry, ...plan.relays, plan.exit]
    const stageNames: string[] = []
    const brokenIds = new Set<string>()

    for (const stage of stages) {
      const hits = stage.candidateNodeIds.filter((id) => removedSet.has(id))
      if (hits.length > 0) {
        stageNames.push(stage.name)
        for (const id of hits) {
          brokenIds.add(id)
        }
      }
    }

    if (brokenIds.size > 0) {
      affectedPlans.push({
        planId: plan.id,
        planName: plan.name,
        stageNames,
        brokenNodeIds: Array.from(brokenIds),
      })
    }
  }

  return {
    sourceId,
    sourceName: source?.name ?? sourceId,
    removedExclusiveNodeIds,
    keptSharedNodeIds,
    affectedPlans,
  }
}

export function removeSourceFromWorkspace(
  registry: Record<string, ManagedNodeEntry>,
  sources: NodeSource[],
  sourceId: string,
): { registry: Record<string, ManagedNodeEntry>; sources: NodeSource[] } {
  const nextRegistry: Record<string, ManagedNodeEntry> = {}

  for (const [nodeId, entry] of Object.entries(registry)) {
    const remaining = entry.sourceIds.filter((id) => id !== sourceId)
    if (remaining.length > 0) {
      const nextAliases = { ...entry.sourceAliases }
      delete nextAliases[sourceId]
      setOwnEntry(nextRegistry, nodeId, {
        ...entry,
        sourceIds: remaining,
        sourceAliases: nextAliases,
      })
    }
  }

  return {
    registry: nextRegistry,
    sources: sources.filter((item) => item.id !== sourceId),
  }
}

/**
 * 撤销删除：基于最新工作区做差量合并，只恢复本次被删来源及其关联节点。
 * 撤销只为恢复的来源 A 补回 A 自己的节点关联与来源别名——即使快照里 A 的节点
 * 同时由其他来源提供，也不恢复那些来源的关系；其他来源对节点的保留或移除
 * 以它们当前的成功解析结果为准，避免撤销覆盖期间刷新造成的关联变化。
 * 已存在的同连接节点以当前条目为基础仅补入 A，保留最新节点数据、用户别名、
 * 其他来源关系及其别名；来源原本处于 loading 时恢复为可操作状态。
 */
export function restoreDeletedSource(
  registry: Record<string, ManagedNodeEntry>,
  sources: NodeSource[],
  record: {
    source: NodeSource
    nodeEntries: ManagedNodeEntry[]
  },
): { registry: Record<string, ManagedNodeEntry>; sources: NodeSource[] } {
  const restoredSourceId = record.source.id
  if (sources.some((src) => src.id === restoredSourceId)) {
    return { registry, sources }
  }

  const restoredSource: NodeSource = {
    ...record.source,
    status:
      record.source.status === 'loading'
        ? record.source.nodeIds.length > 0
          ? 'success'
          : 'idle'
        : record.source.status,
  }
  const nextSources = [...sources, restoredSource]

  const nextRegistry = { ...registry }
  for (const entry of record.nodeEntries) {
    if (!entry.sourceIds.includes(restoredSourceId)) {
      continue
    }
    const restoredAlias = readSourceAlias(entry.sourceAliases, restoredSourceId)

    const existing = readRegistryEntry(nextRegistry, entry.node.id)
    if (existing) {
      // 节点当前仍存在（其他来源仍在提供）：以当前数据为基础，仅补入来源 A。
      if (existing.sourceIds.includes(restoredSourceId)) {
        continue
      }
      const mergedAliases = { ...existing.sourceAliases }
      setOwnEntry(mergedAliases, restoredSourceId, restoredAlias ?? existing.node.name)
      setOwnEntry(nextRegistry, entry.node.id, {
        ...existing,
        sourceIds: [...existing.sourceIds, restoredSourceId],
        sourceAliases: mergedAliases,
      })
    } else {
      // 节点当前不存在：按删除时的快照恢复节点，初始来源关系只包含 A。
      const sourceAliases: Record<string, string> = {}
      setOwnEntry(
        sourceAliases,
        restoredSourceId,
        restoredAlias ?? entry.node.name,
      )
      setOwnEntry(nextRegistry, entry.node.id, {
        ...entry,
        sourceIds: [restoredSourceId],
        sourceAliases,
      })
    }
  }

  // 来源关系顺序与来源列表保持一致，与 upsertSourceNodes 的排序规则相同。
  const sourceOrder = new Map(nextSources.map((src, index) => [src.id, index]))
  for (const [nodeId, entry] of Object.entries(nextRegistry)) {
    if (entry.sourceIds.length > 1) {
      const ordered = [...entry.sourceIds].sort(
        (a, b) =>
          (sourceOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (sourceOrder.get(b) ?? Number.MAX_SAFE_INTEGER),
      )
      setOwnEntry(nextRegistry, nodeId, { ...entry, sourceIds: ordered })
    }
  }

  return {
    registry: nextRegistry,
    sources: nextSources,
  }
}

export function getEnabledStagesForPlan(
  plan: ChainPlan,
): Array<{ role: 'entry' | 'relay' | 'exit'; stage: ChainStage }> {
  const list: Array<{ role: 'entry' | 'relay' | 'exit'; stage: ChainStage }> = [
    { role: 'entry', stage: plan.entry },
  ]

  if (plan.mode === 'advanced') {
    for (const relay of plan.relays) {
      if (relay.enabled) {
        list.push({ role: 'relay', stage: relay })
      }
    }
  }

  if (plan.exit.enabled) {
    list.push({ role: 'exit', stage: plan.exit })
  }

  return list
}

export function buildChainPreview(
  plan: ChainPlan,
  registry: Record<string, ManagedNodeEntry>,
): ChainPreviewModel {
  const enabledStages = getEnabledStagesForPlan(plan)
  const disabledStageNames: string[] = []
  if (plan.mode === 'advanced') {
    for (const relay of plan.relays) {
      if (!relay.enabled) {
        disabledStageNames.push(relay.name)
      }
    }
  }
  if (!plan.exit.enabled) {
    disabledStageNames.push(plan.exit.name)
  }

  const stages: ChainPreviewStage[] = enabledStages.map(({ role, stage }, index) => {
    const candidates = stage.candidateNodeIds.map((nodeId) => {
      const entry = readRegistryEntry(registry, nodeId)
      if (entry) {
        return {
          nodeId,
          name: entry.displayName,
          type: entry.node.type,
          missing: false,
        }
      }
      const hint = readNodeHint(plan.nodeHints, nodeId)
      return {
        nodeId,
        name: hint ? `${hint.name} (待重新绑定)` : `${nodeId} (已失效)`,
        type: hint?.type,
        missing: true,
      }
    })

    return {
      stageId: stage.id,
      role,
      name: stage.name,
      strategy: stage.strategy,
      isFinalExit: index === enabledStages.length - 1,
      candidates,
      missingSelection: candidates.length === 0 || candidates.some((c) => c.missing),
    }
  })

  return {
    stages,
    finalExitStageName: stages[stages.length - 1]?.name,
    routingPreset: plan.routingPreset,
    disabledStageNames,
    hiddenRelayCount: plan.mode === 'simple' ? plan.relays.length : 0,
    isComplete:
      stages.length > 0 &&
      stages.length <= MAX_ENABLED_CHAIN_LAYERS &&
      stages.every((stage) => !stage.missingSelection),
  }
}

export function validateAndExportPlan(
  plan: ChainPlan,
  registry: Record<string, ManagedNodeEntry>,
  allPlans: ChainPlan[],
  format: TargetFormat,
): ChainExportResult {
  const preview = buildChainPreview(plan, registry)

  if (format === 'import-links') {
    return exportPlanAsLinks(plan, registry, preview)
  }

  if (format === 'xray-json') {
    return exportPlanAsXrayJson(plan, registry, preview)
  }

  return exportPlanAsClashYaml(plan, registry, allPlans, format, preview)
}

export function exportSelectedNodesAsLinks(
  nodeIds: string[],
  registry: Record<string, ManagedNodeEntry>,
): { valid: boolean; output: string; diagnostics: ChainDiagnostic[] } {
  const diagnostics: ChainDiagnostic[] = []
  const validNodes: NormalizedProxyNode[] = []

  if (nodeIds.length === 0) {
    diagnostics.push({
      severity: 'error',
      scope: 'node',
      code: 'no_nodes_selected',
      message: '请至少选择一个节点再导出普通节点链接。',
    })
    return { valid: false, output: '', diagnostics }
  }

  for (const nodeId of nodeIds) {
    const entry = readRegistryEntry(registry, nodeId)
    if (!entry) {
      diagnostics.push({
        severity: 'error',
        scope: 'node',
        nodeId,
        code: 'missing_node_reference',
        message: `所选节点 (${nodeId}) 已不存在或需要重新导入。`,
      })
      continue
    }
    const nodeWithDisplayName: NormalizedProxyNode = {
      ...entry.node,
      name: entry.displayName,
    }
    const issues = validateNodeForFormat(nodeWithDisplayName, 'import-links')
    for (const issue of issues) {
      diagnostics.push({
        severity: issue.severity,
        scope: 'node',
        nodeId,
        field: issue.field,
        code: issue.code,
        message: issue.message,
      })
    }
    validNodes.push(nodeWithDisplayName)
  }

  const hasError = diagnostics.some((d) => d.severity === 'error')
  if (hasError) {
    return { valid: false, output: '', diagnostics }
  }

  return {
    valid: true,
    output: validNodes.map((n) => toImportLink(n)).join('\n'),
    diagnostics,
  }
}

export function buildBatchPlanExports(
  plans: ChainPlan[],
  registry: Record<string, ManagedNodeEntry>,
  format: 'clash-mihomo' | 'clash-snippet' = 'clash-mihomo',
): BatchPlanExportItem[] {
  const usedFileNames = new Set<string>()
  return plans.map((plan, index) => ({
    planId: plan.id,
    planName: plan.name,
    fileName: sanitizeExportFileName(plan.name, index, usedFileNames),
    result: validateAndExportPlan(plan, registry, plans, format),
  }))
}

export function sanitizeExportFileName(
  planName: string,
  index: number,
  usedFileNames = new Set<string>(),
): string {
  const cleaned = planName
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  const base = `${String(index + 1).padStart(2, '0')}-${cleaned || 'plan'}`
  let candidate = `${base}.yaml`
  let suffix = 2
  while (usedFileNames.has(candidate)) {
    candidate = `${base}-${suffix}.yaml`
    suffix += 1
  }
  usedFileNames.add(candidate)
  return candidate
}

function exportPlanAsLinks(
  plan: ChainPlan,
  registry: Record<string, ManagedNodeEntry>,
  preview: ChainPreviewModel,
): ChainExportResult {
  const diagnostics: ChainDiagnostic[] = []
  const enabledStages = getEnabledStagesForPlan(plan)
  const seenNodeIds = new Set<string>()
  const nodesToExport: NormalizedProxyNode[] = []

  for (const { stage } of enabledStages) {
    for (const nodeId of stage.candidateNodeIds) {
      if (seenNodeIds.has(nodeId)) {
        continue
      }
      seenNodeIds.add(nodeId)
      const entry = readRegistryEntry(registry, nodeId)
      if (!entry) {
        const hint = readNodeHint(plan.nodeHints, nodeId)
        diagnostics.push({
          severity: 'error',
          scope: 'stage',
          planId: plan.id,
          stageId: stage.id,
          nodeId,
          code: 'missing_node_reference',
          message: `层 "${stage.name}" 中引用的节点 "${hint?.name ?? nodeId}" 已失效，请重新导入或取消选择。`,
        })
        continue
      }

      const nodeWithDisplayName: NormalizedProxyNode = {
        ...entry.node,
        name: entry.displayName,
      }
      for (const issue of validateNodeForFormat(nodeWithDisplayName, 'import-links')) {
        diagnostics.push({
          severity: issue.severity,
          scope: 'node',
          planId: plan.id,
          stageId: stage.id,
          nodeId,
          field: issue.field,
          code: issue.code,
          message: issue.message,
        })
      }
      nodesToExport.push(nodeWithDisplayName)
    }
  }

  if (nodesToExport.length === 0 && diagnostics.length === 0) {
    diagnostics.push({
      severity: 'error',
      scope: 'plan',
      planId: plan.id,
      code: 'no_nodes_selected',
      message: '当前启用层尚未选择任何节点，无法生成普通节点链接。',
    })
  }

  const hasErrors = diagnostics.some((d) => d.severity === 'error')
  return {
    valid: !hasErrors,
    diagnostics,
    output: hasErrors ? '' : nodesToExport.map((node) => toImportLink(node)).join('\n'),
    format: 'import-links',
    preview,
    exportedNodeCount: hasErrors ? 0 : nodesToExport.length,
    groupNames: [],
  }
}

function exportPlanAsXrayJson(
  plan: ChainPlan,
  registry: Record<string, ManagedNodeEntry>,
  preview: ChainPreviewModel,
): ChainExportResult {
  const diagnostics = validateSinglePlanTopologyAndNodes(plan, registry, 'xray-json')
  const enabledStages = getEnabledStagesForPlan(plan)

  if (enabledStages.length > 2) {
    diagnostics.push({
      severity: 'warning',
      scope: 'plan',
      planId: plan.id,
      code: 'xray_multihop_unverified',
      message: 'Xray JSON 导出建议仅在确认支持多级 proxySettings 的版本中使用。',
    })
  }

  const hasError = diagnostics.some((d) => d.severity === 'error')
  if (hasError) {
    return {
      valid: false,
      diagnostics,
      output: '',
      format: 'xray-json',
      preview,
      exportedNodeCount: 0,
      groupNames: [],
    }
  }

  const usedTags = new Set<string>(['socks-in', 'direct', 'block'])
  const stageTags: string[][] = []
  const outbounds: Array<Record<string, unknown>> = []

  enabledStages.forEach(({ role, stage }, stageIdx) => {
    const tagsForStage: string[] = []
    stage.candidateNodeIds.forEach((nodeId) => {
      const entry = readRegistryEntry(registry, nodeId)
      if (!entry) {
        return
      }
      const node: NormalizedProxyNode = { ...entry.node, name: entry.displayName }
      const tag = allocateUniqueSafeTag(entry.displayName, role, usedTags)
      tagsForStage.push(tag)
      const outbound = toXrayOutbound(node, tag)
      if (stageIdx > 0) {
        outbound.proxySettings = { tag: stageTags[stageIdx - 1][0] }
      }
      outbounds.push(outbound)
    })
    stageTags.push(tagsForStage)
  })

  const orderedOutbounds = [...outbounds].reverse()
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
    outbounds: orderedOutbounds,
  }

  return {
    valid: true,
    diagnostics,
    output: JSON.stringify(config, null, 2),
    format: 'xray-json',
    preview,
    exportedNodeCount: outbounds.length,
    groupNames: [],
  }
}

function exportPlanAsClashYaml(
  activePlan: ChainPlan,
  registry: Record<string, ManagedNodeEntry>,
  allPlans: ChainPlan[],
  format: 'clash-mihomo' | 'clash-snippet',
  preview: ChainPreviewModel,
): ChainExportResult {
  const diagnostics: ChainDiagnostic[] = []
  const plansById = new Map(allPlans.map((p) => [p.id, p]))
  const referencedPlanIds = new Set<string>([activePlan.id])

  if (activePlan.routingPreset === 'custom') {
    for (const rule of activePlan.customRules) {
      if (rule.target.kind === 'plan') {
        if (!plansById.has(rule.target.planId)) {
          diagnostics.push({
            severity: 'error',
            scope: 'rule',
            planId: activePlan.id,
            field: 'customRules',
            code: 'missing_target_plan',
            message: `自定义规则 "${rule.pattern || '(空)'}" 指向了不存在的方案。`,
          })
        } else {
          referencedPlanIds.add(rule.target.planId)
        }
      }
    }

    if (activePlan.customFallbackTarget.kind === 'plan') {
      if (!plansById.has(activePlan.customFallbackTarget.planId)) {
        diagnostics.push({
          severity: 'error',
          scope: 'rule',
          planId: activePlan.id,
          field: 'customFallbackTarget',
          code: 'missing_fallback_plan',
          message: '自定义分流的默认兜底规则指向了不存在的方案。',
        })
      } else {
        referencedPlanIds.add(activePlan.customFallbackTarget.planId)
      }
    }

    for (const rule of activePlan.customRules) {
      validateCustomRule(rule, activePlan.id, diagnostics)
    }
  }

  const referencedPlans = Array.from(referencedPlanIds)
    .map((id) => plansById.get(id))
    .filter((p): p is ChainPlan => Boolean(p))

  for (const refPlan of referencedPlans) {
    diagnostics.push(...validateSinglePlanTopologyAndNodes(refPlan, registry, format))
  }

  const dedupedDiagnostics = deduplicateChainDiagnostics(diagnostics)
  const hasError = dedupedDiagnostics.some((d) => d.severity === 'error')
  if (hasError) {
    return {
      valid: false,
      diagnostics: dedupedDiagnostics,
      output: '',
      format,
      preview,
      exportedNodeCount: 0,
      groupNames: [],
    }
  }

  const isMultiPlan = referencedPlans.length > 1
  const usedGlobalNames = new Set<string>(RESERVED_CLASH_NAMES)
  const proxies: Array<Record<string, unknown>> = []
  const proxyGroups: Array<Record<string, unknown>> = []
  const planFinalGroupName = new Map<string, string>()

  for (const refPlan of referencedPlans) {
    const enabledStages = getEnabledStagesForPlan(refPlan)
    const stageGroupNames: string[] = []

    // 先分配组名，保证代理节点名称绝不会与策略组名称冲突。
    for (const { role, stage } of enabledStages) {
      let desiredGroupName: string
      if (!isMultiPlan) {
        if (role === 'entry' && (stage.name === '入口节点' || stage.name === '入口')) {
          desiredGroupName = '入口节点'
        } else if (role === 'exit' && (stage.name === '出口节点' || stage.name === '独立出口' || stage.name === '出口' || stage.name === 'PROXY')) {
          desiredGroupName = 'PROXY'
        } else {
          desiredGroupName = stage.name
        }
      } else {
        desiredGroupName = `${refPlan.name} / ${stage.name}`
      }
      stageGroupNames.push(allocateUniqueClashName(desiredGroupName, usedGlobalNames))
    }

    enabledStages.forEach(({ role, stage }, stageIdx) => {
      const groupName = stageGroupNames[stageIdx]
      const prevGroupName = stageIdx > 0 ? stageGroupNames[stageIdx - 1] : undefined
      const stageProxyNames: string[] = []
      const roleLabel = role === 'entry' ? '入口' : role === 'exit' ? '出口' : stage.name

      for (const nodeId of stage.candidateNodeIds) {
        const entry = readRegistryEntry(registry, nodeId)
        if (!entry) {
          continue
        }
        // 单方案导出直接使用节点显示名（同一方案内重复节点已被校验阻断）；
        // 多方案合并导出时追加方案名与角色后缀，避免跨方案同名节点互相覆盖。
        const baseProxyName = isMultiPlan
          ? `${entry.displayName}-${refPlan.name}-${roleLabel}`
          : entry.displayName
        const uniqueProxyName = allocateUniqueClashName(baseProxyName, usedGlobalNames)
        stageProxyNames.push(uniqueProxyName)

        const proxyObj = toClashProxy({ ...entry.node, name: entry.displayName }, uniqueProxyName)
        if (prevGroupName) {
          proxyObj['dialer-proxy'] = prevGroupName
        }
        proxies.push(proxyObj)
      }

      const groupObj: Record<string, unknown> = {
        name: groupName,
        type: stage.strategy,
        proxies: stageProxyNames,
      }

      if (stage.strategy === 'url-test' || stage.strategy === 'fallback') {
        const probe = stage.probe ?? DEFAULT_PROBE_CONFIG
        groupObj.url = probe.url
        groupObj.interval = probe.intervalSeconds
        if (stage.strategy === 'url-test' && probe.toleranceMs !== undefined) {
          groupObj.tolerance = probe.toleranceMs
        }
      }

      proxyGroups.push(groupObj)
    })

    planFinalGroupName.set(refPlan.id, stageGroupNames[stageGroupNames.length - 1])
  }

  const activeFinalTarget = planFinalGroupName.get(activePlan.id)!
  const rules = buildClashRules(activePlan, activeFinalTarget, planFinalGroupName)

  const structuralIssues = verifyClashConfigIntegrity(proxies, proxyGroups, rules)
  if (structuralIssues.length > 0) {
    return {
      valid: false,
      diagnostics: [...dedupedDiagnostics, ...structuralIssues],
      output: '',
      format,
      preview,
      exportedNodeCount: 0,
      groupNames: [],
    }
  }

  const payload =
    format === 'clash-snippet'
      ? {
          proxies,
          'proxy-groups': proxyGroups,
          rules,
        }
      : {
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
          proxies,
          'proxy-groups': proxyGroups,
          rules,
        }

  return {
    valid: true,
    diagnostics: dedupedDiagnostics,
    output: stringifyYamlConfig(payload),
    format,
    preview,
    exportedNodeCount: proxies.length,
    groupNames: proxyGroups.map((g) => String(g.name)),
  }
}

function validateSinglePlanTopologyAndNodes(
  plan: ChainPlan,
  registry: Record<string, ManagedNodeEntry>,
  format: TargetFormat,
): ChainDiagnostic[] {
  const diagnostics: ChainDiagnostic[] = []
  const enabledStages = getEnabledStagesForPlan(plan)

  if (enabledStages.length > MAX_ENABLED_CHAIN_LAYERS) {
    diagnostics.push({
      severity: 'error',
      scope: 'plan',
      planId: plan.id,
      code: 'too_many_enabled_layers',
      message: `方案 "${plan.name}" 启用了 ${enabledStages.length} 层，超过第一版上限 (${MAX_ENABLED_CHAIN_LAYERS} 层)。请删除或停用部分中转层。`,
    })
  }

  const seenNodeStages = new Map<string, string>()

  enabledStages.forEach(({ role, stage }, stageIdx) => {
    if (!stage.name.trim()) {
      diagnostics.push({
        severity: 'error',
        scope: 'stage',
        planId: plan.id,
        stageId: stage.id,
        field: 'name',
        code: 'empty_stage_name',
        message: `方案 "${plan.name}" 中存在未命名的启用层。`,
      })
    }

    if (stage.candidateNodeIds.length === 0) {
      diagnostics.push({
        severity: 'error',
        scope: 'stage',
        planId: plan.id,
        stageId: stage.id,
        code: 'empty_stage_selection',
        message: `方案 "${plan.name}" 的启用层 "${stage.name}" 尚未选择候选节点。`,
      })
      return
    }

    if (stage.strategy !== 'select') {
      const probe = stage.probe ?? DEFAULT_PROBE_CONFIG
      if (!/^https?:\/\/\S+$/i.test(probe.url.trim())) {
        diagnostics.push({
          severity: 'error',
          scope: 'stage',
          planId: plan.id,
          stageId: stage.id,
          field: 'probe.url',
          code: 'invalid_probe_url',
          message: `层 "${stage.name}" 的探测 URL 必须是有效的 http(s) 地址。`,
        })
      }
      if (
        !Number.isInteger(probe.intervalSeconds) ||
        probe.intervalSeconds < 10 ||
        probe.intervalSeconds > 86400
      ) {
        diagnostics.push({
          severity: 'error',
          scope: 'stage',
          planId: plan.id,
          stageId: stage.id,
          field: 'probe.intervalSeconds',
          code: 'invalid_probe_interval',
          message: `层 "${stage.name}" 的探测间隔必须在 10 到 86400 秒之间。`,
        })
      }
      if (
        stage.strategy === 'url-test' &&
        probe.toleranceMs !== undefined &&
        (!Number.isInteger(probe.toleranceMs) || probe.toleranceMs < 0 || probe.toleranceMs > 10000)
      ) {
        diagnostics.push({
          severity: 'error',
          scope: 'stage',
          planId: plan.id,
          stageId: stage.id,
          field: 'probe.toleranceMs',
          code: 'invalid_probe_tolerance',
          message: `层 "${stage.name}" 的切换容差 (tolerance) 必须在 0 到 10000 毫秒之间。`,
        })
      }
      if (role === 'exit') {
        diagnostics.push({
          severity: 'warning',
          scope: 'stage',
          planId: plan.id,
          stageId: stage.id,
          code: 'exit_auto_strategy_warning',
          message: `出口节点 "${stage.name}" 使用 ${stage.strategy} 策略时，客户端自动切换可能改变对外出口 IP。`,
        })
      }
    }

    const stageNodes: NormalizedProxyNode[] = []
    for (const nodeId of stage.candidateNodeIds) {
      const entry = readRegistryEntry(registry, nodeId)
      if (!entry) {
        const hint = readNodeHint(plan.nodeHints, nodeId)
        diagnostics.push({
          severity: 'error',
          scope: 'stage',
          planId: plan.id,
          stageId: stage.id,
          nodeId,
          code: 'missing_node_reference',
          message: `层 "${stage.name}" 引用了缺失节点 "${hint?.name ?? nodeId}"，请重新导入或重新选择。`,
        })
        continue
      }

      const previousStageName = seenNodeStages.get(nodeId)
      if (previousStageName) {
        diagnostics.push({
          severity: 'error',
          scope: 'stage',
          planId: plan.id,
          stageId: stage.id,
          nodeId,
          code: 'same_path_duplicate_node',
          message: `节点 "${entry.displayName}" 同时出现在同一方案的 "${previousStageName}" 与 "${stage.name}" 层中，可能造成自引用循环。`,
        })
      } else {
        seenNodeStages.set(nodeId, stage.name)
      }

      const nodeWithDisplay: NormalizedProxyNode = { ...entry.node, name: entry.displayName }
      stageNodes.push(nodeWithDisplay)

      for (const issue of validateNodeForFormat(nodeWithDisplay, format)) {
        diagnostics.push({
          severity: issue.severity,
          scope: 'node',
          planId: plan.id,
          stageId: stage.id,
          nodeId,
          field: issue.field,
          code: issue.code,
          message: issue.message,
        })
      }
    }

    if (stageIdx > 0) {
      const prevStage = enabledStages[stageIdx - 1].stage
      const prevNodes = prevStage.candidateNodeIds
        .map((id) => readRegistryEntry(registry, id)?.node)
        .filter((n): n is NormalizedProxyNode => Boolean(n))
      checkHopCompatibility(plan.id, prevStage, prevNodes, stage, stageNodes, diagnostics)
    }
  })

  return diagnostics
}

function checkHopCompatibility(
  planId: string,
  upstreamStage: ChainStage,
  upstreamNodes: NormalizedProxyNode[],
  downstreamStage: ChainStage,
  downstreamNodes: NormalizedProxyNode[],
  diagnostics: ChainDiagnostic[],
): void {
  const downstreamHasHy2 = downstreamNodes.some((n) => n.type === 'hysteria2')
  if (!downstreamHasHy2) {
    return
  }

  let hasUnverifiedQuicWarning = false

  for (const upstream of upstreamNodes) {
    if (upstream.udp === false) {
      diagnostics.push({
        severity: 'error',
        scope: 'stage',
        planId,
        stageId: downstreamStage.id,
        nodeId: upstream.id,
        code: 'upstream_udp_disabled_for_hy2',
        message: `上游层 "${upstreamStage.name}" 中的节点 "${upstream.name}" 已关闭 UDP，无法承载下游 Hysteria2 (QUIC) 流量。`,
      })
      continue
    }

    if (upstream.type === 'ss' && upstream.plugin === 'obfs') {
      diagnostics.push({
        severity: 'error',
        scope: 'stage',
        planId,
        stageId: downstreamStage.id,
        nodeId: upstream.id,
        code: 'upstream_obfs_no_udp_for_hy2',
        message: `上游 Shadowsocks 节点 "${upstream.name}" 使用 simple-obfs (仅 TCP)，不支持转发下游 Hysteria2 所需的 UDP/QUIC 流量。`,
      })
      continue
    }

    if (upstream.type === 'hysteria2') {
      diagnostics.push({
        severity: 'error',
        scope: 'stage',
        planId,
        stageId: downstreamStage.id,
        nodeId: upstream.id,
        code: 'nested_quic_unverified',
        message: `尚未验证 Hysteria2 经过 dialer-proxy 再串联 Hysteria2 的 QUIC-in-QUIC 组合（"${upstream.name}" → "${downstreamStage.name}"），已阻止自动导出。`,
      })
      continue
    }

    if (upstream.type === 'vless' && (upstream.packetType === 'ws' || upstream.packetType === 'grpc')) {
      diagnostics.push({
        severity: 'error',
        scope: 'stage',
        planId,
        stageId: downstreamStage.id,
        nodeId: upstream.id,
        code: 'upstream_transport_unverified_for_hy2',
        message: `上游 VLESS (${upstream.packetType}) 节点 "${upstream.name}" 串联 Hysteria2 (QUIC) 的 UDP/dialer-proxy 兼容性尚未确认，已阻止导出。`,
      })
      continue
    }

    hasUnverifiedQuicWarning = true
  }

  if (hasUnverifiedQuicWarning) {
    diagnostics.push({
      severity: 'warning',
      scope: 'stage',
      planId,
      stageId: downstreamStage.id,
      code: 'quic_over_dialer_proxy_unverified',
      message: `下游层 "${downstreamStage.name}" 包含 Hysteria2 (QUIC)，通过 dialer-proxy 串联需上游节点实际支持 UDP 转发并在客户端实测验证。`,
    })
  }
}

function validateCustomRule(
  rule: CustomRoutingRule,
  planId: string,
  diagnostics: ChainDiagnostic[],
): void {
  const pattern = rule.pattern.trim()
  if (!pattern) {
    diagnostics.push({
      severity: 'error',
      scope: 'rule',
      planId,
      field: 'pattern',
      code: 'empty_routing_pattern',
      message: '自定义分流规则的域名或关键字不能为空。',
    })
    return
  }

  if (/[\s,/#]/.test(pattern) || pattern.includes('://')) {
    diagnostics.push({
      severity: 'error',
      scope: 'rule',
      planId,
      field: 'pattern',
      code: 'invalid_routing_pattern',
      message: `规则匹配内容 "${pattern}" 格式无效（不能包含空格、逗号、斜杠或协议头）。`,
    })
    return
  }

  if (
    (rule.matchType === 'DOMAIN' || rule.matchType === 'DOMAIN-SUFFIX') &&
    !/^[a-zA-Z0-9.-]+$/.test(pattern)
  ) {
    diagnostics.push({
      severity: 'error',
      scope: 'rule',
      planId,
      field: 'pattern',
      code: 'invalid_domain_pattern',
      message: `${rule.matchType} 规则 "${pattern}" 包含非法域名字符。`,
    })
  }
}

function buildClashRules(
  plan: ChainPlan,
  activeFinalTarget: string,
  planFinalGroupName: Map<string, string>,
): string[] {
  if (plan.routingPreset === 'all-proxy') {
    return [`MATCH,${activeFinalTarget}`]
  }

  if (plan.routingPreset === 'cn-direct') {
    return ['GEOIP,CN,DIRECT', `MATCH,${activeFinalTarget}`]
  }

  const resolveTarget = (target: CustomRoutingTarget): string => {
    if (target.kind === 'direct') {
      return 'DIRECT'
    }
    if (target.kind === 'reject') {
      return 'REJECT'
    }
    return planFinalGroupName.get(target.planId) ?? activeFinalTarget
  }

  const lines = plan.customRules.map(
    (rule) => `${rule.matchType},${rule.pattern.trim()},${resolveTarget(rule.target)}`,
  )
  lines.push(`MATCH,${resolveTarget(plan.customFallbackTarget)}`)
  return lines
}

function verifyClashConfigIntegrity(
  proxies: Array<Record<string, unknown>>,
  proxyGroups: Array<Record<string, unknown>>,
  rules: string[],
): ChainDiagnostic[] {
  const diagnostics: ChainDiagnostic[] = []
  const proxyNames = new Set<string>()
  const groupNames = new Set<string>()

  for (const proxy of proxies) {
    const name = String(proxy.name ?? '')
    if (!name || proxyNames.has(name) || RESERVED_CLASH_NAMES.has(name)) {
      diagnostics.push({
        severity: 'error',
        scope: 'plan',
        code: 'duplicate_or_invalid_proxy_name',
        message: `导出代理名称 '${name}' 冲突或无效。`,
      })
    }
    proxyNames.add(name)
  }

  for (const group of proxyGroups) {
    const name = String(group.name ?? '')
    if (!name || groupNames.has(name) || proxyNames.has(name) || RESERVED_CLASH_NAMES.has(name)) {
      diagnostics.push({
        severity: 'error',
        scope: 'plan',
        code: 'duplicate_or_invalid_group_name',
        message: `导出策略组名称 '${name}' 冲突或无效。`,
      })
    }
    groupNames.add(name)
  }

  const allTargetNames = new Set<string>([...proxyNames, ...groupNames, 'DIRECT', 'REJECT'])

  for (const proxy of proxies) {
    const dialer = proxy['dialer-proxy']
    if (dialer !== undefined && !groupNames.has(String(dialer)) && !proxyNames.has(String(dialer))) {
      diagnostics.push({
        severity: 'error',
        scope: 'plan',
        code: 'broken_dialer_proxy_ref',
        message: `节点 '${String(proxy.name)}' 的 dialer-proxy '${String(dialer)}' 引用不存在。`,
      })
    }
  }

  for (const group of proxyGroups) {
    const members = Array.isArray(group.proxies) ? group.proxies : []
    for (const member of members) {
      if (!allTargetNames.has(String(member))) {
        diagnostics.push({
          severity: 'error',
          scope: 'plan',
          code: 'broken_group_member_ref',
          message: `策略组 '${String(group.name)}' 引用了不存在的成员 '${String(member)}'。`,
        })
      }
    }
  }

  for (const rule of rules) {
    const parts = rule.split(',')
    const target = parts[parts.length - 1]
    if (!groupNames.has(target) && target !== 'DIRECT' && target !== 'REJECT') {
      diagnostics.push({
        severity: 'error',
        scope: 'rule',
        code: 'broken_rule_target',
        message: `分流规则 '${rule}' 指向了不存在的目标 '${target}'。`,
      })
    }
  }

  return diagnostics
}

function allocateUniqueClashName(desired: string, usedNames: Set<string>): string {
  const base = desired.trim() || 'node'
  let candidate = base
  let index = 2

  while (usedNames.has(candidate)) {
    candidate = `${base}-${index}`
    index += 1
  }

  usedNames.add(candidate)
  return candidate
}

function allocateUniqueSafeTag(baseName: string, role: string, usedTags: Set<string>): string {
  const safeBase =
    baseName
      .trim()
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || role
  let candidate = `${safeBase}-${role}`
  let index = 2
  while (usedTags.has(candidate)) {
    candidate = `${safeBase}-${role}-${index}`
    index += 1
  }
  usedTags.add(candidate)
  return candidate
}

function deduplicateChainDiagnostics(items: ChainDiagnostic[]): ChainDiagnostic[] {
  const seen = new Set<string>()
  const out: ChainDiagnostic[] = []
  for (const item of items) {
    const key = `${item.severity}|${item.planId ?? ''}|${item.stageId ?? ''}|${item.nodeId ?? ''}|${item.code}|${item.message}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

export function serializeWorkspaceState({
  activePlanId,
  plans,
  sources,
  registry,
  includesCredentials,
}: {
  activePlanId: string
  plans: ChainPlan[]
  sources: NodeSource[]
  registry: Record<string, ManagedNodeEntry>
  includesCredentials: boolean
}): SavedWorkspaceEnvelope {
  const syncedPlans = plans.map((plan) => syncPlanNodeHints(plan, registry))
  const sanitizedSources: NodeSource[] = sources.map((src) => ({
    id: src.id,
    name: src.name,
    kind: src.kind,
    nodeIds: [...src.nodeIds],
    status: src.kind === 'subscription' ? 'idle' : src.status,
    lastSuccessAt: src.lastSuccessAt,
    parseStats: src.parseStats ? { ...src.parseStats, issues: [...src.parseStats.issues] } : undefined,
  }))

  const envelope: SavedWorkspaceEnvelope = {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    includesCredentials,
    activePlanId,
    plans: syncedPlans,
    sources: sanitizedSources,
  }

  if (includesCredentials) {
    envelope.nodes = Object.values(registry).map((entry) => structuredClone(entry))
  }

  return envelope
}

export function validateAndRestoreWorkspace(rawJson: string): {
  ok: true
  envelope: SavedWorkspaceEnvelope
} | {
  ok: false
  error: string
} {
  const bytes = new TextEncoder().encode(rawJson).byteLength
  if (bytes > MAX_PLAN_FILE_BYTES) {
    return { ok: false, error: PLAN_FILE_TOO_LARGE_MESSAGE }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    return { ok: false, error: '方案文件不是合法的 JSON 格式。' }
  }

  try {
    return { ok: true, envelope: restoreEnvelopeFromParsed(parsed) }
  } catch (error) {
    if (error instanceof WorkspaceRestoreError) {
      // 只回显字段路径与原因，不回显任何字段取值，避免泄露凭据。
      return { ok: false, error: `方案文件字段 ${error.path} 无效：${error.reason}` }
    }
    return { ok: false, error: '方案文件结构无法解析。' }
  }
}

/**
 * 恢复期校验错误：仅携带字段路径与可读原因，不携带字段值。
 */
class WorkspaceRestoreError extends Error {
  readonly path: string
  readonly reason: string

  constructor(path: string, reason: string) {
    super(`${path}: ${reason}`)
    this.path = path
    this.reason = reason
  }
}

function restoreFail(path: string, reason: string): never {
  throw new WorkspaceRestoreError(path, reason)
}

const RESTORE_TARGET_KINDS = new Set(['plan', 'direct', 'reject'])
const RESTORE_MATCH_TYPES = new Set(['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD'])
const RESTORE_SOURCE_KINDS = new Set(['subscription', 'paste', 'manual'])
const RESTORE_SOURCE_STATUSES = new Set(['idle', 'loading', 'success', 'failed'])
const RESTORE_STRATEGIES = new Set(['select', 'url-test', 'fallback'])
const RESTORE_ROUTING_PRESETS = new Set(['all-proxy', 'cn-direct', 'custom'])
const RESTORE_NODE_TYPES = new Set(['vless', 'socks5', 'hysteria2', 'ss'])
const RESTORE_VLESS_SECURITIES = new Set(['none', 'tls', 'reality'])
const RESTORE_VLESS_TRANSPORTS = new Set(['tcp', 'ws', 'grpc'])
const RESTORE_DIAGNOSTIC_SEVERITIES = new Set(['error', 'warning'])
const RESTORE_DIAGNOSTIC_FORMATS = new Set([
  'clash-mihomo',
  'clash-snippet',
  'xray-json',
  'import-links',
])
const RESTORE_PARSE_ISSUE_KINDS = new Set(['unsupported', 'invalid', 'warning'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, path: string, reason = '必须是字符串'): string {
  if (typeof value !== 'string') {
    restoreFail(path, reason)
  }
  return value
}

function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    restoreFail(path, '必须是非空字符串')
  }
  return value
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  return requireString(value, path)
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'boolean') {
    restoreFail(path, '必须是布尔值')
  }
  return value
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    restoreFail(path, '必须是字符串数组')
  }
  return value as string[]
}

function requirePort(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 65535) {
    restoreFail(path, '必须是 1~65535 的整数')
  }
  return value as number
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    restoreFail(path, '必须是数组')
  }
  value.forEach((item, index) => {
    if (typeof item !== 'string') {
      restoreFail(`${path}[${index}]`, '必须是字符串')
    }
  })
  return [...(value as string[])]
}

function restoreEnvelopeFromParsed(parsed: unknown): SavedWorkspaceEnvelope {
  if (!isPlainObject(parsed)) {
    restoreFail('顶层', '必须是对象')
  }
  if (parsed.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    restoreFail(
      'schemaVersion',
      `必须为 ${WORKSPACE_SCHEMA_VERSION}（当前文件不兼容或字段缺失）`,
    )
  }
  if (!Array.isArray(parsed.plans) || parsed.plans.length === 0) {
    restoreFail('plans', '必须是包含至少一条方案的非空数组')
  }
  const plans = parsed.plans.map((plan, index) => restoreChainPlan(plan, `plans[${index}]`))

  const planIds = new Set<string>()
  plans.forEach((plan, index) => {
    if (planIds.has(plan.id)) {
      restoreFail(`plans[${index}].id`, '方案标识重复')
    }
    planIds.add(plan.id)
  })

  if (!Array.isArray(parsed.sources)) {
    restoreFail('sources', '必须是数组')
  }
  const sources = parsed.sources.map((source, index) =>
    restoreNodeSource(source, `sources[${index}]`),
  )
  const sourceIds = new Set<string>()
  sources.forEach((source, index) => {
    if (sourceIds.has(source.id)) {
      restoreFail(`sources[${index}].id`, '来源标识重复')
    }
    sourceIds.add(source.id)
  })

  const activePlanId =
    typeof parsed.activePlanId === 'string' && planIds.has(parsed.activePlanId)
      ? parsed.activePlanId
      : plans[0].id

  const includesCredentials = parsed.includesCredentials === true
  let nodes: ManagedNodeEntry[] | undefined
  if (includesCredentials && Array.isArray(parsed.nodes)) {
    nodes = parsed.nodes.map((entry, index) => restoreManagedNodeEntry(entry, `nodes[${index}]`))
    const nodeIds = new Set<string>()
    nodes.forEach((entry, index) => {
      if (nodeIds.has(entry.node.id)) {
        restoreFail(`nodes[${index}].node.id`, '节点标识重复')
      }
      nodeIds.add(entry.node.id)
    })
  }

  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
    includesCredentials,
    activePlanId,
    plans,
    sources,
    ...(nodes ? { nodes } : {}),
  }
}

function restoreChainPlan(plan: unknown, path: string): ChainPlan {
  if (!isPlainObject(plan)) {
    restoreFail(path, '必须是对象')
  }
  if (plan.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    restoreFail(`${path}.schemaVersion`, `必须为 ${WORKSPACE_SCHEMA_VERSION}`)
  }
  const id = requireNonEmptyString(plan.id, `${path}.id`)
  const name = requireString(plan.name, `${path}.name`)
  if (plan.mode !== 'simple' && plan.mode !== 'advanced') {
    restoreFail(`${path}.mode`, "必须是 'simple' 或 'advanced'")
  }
  const entry = restoreChainStage(plan.entry, `${path}.entry`)
  if (!Array.isArray(plan.relays)) {
    restoreFail(`${path}.relays`, '必须是数组')
  }
  const relays = (plan.relays as unknown[]).map((stage, index) =>
    restoreChainStage(stage, `${path}.relays[${index}]`),
  )
  const exit = restoreChainStage(plan.exit, `${path}.exit`)

  const stageIds = new Set<string>([entry.id, ...relays.map((stage) => stage.id), exit.id])
  if (stageIds.size !== 1 + relays.length + 1) {
    restoreFail(`${path}`, '同一方案内的层级标识重复')
  }

  if (!RESTORE_ROUTING_PRESETS.has(plan.routingPreset as string)) {
    restoreFail(`${path}.routingPreset`, "必须是 'all-proxy' / 'cn-direct' / 'custom' 之一")
  }
  if (!Array.isArray(plan.customRules)) {
    restoreFail(`${path}.customRules`, '必须是数组')
  }
  const customRules = (plan.customRules as unknown[]).map((rule, index) =>
    restoreCustomRoutingRule(rule, `${path}.customRules[${index}]`),
  )
  const customFallbackTarget = restoreRoutingTarget(
    plan.customFallbackTarget,
    `${path}.customFallbackTarget`,
  )
  const nodeHints = restoreNodeHints(plan.nodeHints, `${path}.nodeHints`)
  const hasInitializedSelection = optionalBoolean(
    plan.hasInitializedSelection,
    `${path}.hasInitializedSelection`,
  )

  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id,
    name,
    mode: plan.mode,
    entry,
    relays,
    exit,
    routingPreset: plan.routingPreset as ChainPlan['routingPreset'],
    customRules,
    customFallbackTarget,
    ...(nodeHints !== undefined ? { nodeHints } : {}),
    ...(hasInitializedSelection !== undefined ? { hasInitializedSelection } : {}),
  }
}

function restoreChainStage(stage: unknown, path: string): ChainStage {
  if (!isPlainObject(stage)) {
    restoreFail(path, '必须是对象')
  }
  const id = requireNonEmptyString(stage.id, `${path}.id`)
  const name = requireString(stage.name, `${path}.name`)
  const enabled = optionalBoolean(stage.enabled, `${path}.enabled`)
  if (enabled === undefined) {
    restoreFail(`${path}.enabled`, '必须是布尔值')
  }
  const candidateNodeIds = requireStringArray(stage.candidateNodeIds, `${path}.candidateNodeIds`)
  if (!RESTORE_STRATEGIES.has(stage.strategy as string)) {
    restoreFail(`${path}.strategy`, "必须是 'select' / 'url-test' / 'fallback' 之一")
  }
  const probe =
    stage.probe === undefined ? undefined : restoreStageProbe(stage.probe, `${path}.probe`)

  return {
    id,
    name,
    enabled,
    candidateNodeIds,
    strategy: stage.strategy as ChainStage['strategy'],
    ...(probe !== undefined ? { probe } : {}),
  }
}

function restoreStageProbe(probe: unknown, path: string): StageProbeConfig {
  if (!isPlainObject(probe)) {
    restoreFail(path, '必须是探测配置对象')
  }
  if (typeof probe.url !== 'string' || !/^https?:\/\/\S+$/i.test(probe.url.trim())) {
    restoreFail(`${path}.url`, '必须是有效的 http(s) 探测地址')
  }
  if (
    !Number.isInteger(probe.intervalSeconds) ||
    (probe.intervalSeconds as number) < 10 ||
    (probe.intervalSeconds as number) > 86400
  ) {
    restoreFail(`${path}.intervalSeconds`, '必须是 10~86400 的整数秒数')
  }
  let toleranceMs: number | undefined
  if (probe.toleranceMs !== undefined) {
    if (
      !Number.isInteger(probe.toleranceMs) ||
      (probe.toleranceMs as number) < 0 ||
      (probe.toleranceMs as number) > 10000
    ) {
      restoreFail(`${path}.toleranceMs`, '必须是 0~10000 的整数毫秒数')
    }
    toleranceMs = probe.toleranceMs as number
  }
  return {
    url: probe.url,
    intervalSeconds: probe.intervalSeconds as number,
    ...(toleranceMs !== undefined ? { toleranceMs } : {}),
  }
}

function restoreRoutingTarget(target: unknown, path: string): CustomRoutingTarget {
  if (!isPlainObject(target)) {
    restoreFail(path, '必须是路由目标对象')
  }
  if (!RESTORE_TARGET_KINDS.has(target.kind as string)) {
    restoreFail(`${path}.kind`, "必须是 'plan' / 'direct' / 'reject' 之一，未知 kind 不会被当作默认路由")
  }
  if (target.kind === 'direct') {
    return { kind: 'direct' }
  }
  if (target.kind === 'reject') {
    return { kind: 'reject' }
  }
  const planId = requireNonEmptyString(target.planId, `${path}.planId`)
  return { kind: 'plan', planId }
}

function restoreCustomRoutingRule(rule: unknown, path: string): CustomRoutingRule {
  if (!isPlainObject(rule)) {
    restoreFail(path, '必须是规则对象')
  }
  const id = requireNonEmptyString(rule.id, `${path}.id`)
  if (!RESTORE_MATCH_TYPES.has(rule.matchType as string)) {
    restoreFail(`${path}.matchType`, "必须是 'DOMAIN' / 'DOMAIN-SUFFIX' / 'DOMAIN-KEYWORD' 之一")
  }
  const pattern = requireString(rule.pattern, `${path}.pattern`)
  const target = restoreRoutingTarget(rule.target, `${path}.target`)
  return {
    id,
    matchType: rule.matchType as CustomRoutingRule['matchType'],
    pattern,
    target,
  }
}

function restoreNodeHints(
  hints: unknown,
  path: string,
): Record<string, NodeReferenceHint> | undefined {
  if (hints === undefined) {
    return undefined
  }
  if (!isPlainObject(hints)) {
    restoreFail(path, '必须是对象')
  }
  const result: Record<string, NodeReferenceHint> = {}
  for (const [nodeId, hint] of Object.entries(hints)) {
    const hintPath = `${path}.${nodeId}`
    if (!isPlainObject(hint)) {
      restoreFail(hintPath, '必须是节点引用提示对象')
    }
    const id = requireNonEmptyString(hint.id, `${hintPath}.id`)
    const name = requireString(hint.name, `${hintPath}.name`)
    if (!RESTORE_NODE_TYPES.has(hint.type as string)) {
      restoreFail(`${hintPath}.type`, '必须是受支持的协议类型')
    }
    const server = requireString(hint.server, `${hintPath}.server`)
    const port = requirePort(hint.port, `${hintPath}.port`)
    setOwnEntry(result, nodeId, {
      id,
      name,
      type: hint.type as NodeReferenceHint['type'],
      server,
      port,
    })
  }
  return result
}

function restoreNodeSource(source: unknown, path: string): NodeSource {
  if (!isPlainObject(source)) {
    restoreFail(path, '必须是对象')
  }
  const id = requireNonEmptyString(source.id, `${path}.id`)
  const name = requireString(source.name, `${path}.name`)
  if (!RESTORE_SOURCE_KINDS.has(source.kind as string)) {
    restoreFail(`${path}.kind`, "必须是 'subscription' / 'paste' / 'manual' 之一")
  }
  const nodeIds = requireStringArray(source.nodeIds, `${path}.nodeIds`)

  let status: NodeSource['status'] = 'idle'
  if (source.status !== undefined) {
    if (!RESTORE_SOURCE_STATUSES.has(source.status as string)) {
      restoreFail(`${path}.status`, "必须是 'idle' / 'loading' / 'success' / 'failed' 之一")
    }
    status = source.status as NodeSource['status']
  }
  const lastSuccessAt = optionalString(source.lastSuccessAt, `${path}.lastSuccessAt`)
  const errorMessage = optionalString(source.errorMessage, `${path}.errorMessage`)
  const parseStats =
    source.parseStats === undefined
      ? undefined
      : restoreSourceParseStats(source.parseStats, `${path}.parseStats`)

  return {
    id,
    name,
    kind: source.kind as NodeSource['kind'],
    nodeIds,
    status,
    ...(lastSuccessAt !== undefined ? { lastSuccessAt } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    ...(parseStats !== undefined ? { parseStats } : {}),
  }
}

function restoreSourceParseStats(stats: unknown, path: string): NonNullable<NodeSource['parseStats']> {
  if (!isPlainObject(stats)) {
    restoreFail(path, '必须是解析统计对象')
  }
  for (const key of ['validCount', 'unsupportedCount', 'invalidCount'] as const) {
    if (!Number.isInteger(stats[key]) || (stats[key] as number) < 0) {
      restoreFail(`${path}.${key}`, '必须是非负整数')
    }
  }
  let issues: ParseIssue[] = []
  if (stats.issues !== undefined) {
    if (!Array.isArray(stats.issues)) {
      restoreFail(`${path}.issues`, '必须是数组')
    }
    issues = (stats.issues as unknown[]).map((issue, index) => {
      const issuePath = `${path}.issues[${index}]`
      if (!isPlainObject(issue)) {
        restoreFail(issuePath, '必须是解析问题对象')
      }
      if (!RESTORE_PARSE_ISSUE_KINDS.has(issue.kind as string)) {
        restoreFail(`${issuePath}.kind`, "必须是 'unsupported' / 'invalid' / 'warning' 之一")
      }
      const label = requireString(issue.label, `${issuePath}.label`)
      const message = requireString(issue.message, `${issuePath}.message`)
      const field = optionalString(issue.field, `${issuePath}.field`)
      return {
        kind: issue.kind as ParseIssue['kind'],
        label,
        ...(field !== undefined ? { field } : {}),
        message,
      }
    })
  }
  return {
    validCount: stats.validCount as number,
    unsupportedCount: stats.unsupportedCount as number,
    invalidCount: stats.invalidCount as number,
    issues,
  }
}

function restoreManagedNodeEntry(entry: unknown, path: string): ManagedNodeEntry {
  if (!isPlainObject(entry)) {
    restoreFail(path, '必须是节点条目对象')
  }
  const node = restoreNormalizedProxyNode(entry.node, `${path}.node`)
  const sourceIds = requireStringArray(entry.sourceIds, `${path}.sourceIds`).map((id) => {
    if (!id.trim()) {
      restoreFail(`${path}.sourceIds`, '必须是非空字符串')
    }
    return id
  })
  if (!isPlainObject(entry.sourceAliases)) {
    restoreFail(`${path}.sourceAliases`, '必须是对象')
  }
  const sourceAliases: Record<string, string> = {}
  for (const [sourceId, alias] of Object.entries(entry.sourceAliases)) {
    if (typeof alias !== 'string') {
      restoreFail(`${path}.sourceAliases.${sourceId}`, '必须是字符串')
    }
    setOwnEntry(sourceAliases, sourceId, alias)
  }
  const displayName = requireNonEmptyString(entry.displayName, `${path}.displayName`)
  const userAlias = optionalString(entry.userAlias, `${path}.userAlias`)

  // 旧版 schemaVersion 1 文件没有 userAlias 字段。此时若 displayName 不同于所有
  // 来源原名，说明是用户设置过的历史覆盖，迁移为显式用户覆盖，避免后续刷新
  // 把别名重置回订阅原名；displayName 与来源原名一致时不固化，无覆盖的来源
  // 改名仍按现有规则跟随更新。
  let effectiveUserAlias: string | undefined
  if (userAlias !== undefined && userAlias.trim()) {
    effectiveUserAlias = userAlias.trim()
  } else if (userAlias === undefined) {
    const sourceNames = sourceIds.map(
      (id) => readSourceAlias(sourceAliases, id) ?? '',
    )
    if (displayName.trim() && !sourceNames.includes(displayName)) {
      effectiveUserAlias = displayName
    }
  }

  return {
    node,
    sourceIds,
    sourceAliases,
    displayName,
    ...(effectiveUserAlias !== undefined ? { userAlias: effectiveUserAlias } : {}),
  }
}

function restoreNormalizedProxyNode(node: unknown, path: string): NormalizedProxyNode {
  if (!isPlainObject(node)) {
    restoreFail(path, '必须是对象')
  }
  if (!RESTORE_NODE_TYPES.has(node.type as string)) {
    restoreFail(`${path}.type`, '必须是受支持的协议类型 (vless/socks5/hysteria2/ss)')
  }
  const common = {
    id: requireNonEmptyString(node.id, `${path}.id`),
    name: requireString(node.name, `${path}.name`),
    server: requireNonEmptyString(node.server, `${path}.server`),
    port: requirePort(node.port, `${path}.port`),
    ...(optionalString(node.raw, `${path}.raw`) !== undefined
      ? { raw: node.raw as string }
      : {}),
    ...(node.issues !== undefined
      ? { issues: restoreNodeDiagnostics(node.issues, `${path}.issues`) }
      : {}),
  }

  if (node.type === 'vless') {
    return {
      ...common,
      type: 'vless' as const,
      uuid: requireNonEmptyString(node.uuid, `${path}.uuid`),
      security: restoreVlessSecurity(node.security, `${path}.security`),
      ...(optionalString(node.encryption, `${path}.encryption`) !== undefined
        ? { encryption: node.encryption as string }
        : {}),
      ...(optionalString(node.flow, `${path}.flow`) !== undefined
        ? { flow: node.flow as string }
        : {}),
      ...(optionalString(node.sni, `${path}.sni`) !== undefined ? { sni: node.sni as string } : {}),
      ...(optionalString(node.fp, `${path}.fp`) !== undefined ? { fp: node.fp as string } : {}),
      ...(optionalString(node.pbk, `${path}.pbk`) !== undefined ? { pbk: node.pbk as string } : {}),
      ...(optionalString(node.sid, `${path}.sid`) !== undefined ? { sid: node.sid as string } : {}),
      ...(optionalString(node.spx, `${path}.spx`) !== undefined ? { spx: node.spx as string } : {}),
      ...(optionalString(node.headerType, `${path}.headerType`) !== undefined
        ? { headerType: node.headerType as string }
        : {}),
      ...(restoreVlessPacketType(node.packetType, `${path}.packetType`) !== undefined
        ? { packetType: node.packetType as string }
        : {}),
      ...(restoreVlessWsOpts(node.wsOpts, `${path}.wsOpts`) !== undefined
        ? { wsOpts: node.wsOpts as VlessWsOpts }
        : {}),
      ...(restoreVlessGrpcOpts(node.grpcOpts, `${path}.grpcOpts`) !== undefined
        ? { grpcOpts: node.grpcOpts as VlessGrpcOpts }
        : {}),
      ...(optionalString(node.packetEncoding, `${path}.packetEncoding`) !== undefined
        ? { packetEncoding: node.packetEncoding as string }
        : {}),
      ...(optionalBoolean(node.skipCertVerify, `${path}.skipCertVerify`) !== undefined
        ? { skipCertVerify: node.skipCertVerify as boolean }
        : {}),
      ...(optionalStringArray(node.alpn, `${path}.alpn`) !== undefined
        ? { alpn: node.alpn as string[] }
        : {}),
      ...(optionalBoolean(node.udp, `${path}.udp`) !== undefined ? { udp: node.udp as boolean } : {}),
    }
  }

  if (node.type === 'socks5') {
    return {
      ...common,
      type: 'socks5' as const,
      ...(optionalString(node.username, `${path}.username`) !== undefined
        ? { username: node.username as string }
        : {}),
      ...(optionalString(node.password, `${path}.password`) !== undefined
        ? { password: node.password as string }
        : {}),
      ...(optionalBoolean(node.udp, `${path}.udp`) !== undefined ? { udp: node.udp as boolean } : {}),
      ...(optionalBoolean(node.tls, `${path}.tls`) !== undefined ? { tls: node.tls as boolean } : {}),
      ...(optionalString(node.sni, `${path}.sni`) !== undefined ? { sni: node.sni as string } : {}),
      ...(optionalString(node.fp, `${path}.fp`) !== undefined ? { fp: node.fp as string } : {}),
      ...(optionalBoolean(node.skipCertVerify, `${path}.skipCertVerify`) !== undefined
        ? { skipCertVerify: node.skipCertVerify as boolean }
        : {}),
    }
  }

  if (node.type === 'hysteria2') {
    return {
      ...common,
      type: 'hysteria2' as const,
      ...(optionalString(node.password, `${path}.password`) !== undefined
        ? { password: node.password as string }
        : {}),
      ...(optionalString(node.sni, `${path}.sni`) !== undefined ? { sni: node.sni as string } : {}),
      ...(optionalString(node.obfs, `${path}.obfs`) !== undefined
        ? { obfs: node.obfs as string }
        : {}),
      ...(optionalString(node.obfsPassword, `${path}.obfsPassword`) !== undefined
        ? { obfsPassword: node.obfsPassword as string }
        : {}),
      ...(optionalString(node.fingerprint, `${path}.fingerprint`) !== undefined
        ? { fingerprint: node.fingerprint as string }
        : {}),
      ...(optionalString(node.ports, `${path}.ports`) !== undefined
        ? { ports: node.ports as string }
        : {}),
      ...(optionalString(node.up, `${path}.up`) !== undefined ? { up: node.up as string } : {}),
      ...(optionalString(node.down, `${path}.down`) !== undefined
        ? { down: node.down as string }
        : {}),
      ...(optionalStringArray(node.alpn, `${path}.alpn`) !== undefined
        ? { alpn: node.alpn as string[] }
        : {}),
      ...(optionalBoolean(node.skipCertVerify, `${path}.skipCertVerify`) !== undefined
        ? { skipCertVerify: node.skipCertVerify as boolean }
        : {}),
      ...(optionalBoolean(node.udp, `${path}.udp`) !== undefined ? { udp: node.udp as boolean } : {}),
    }
  }

  return {
    ...common,
    type: 'ss' as const,
    cipher: requireNonEmptyString(node.cipher, `${path}.cipher`),
    password: requireString(node.password, `${path}.password`),
    ...(optionalString(node.plugin, `${path}.plugin`) !== undefined
      ? { plugin: node.plugin as string }
      : {}),
    ...(restorePluginOpts(node.pluginOpts, `${path}.pluginOpts`) !== undefined
      ? { pluginOpts: node.pluginOpts as Record<string, ProxyScalar> }
      : {}),
    ...(optionalBoolean(node.udp, `${path}.udp`) !== undefined ? { udp: node.udp as boolean } : {}),
    ...(optionalBoolean(node.udpOverTcp, `${path}.udpOverTcp`) !== undefined
      ? { udpOverTcp: node.udpOverTcp as boolean }
      : {}),
  }
}

function restoreVlessSecurity(value: unknown, path: string): VlessSecurity {
  if (!RESTORE_VLESS_SECURITIES.has(value as string)) {
    restoreFail(path, "必须是 'none' / 'tls' / 'reality' 之一")
  }
  return value as VlessSecurity
}

function restoreVlessPacketType(value: unknown, path: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string' || !RESTORE_VLESS_TRANSPORTS.has(value)) {
    restoreFail(path, "必须是 'tcp' / 'ws' / 'grpc' 之一")
  }
  return value
}

function restoreVlessWsOpts(value: unknown, path: string): VlessWsOpts | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isPlainObject(value)) {
    restoreFail(path, '必须是 WebSocket 传输配置对象')
  }
  const wsPath = optionalString(value.path, `${path}.path`)
  let headers: Record<string, string> | undefined
  if (value.headers !== undefined) {
    if (!isPlainObject(value.headers)) {
      restoreFail(`${path}.headers`, '必须是对象')
    }
    for (const [key, headerValue] of Object.entries(value.headers)) {
      if (typeof headerValue !== 'string') {
        restoreFail(`${path}.headers.${key}`, '必须是字符串')
      }
    }
    headers = { ...(value.headers as Record<string, string>) }
  }
  let maxEarlyData: number | undefined
  if (value.maxEarlyData !== undefined) {
    if (!Number.isInteger(value.maxEarlyData) || (value.maxEarlyData as number) < 0) {
      restoreFail(`${path}.maxEarlyData`, '必须是非负整数')
    }
    maxEarlyData = value.maxEarlyData as number
  }
  const earlyDataHeaderName = optionalString(
    value.earlyDataHeaderName,
    `${path}.earlyDataHeaderName`,
  )
  const v2rayHttpUpgrade = optionalBoolean(value.v2rayHttpUpgrade, `${path}.v2rayHttpUpgrade`)
  return {
    ...(wsPath !== undefined ? { path: wsPath } : {}),
    ...(headers !== undefined ? { headers } : {}),
    ...(maxEarlyData !== undefined ? { maxEarlyData } : {}),
    ...(earlyDataHeaderName !== undefined ? { earlyDataHeaderName } : {}),
    ...(v2rayHttpUpgrade !== undefined ? { v2rayHttpUpgrade } : {}),
  }
}

function restoreVlessGrpcOpts(value: unknown, path: string): VlessGrpcOpts | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isPlainObject(value)) {
    restoreFail(path, '必须是 gRPC 传输配置对象')
  }
  const serviceName = optionalString(value.serviceName, `${path}.serviceName`)
  const mode = optionalString(value.mode, `${path}.mode`)
  return {
    ...(serviceName !== undefined ? { serviceName } : {}),
    ...(mode !== undefined ? { mode } : {}),
  }
}

function restorePluginOpts(value: unknown, path: string): Record<string, ProxyScalar> | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!isPlainObject(value)) {
    restoreFail(path, '必须是插件参数对象')
  }
  const result: Record<string, ProxyScalar> = {}
  for (const [key, optValue] of Object.entries(value)) {
    if (
      typeof optValue !== 'string' &&
      typeof optValue !== 'number' &&
      typeof optValue !== 'boolean'
    ) {
      restoreFail(`${path}.${key}`, '必须是字符串、数字或布尔值')
    }
    result[key] = optValue as ProxyScalar
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function restoreNodeDiagnostics(value: unknown, path: string): NodeDiagnostic[] {
  if (!Array.isArray(value)) {
    restoreFail(path, '必须是诊断数组')
  }
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`
    if (!isPlainObject(item)) {
      restoreFail(itemPath, '必须是诊断对象')
    }
    if (!RESTORE_DIAGNOSTIC_SEVERITIES.has(item.severity as string)) {
      restoreFail(`${itemPath}.severity`, "必须是 'error' 或 'warning'")
    }
    if (!Array.isArray(item.formats) || item.formats.some((f) => !RESTORE_DIAGNOSTIC_FORMATS.has(f))) {
      restoreFail(`${itemPath}.formats`, '必须是受支持的导出格式数组')
    }
    const code = requireNonEmptyString(item.code, `${itemPath}.code`)
    const message = requireString(item.message, `${itemPath}.message`)
    const field = optionalString(item.field, `${itemPath}.field`)
    return {
      severity: item.severity as NodeDiagnostic['severity'],
      formats: [...(item.formats as NodeDiagnostic['formats'])],
      ...(field !== undefined ? { field } : {}),
      code,
      message,
    }
  })
}

export { PROTOCOL_CAPABILITY_MATRIX }
