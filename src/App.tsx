import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, Link2, Plus, Route, Settings2, ShieldCheck } from 'lucide-react'
import {
  DEFAULT_PROBE_CONFIG,
  MAX_ENABLED_CHAIN_LAYERS,
  MAX_PLAN_FILE_BYTES,
  PLAN_FILE_TOO_LARGE_MESSAGE,
  buildChainPreview,
  computeSourceDeletionImpact,
  createDefaultChainPlan,
  createDefaultStage,
  duplicateChainPlan,
  loadSubscriptionContent,
  parseProxyInputDetailed,
  parseYamlProxiesDetailed,
  probeSameOriginCapabilities,
  createRegistryFromEntries,
  removeSourceFromWorkspace,
  renameNodeDisplayAlias,
  restoreDeletedSource,
  serializeWorkspaceState,
  stringifyYamlConfig,
  syncPlanNodeHints,
  upsertSourceNodes,
  validateAndExportPlan,
  validateAndRestoreWorkspace,
} from './lib'
import type {
  BackendCapabilities,
  ChainPlan,
  ChainStage,
  CustomRoutingRule,
  CustomRoutingTarget,
  FetchMode,
  ImportedMihomoChain,
  ManagedNodeEntry,
  NodeSource,
  NormalizedProxyNode,
  ProxyScalar,
  RoutingPreset,
  SelectionStrategy,
  SourceDeletionImpact,
} from './lib'
import { ChainPreviewCard } from './components/ChainPreviewCard'
import { OutputPanel } from './components/OutputPanel'
import { PlanWorkspaceBar } from './components/PlanWorkspaceBar'
import { RoutingConfigCard } from './components/RoutingConfigCard'
import type { ManualNodeFormState } from './components/manual-node-form-state'
import { SourceManagerPanel } from './components/SourceManagerPanel'
import { StageConfigCard } from './components/StageConfigCard'
import type {
  NodeImportFeedback,
  StageNodeImportActions,
} from './components/StageNodeImportPanel'
import { StatusBar } from './components/StatusBar'
import { COPY, type Language } from './components/types-i18n'
import './App.css'

const LOCAL_STORAGE_KEY = 'proxy-chain:workspace:v1'

interface StageNodeImportTarget {
  planId: string
  stageId: string
  role: 'entry' | 'exit'
}

interface NodeImportContext {
  target: StageNodeImportTarget
  onFeedback: (feedback: NodeImportFeedback) => void
  signal?: AbortSignal
}

function selectImportedStageNodes(
  plan: ChainPlan,
  target: StageNodeImportTarget | undefined,
  nodeIds: string[],
): ChainPlan {
  if (!target || plan.id !== target.planId || plan[target.role].id !== target.stageId) {
    return plan
  }
  const stage = plan[target.role]
  return {
    ...plan,
    [target.role]: {
      ...stage,
      candidateNodeIds: [...new Set([...stage.candidateNodeIds, ...nodeIds])],
    },
    hasInitializedSelection: true,
  }
}

function makeClientId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function parseManualPluginOpts(raw: string): Record<string, ProxyScalar> | undefined {
  const trimmed = raw.trim()
  if (!trimmed) {
    return undefined
  }
  const result: Record<string, ProxyScalar> = {}
  for (const part of trimmed.split(';')) {
    const clean = part.trim()
    if (!clean) {
      continue
    }
    const eqIndex = clean.indexOf('=')
    if (eqIndex === -1) {
      result[clean] = true
    } else {
      const k = clean.slice(0, eqIndex).trim()
      const v = clean.slice(eqIndex + 1).trim()
      if (k) {
        result[k] = v
      }
    }
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function readHasSavedWorkspace(): boolean {
  try {
    return Boolean(globalThis.localStorage?.getItem(LOCAL_STORAGE_KEY))
  } catch {
    return false
  }
}

function downloadJsonFile(filename: string, data: unknown): void {
  const text = JSON.stringify(data, null, 2)
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

interface WorkspaceState {
  sources: NodeSource[]
  registry: Record<string, ManagedNodeEntry>
  plans: ChainPlan[]
  activePlanId: string
}

function mergeImportedSource(
  workspace: WorkspaceState,
  source: NodeSource,
  nodes: NormalizedProxyNode[],
  target?: StageNodeImportTarget,
  targetNodeIds?: string[],
): WorkspaceState {
  const merged = upsertSourceNodes(workspace.registry, workspace.sources, source, nodes)
  const nodeIds = target ? targetNodeIds ?? nodes.map((node) => node.id) : []
  return {
    ...workspace,
    ...merged,
    plans: workspace.plans.map((plan) =>
      syncPlanNodeHints(selectImportedStageNodes(plan, target, nodeIds), merged.registry),
    ),
  }
}

function createImportedMihomoPlan(chain: ImportedMihomoChain, name: string): ChainPlan {
  const plan = createDefaultChainPlan(makeClientId('plan'), name)
  const stages = chain.stages.map(({ name, ...stage }, index) => {
    const fallback = index === 0
      ? plan.entry
      : index === chain.stages.length - 1
        ? plan.exit
        : createDefaultStage(`stage-relay-${index}`, `中转 ${index}`)
    return { ...fallback, ...stage, name: name ?? fallback.name }
  })
  const relays = stages.slice(1, -1)
  return {
    ...plan,
    entry: stages[0],
    relays,
    exit: stages[stages.length - 1],
    mode: relays.length > 0 ? 'advanced' : 'simple',
    routingPreset: chain.routingPreset,
    hasInitializedSelection: true,
  }
}

export function App() {
  const [language, setLanguage] = useState<Language>('zh')
  const copy = COPY[language]

  const [capabilities, setCapabilities] = useState<BackendCapabilities>({
    status: 'checking',
    fetchSubscription: false,
    temporaryClashConfig: false,
  })

  const [workspace, setWorkspace] = useState<WorkspaceState>(() => ({
    sources: [],
    registry: {},
    plans: [createDefaultChainPlan('plan-default', '默认方案')],
    activePlanId: 'plan-default',
  }))
  const { sources, registry, plans, activePlanId } = workspace

  const [fetchMode, setFetchMode] = useState<FetchMode>('auto')
  const [fetcherEndpoint, setFetcherEndpoint] = useState('')
  const [fetcherToken, setFetcherToken] = useState('')
  const [sourceFeedback, setSourceFeedback] = useState<NodeImportFeedback | null>(null)
  const [pendingDeleteImpact, setPendingDeleteImpact] = useState<SourceDeletionImpact | null>(
    null,
  )
  // 撤销只记录本次删除的差量数据（目标来源 + 关联节点条目 + 该来源的会话订阅 URL），
  // 撤销时基于最新工作区合并恢复，不用旧快照整体覆盖期间的新增或编辑。
  const [undoSnapshot, setUndoSnapshot] = useState<{
    source: NodeSource
    nodeEntries: ManagedNodeEntry[]
    subscriptionUrl?: string
  } | null>(null)

  const [includeCredsInLocalSave, setIncludeCredsInLocalSave] = useState(false)
  const [hasLocalSavedData, setHasLocalSavedData] = useState<boolean>(() =>
    readHasSavedWorkspace(),
  )
  const [persistenceFeedback, setPersistenceFeedback] = useState<{
    kind: 'info' | 'error'
    message: string
  } | null>(null)

  const [draggedRelayId, setDraggedRelayId] = useState<string | null>(null)

  // 运行时仅在内存中记录订阅源 URL 与在途请求控制器（不随方案 JSON/默认持久化写入磁盘）
  const subscriptionUrlsRef = useRef<Map<string, string>>(new Map())
  const refreshControllersRef = useRef<Map<string, AbortController>>(new Map())
  const refreshVersionsRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const controller = new AbortController()
    probeSameOriginCapabilities({ signal: controller.signal }).then((caps) => {
      if (!controller.signal.aborted) {
        setCapabilities(caps)
      }
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controllers = refreshControllersRef.current
    return () => {
      for (const controller of controllers.values()) {
        controller.abort()
      }
      controllers.clear()
    }
  }, [])

  const activePlan = useMemo(
    () => plans.find((p) => p.id === activePlanId) ?? plans[0],
    [plans, activePlanId],
  )

  const updateActivePlan = useCallback(
    (updater: (prev: ChainPlan) => ChainPlan) => {
      setWorkspace((prevWorkspace) => {
        const targetId =
          prevWorkspace.plans.find((p) => p.id === prevWorkspace.activePlanId)?.id ??
          prevWorkspace.plans[0]?.id
        return {
          ...prevWorkspace,
          plans: prevWorkspace.plans.map((plan) =>
            plan.id === targetId ? updater(plan) : plan,
          ),
        }
      })
    },
    [],
  )

  const updateStage = useCallback(
    (
      role: 'entry' | 'relay' | 'exit',
      stageId: string,
      updater: (stage: ChainStage) => ChainStage,
    ) => {
      updateActivePlan((prev) => {
        if (role === 'entry') {
          return { ...prev, entry: updater(prev.entry), hasInitializedSelection: true }
        }
        if (role === 'exit') {
          return { ...prev, exit: updater(prev.exit), hasInitializedSelection: true }
        }
        return {
          ...prev,
          relays: prev.relays.map((r) => (r.id === stageId ? updater(r) : r)),
          hasInitializedSelection: true,
        }
      })
    },
    [updateActivePlan],
  )


  const reportImportFeedback = useCallback(
    (feedback: NodeImportFeedback, context?: NodeImportContext) => {
      if (!context) {
        setSourceFeedback(feedback)
      } else if (!context.signal?.aborted) {
        context.onFeedback(feedback)
      }
    },
    [],
  )

  const executeSubscriptionFetch = useCallback(
    async (
      sourceId: string,
      sourceName: string,
      url: string,
      isNewSource: boolean,
      context?: NodeImportContext,
    ) => {
      if (context?.signal?.aborted) {
        return false
      }
      const prevController = refreshControllersRef.current.get(sourceId)
      if (prevController) {
        prevController.abort()
      }

      const controller = new AbortController()
      refreshControllersRef.current.set(sourceId, controller)
      const cancelFromNodeForm = () => controller.abort()
      context?.signal?.addEventListener('abort', cancelFromNodeForm, { once: true })
      const requestVersion = (refreshVersionsRef.current.get(sourceId) ?? 0) + 1
      refreshVersionsRef.current.set(sourceId, requestVersion)

      const newSource: NodeSource = {
        id: sourceId,
        name: sourceName,
        kind: 'subscription',
        nodeIds: [],
        status: 'loading',
      }
      // 分层表单自行显示请求进度，成功后才在来源列表登记订阅。
      const addAfterFetch = isNewSource && Boolean(context)
      let imported = false
      if (!addAfterFetch) {
        subscriptionUrlsRef.current.set(sourceId, url)
        setWorkspace((prev) => ({
          ...prev,
          sources: isNewSource
            ? [...prev.sources, newSource]
            : prev.sources.map((src) =>
                src.id === sourceId ? { ...src, status: 'loading', errorMessage: undefined } : src,
              ),
        }))
      }

      try {
        const rawContent = await loadSubscriptionContent(url, {
          endpoint: fetcherEndpoint,
          sameOriginFetchAvailable: capabilities.fetchSubscription,
          token: fetcherToken,
          mode: fetchMode,
          signal: controller.signal,
        })

        if (
          controller.signal.aborted ||
          refreshVersionsRef.current.get(sourceId) !== requestVersion
        ) {
          return false
        }

        const parsed = parseProxyInputDetailed(rawContent)
        if (
          parsed.validCount === 0 &&
          parsed.unsupportedCount === 0 &&
          parsed.invalidCount === 0
        ) {
          throw new Error(
            language === 'zh' ? '订阅返回为空，未识别到任何代理节点。' : 'Empty subscription response.',
          )
        }

        if (parsed.validCount === 0) {
          throw new Error(
            parsed.warnings[0] ??
              (language === 'zh'
                ? '订阅未解析出可用节点，已保留旧节点。'
                : 'No valid nodes parsed; previous nodes retained.'),
          )
        }

        const lastSuccessAt = new Date().toISOString()
        setWorkspace((prev) => {
          const currentTarget = addAfterFetch ? newSource : prev.sources.find((s) => s.id === sourceId)
          if (
            !currentTarget ||
            controller.signal.aborted ||
            refreshVersionsRef.current.get(sourceId) !== requestVersion
          ) {
            return prev
          }
          const updatedSource: NodeSource = {
            ...currentTarget,
            status: 'success',
            errorMessage: undefined,
            lastSuccessAt,
            parseStats: {
              validCount: parsed.validCount,
              unsupportedCount: parsed.unsupportedCount,
              invalidCount: parsed.invalidCount,
              issues: parsed.issues,
            },
          }
          return mergeImportedSource(prev, updatedSource, parsed.nodes, context?.target)
        })
        if (addAfterFetch) {
          subscriptionUrlsRef.current.set(sourceId, url)
        }
        imported = true

        reportImportFeedback({
          kind: 'info',
          message:
            language === 'zh'
              ? `订阅 "${sourceName}" 更新成功：有效 ${parsed.validCount} / 不支持 ${parsed.unsupportedCount} / 无效 ${parsed.invalidCount}。`
              : `Subscription "${sourceName}" loaded: ${parsed.validCount} valid / ${parsed.unsupportedCount} unsupported / ${parsed.invalidCount} invalid.`,
        }, context)
        return true
      } catch (err) {
        if (
          controller.signal.aborted ||
          refreshVersionsRef.current.get(sourceId) !== requestVersion
        ) {
          return false
        }
        const message = err instanceof Error ? err.message : String(err)
        if (!addAfterFetch) {
          setWorkspace((prev) => ({
            ...prev,
            sources: prev.sources.map((src) =>
              src.id === sourceId ? { ...src, status: 'failed', errorMessage: message } : src,
            ),
          }))
        }
        reportImportFeedback({ kind: 'error', message }, context)
        return false
      } finally {
        context?.signal?.removeEventListener('abort', cancelFromNodeForm)
        if (refreshControllersRef.current.get(sourceId) === controller) {
          refreshControllersRef.current.delete(sourceId)
          if (addAfterFetch && !imported) {
            refreshVersionsRef.current.delete(sourceId)
          }
        }
      }
    },
    [
      capabilities.fetchSubscription,
      fetchMode,
      fetcherEndpoint,
      fetcherToken,
      language,
      reportImportFeedback,
    ],
  )

  const handleAddSubscription = async (name: string, url: string, context?: NodeImportContext): Promise<boolean> => {
    const cleanUrl = url.trim()
    if (!cleanUrl) {
      return false
    }
    const label =
      name.trim() ||
      (language === 'zh' ? `订阅-${sources.length + 1}` : `Sub-${sources.length + 1}`)
    const sourceId = makeClientId('src')
    return executeSubscriptionFetch(sourceId, label, cleanUrl, true, context)
  }

  const handleRefreshSubscription = (sourceId: string) => {
    const target = sources.find((s) => s.id === sourceId)
    const url = subscriptionUrlsRef.current.get(sourceId)
    if (!target || !url) {
      setSourceFeedback({
        kind: 'error',
        message:
          language === 'zh'
            ? '当前会话不包含该订阅的原始 URL，请通过“添加订阅”重新填入链接。'
            : 'Subscription URL not held in memory for this source; please re-add it.',
      })
      return
    }
    void executeSubscriptionFetch(sourceId, target.name, url, false)
  }

  const handleCancelRefresh = (sourceId: string) => {
    const controller = refreshControllersRef.current.get(sourceId)
    if (controller) {
      controller.abort()
      refreshControllersRef.current.delete(sourceId)
    }
    setWorkspace((prev) => ({
      ...prev,
      sources: prev.sources.map((src) =>
        src.id === sourceId ? { ...src, status: src.nodeIds.length > 0 ? 'success' : 'idle' } : src,
      ),
    }))
  }

  const handleAddPaste = (name: string, text: string, context?: NodeImportContext): boolean => {
    const parsed = parseProxyInputDetailed(text)
    if (parsed.validCount === 0 && parsed.unsupportedCount === 0 && parsed.invalidCount === 0) {
      reportImportFeedback({
        kind: 'error',
        message: language === 'zh' ? '输入为空，未解析到节点。' : 'Empty input.',
      }, context)
      return false
    }
    if (parsed.validCount === 0) {
      reportImportFeedback({
        kind: 'error',
        message:
          parsed.issues[0]?.message ??
          parsed.warnings[0] ??
          (language === 'zh' ? '未能解析到受支持的节点。' : 'No supported nodes found.'),
      }, context)
      return false
    }

    const label =
      name.trim() ||
      (language === 'zh' ? `粘贴来源-${sources.length + 1}` : `Paste-${sources.length + 1}`)
    const chain = parsed.mihomoChain && parsed.mihomoChain.stages.length <= MAX_ENABLED_CHAIN_LAYERS
      ? parsed.mihomoChain
      : undefined
    const importedPlan = chain && !context
      ? createImportedMihomoPlan(chain, label.replace(/\.ya?ml$/i, '').trim() || label)
      : undefined
    const targetNodeIds = chain && context
      ? chain.stages.at(context.target.role === 'entry' ? 0 : -1)?.candidateNodeIds
      : undefined
    const restoredDialerIds = new Set(
      importedPlan && chain ? chain.stages.slice(1).flatMap((stage) => stage.candidateNodeIds) : [],
    )
    const nodes = parsed.nodes.map((node) => restoredDialerIds.has(node.id) && node.issues
      ? { ...node, issues: node.issues.filter((issue) => issue.code !== 'ignored_input_dialer_proxy') }
      : node,
    )
    const incoming: NodeSource = {
      id: makeClientId('src'),
      name: label,
      kind: 'paste',
      nodeIds: [],
      status: 'success',
      lastSuccessAt: new Date().toISOString(),
      parseStats: {
        validCount: parsed.validCount,
        unsupportedCount: parsed.unsupportedCount,
        invalidCount: parsed.invalidCount,
        issues: parsed.issues,
      },
    }
    setWorkspace((prev) => {
      const merged = mergeImportedSource(prev, incoming, nodes, context?.target, targetNodeIds)
      if (!importedPlan) return merged
      return {
        ...merged,
        plans: [...merged.plans, syncPlanNodeHints(importedPlan, merged.registry)],
        activePlanId: importedPlan.id,
      }
    })
    const summary = language === 'zh'
      ? `已添加 "${label}"：有效 ${parsed.validCount} / 不支持 ${parsed.unsupportedCount} / 无效 ${parsed.invalidCount}。`
      : `Added "${label}": ${parsed.validCount} valid / ${parsed.unsupportedCount} unsupported / ${parsed.invalidCount} invalid.`
    let chainSummary = ''
    if (importedPlan) {
      const entryCount = importedPlan.entry.candidateNodeIds.length
      const exitCount = importedPlan.exit.candidateNodeIds.length
      const layerCount = importedPlan.relays.length + 2
      chainSummary = language === 'zh'
        ? `已恢复 ${layerCount} 层链路，入口 ${entryCount} 个、出口 ${exitCount} 个。`
        : ` Restored a ${layerCount}-stage chain with ${entryCount} entry and ${exitCount} exit nodes.`
    } else if (parsed.mihomoChain !== undefined && !chain) {
      chainSummary = language === 'zh'
        ? '未能还原文件中的链路或分流规则，请在链路页核对。'
        : ' The chain or routing rules could not be restored. Review the chain before exporting.'
    }
    reportImportFeedback({
      kind: 'info',
      message: summary + chainSummary,
    }, context)
    return true
  }

  const handleAddManual = (form: ManualNodeFormState, context?: NodeImportContext): boolean => {
    const portNum = Number(form.port)
    if (!form.server.trim() || !Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      reportImportFeedback({
        kind: 'error',
        message:
          language === 'zh'
            ? '请填写合法服务器地址与 1~65535 整数端口。'
            : 'Provide a valid server and integer port (1-65535).',
      }, context)
      return false
    }
    const name = form.name.trim() || `${form.server.trim()}:${portNum}`
    let yamlObj: Record<string, unknown>
    if (form.protocol === 'vless') {
      yamlObj = {
        name,
        type: 'vless',
        server: form.server.trim(),
        port: portNum,
        uuid: form.uuid.trim(),
        tls: form.security !== 'none',
        network: form.packetType,
        ...(form.sni.trim() ? { servername: form.sni.trim() } : {}),
        ...(form.fp.trim() ? { 'client-fingerprint': form.fp.trim() } : {}),
        ...(form.security === 'reality'
          ? {
              'reality-opts': {
                'public-key': form.pbk.trim(),
                ...(form.sid.trim() ? { 'short-id': form.sid.trim() } : {}),
              },
            }
          : {}),
        ...(form.packetType === 'ws'
          ? {
              'ws-opts': {
                path: form.wsPath.trim() || '/',
                ...(form.wsHost.trim() ? { headers: { Host: form.wsHost.trim() } } : {}),
              },
            }
          : {}),
        ...(form.packetType === 'grpc' && form.grpcServiceName.trim()
          ? { 'grpc-opts': { 'grpc-service-name': form.grpcServiceName.trim() } }
          : {}),
        udp: form.udp,
        ...(form.skipCertVerify ? { 'skip-cert-verify': true } : {}),
      }
    } else if (form.protocol === 'socks5') {
      yamlObj = {
        name,
        type: 'socks5',
        server: form.server.trim(),
        port: portNum,
        ...(form.username.trim() ? { username: form.username.trim() } : {}),
        ...(form.password ? { password: form.password } : {}),
        udp: form.udp,
        ...(form.skipCertVerify ? { 'skip-cert-verify': true } : {}),
      }
    } else if (form.protocol === 'ss') {
      const pluginOpts = parseManualPluginOpts(form.pluginOptsRaw)
      yamlObj = {
        name,
        type: 'ss',
        server: form.server.trim(),
        port: portNum,
        cipher: form.cipher.trim(),
        password: form.password,
        ...(form.plugin.trim() ? { plugin: form.plugin.trim() } : {}),
        ...(pluginOpts ? { 'plugin-opts': pluginOpts } : {}),
        udp: form.udp,
      }
    } else {
      yamlObj = {
        name,
        type: 'hysteria2',
        server: form.server.trim(),
        port: portNum,
        password: form.password,
        ...(form.sni.trim() ? { sni: form.sni.trim() } : {}),
        ...(form.hy2Obfs.trim() ? { obfs: form.hy2Obfs.trim() } : {}),
        ...(form.hy2ObfsPassword ? { 'obfs-password': form.hy2ObfsPassword } : {}),
        ...(form.hy2Ports.trim() ? { ports: form.hy2Ports.trim() } : {}),
        udp: form.udp,
        ...(form.skipCertVerify ? { 'skip-cert-verify': true } : {}),
      }
    }

    const parsed = parseYamlProxiesDetailed(stringifyYamlConfig({ proxies: [yamlObj] }))
    if (parsed.nodes.length === 0) {
      reportImportFeedback({
        kind: 'error',
        message:
          parsed.issues[0]?.message ??
          parsed.warnings[0] ??
          (language === 'zh' ? '手动节点参数不完整。' : 'Invalid manual node parameters.'),
      }, context)
      return false
    }

    const sourceName = language === 'zh' ? `手动-${name}` : `Manual-${name}`
    const incoming: NodeSource = {
      id: makeClientId('src'),
      name: sourceName,
      kind: 'manual',
      nodeIds: [],
      status: 'success',
      lastSuccessAt: new Date().toISOString(),
      parseStats: {
        validCount: parsed.validCount,
        unsupportedCount: parsed.unsupportedCount,
        invalidCount: parsed.invalidCount,
        issues: parsed.issues,
      },
    }
    setWorkspace((prev) => mergeImportedSource(prev, incoming, parsed.nodes, context?.target))
    reportImportFeedback({
      kind: 'info',
      message:
        language === 'zh'
          ? `已添加手动节点 “${name}”。`
          : `Added manual node "${name}".`,
    }, context)
    return true
  }

  const handleRequestDeleteSource = (sourceId: string) => {
    const impact = computeSourceDeletionImpact(registry, sources, plans, sourceId)
    setPendingDeleteImpact(impact)
  }

  const handleConfirmDeleteSource = () => {
    if (!pendingDeleteImpact) {
      return
    }
    const targetId = pendingDeleteImpact.sourceId
    // 取消并作废该来源在途的刷新请求，避免撤销后旧请求回写恢复的数据。
    refreshControllersRef.current.get(targetId)?.abort()
    refreshControllersRef.current.delete(targetId)
    refreshVersionsRef.current.set(
      targetId,
      (refreshVersionsRef.current.get(targetId) ?? 0) + 1,
    )

    const deletedSource = sources.find((src) => src.id === targetId)
    if (deletedSource) {
      setUndoSnapshot({
        source: deletedSource,
        nodeEntries: Object.values(registry)
          .filter((entry) => entry.sourceIds.includes(targetId))
          .map((entry) => structuredClone(entry)),
        subscriptionUrl: subscriptionUrlsRef.current.get(targetId),
      })
    }
    subscriptionUrlsRef.current.delete(targetId)

    setWorkspace((prev) => {
      const next = removeSourceFromWorkspace(prev.registry, prev.sources, targetId)
      return {
        ...prev,
        registry: next.registry,
        sources: next.sources,
      }
    })
    setPendingDeleteImpact(null)
  }

  const handleUndoDeleteSource = () => {
    if (!undoSnapshot) {
      return
    }
    const record = undoSnapshot
    setWorkspace((prev) => {
      if (prev.sources.some((src) => src.id === record.source.id)) {
        return prev
      }
      const next = restoreDeletedSource(prev.registry, prev.sources, record)
      return {
        ...prev,
        registry: next.registry,
        sources: next.sources,
      }
    })
    if (record.subscriptionUrl) {
      subscriptionUrlsRef.current.set(record.source.id, record.subscriptionUrl)
    }
    setUndoSnapshot(null)
  }

  const handleRenameNode = (nodeId: string, newDisplayName: string) => {
    setWorkspace((prev) => {
      const nextReg = renameNodeDisplayAlias(prev.registry, nodeId, newDisplayName)
      return {
        ...prev,
        registry: nextReg,
        plans: prev.plans.map((p) => syncPlanNodeHints(p, nextReg)),
      }
    })
  }

  const handleSaveLocal = () => {
    try {
      const envelope = serializeWorkspaceState({
        activePlanId: activePlan.id,
        plans,
        sources,
        registry,
        includesCredentials: includeCredsInLocalSave,
      })
      globalThis.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(envelope))
      setHasLocalSavedData(true)
      setPersistenceFeedback({
        kind: 'info',
        message: includeCredsInLocalSave
          ? language === 'zh'
            ? '已保存到本机浏览器 localStorage（含节点凭据，请注意设备安全）。'
            : 'Saved locally including node credentials in browser localStorage.'
          : language === 'zh'
            ? '已仅保存方案结构与引用提示至本机 localStorage（不含任何密码或 UUID）。'
            : 'Saved topology & node reference hints locally (without credentials).',
      })
    } catch (err) {
      setPersistenceFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const applyRestoredEnvelope = (rawJson: string, fromFile: boolean) => {
    // 校验在任何工作区状态更新之前完成；结构无效时原工作区保持不变。
    const restored = validateAndRestoreWorkspace(rawJson)
    if (!restored.ok) {
      setPersistenceFeedback({ kind: 'error', message: restored.error })
      return
    }

    const { envelope } = restored
    // 成功替换工作区：旧工作区的在途刷新请求、会话订阅 URL 与撤销记录不再适用，
    // 必须清理，防止旧请求或旧撤销把数据回写到新工作区。
    for (const controller of refreshControllersRef.current.values()) {
      controller.abort()
    }
    refreshControllersRef.current.clear()
    refreshVersionsRef.current.clear()
    subscriptionUrlsRef.current.clear()
    setUndoSnapshot(null)

    setWorkspace((prev) => {
      let nextRegistry: Record<string, ManagedNodeEntry>
      if (envelope.nodes && envelope.nodes.length > 0) {
        nextRegistry = createRegistryFromEntries(envelope.nodes)
      } else if (fromFile) {
        // 导入结构文件且未附带节点正文时保持现有已导入节点或空节点库以触发清晰的缺失引用提示
        nextRegistry = prev.registry
      } else {
        nextRegistry = {}
      }
      return {
        plans: envelope.plans,
        activePlanId: envelope.activePlanId,
        sources: envelope.sources,
        registry: nextRegistry,
      }
    })

    setPersistenceFeedback({
      kind: 'info',
      message: envelope.includesCredentials
        ? language === 'zh'
          ? '已恢复方案及本地缓存节点。'
          : 'Restored plans and cached nodes.'
        : language === 'zh'
          ? '已恢复方案结构与来源清单（不含节点凭据）；请在“节点来源”中重新导入以补全缺失节点。'
          : 'Restored plans and source metadata without credentials; re-import sources to resolve missing nodes.',
    })
  }

  const handleImportPlanFile = async (file: File) => {
    // 读取前先按文件元数据拦截超限文件，避免把超大内容载入内存。
    if (file.size > MAX_PLAN_FILE_BYTES) {
      setPersistenceFeedback({ kind: 'error', message: PLAN_FILE_TOO_LARGE_MESSAGE })
      return
    }
    try {
      applyRestoredEnvelope(await file.text(), true)
    } catch (err) {
      setPersistenceFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleRestoreLocal = () => {    try {
      const raw = globalThis.localStorage.getItem(LOCAL_STORAGE_KEY)
      if (!raw) {
        setHasLocalSavedData(false)
        setPersistenceFeedback({
          kind: 'error',
          message: language === 'zh' ? '未发现本机保存的数据。' : 'No locally saved data found.',
        })
        return
      }
      applyRestoredEnvelope(raw, false)
    } catch (err) {
      setPersistenceFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleClearLocal = () => {
    try {
      globalThis.localStorage.removeItem(LOCAL_STORAGE_KEY)
      setHasLocalSavedData(false)
      setPersistenceFeedback({
        kind: 'info',
        message:
          language === 'zh'
            ? '已彻底清除浏览器 localStorage 中保存的方案与缓存节点。'
            : 'Cleared all locally saved data from browser localStorage.',
      })
    } catch (err) {
      setPersistenceFeedback({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleExportPlanJson = () => {
    const envelope = serializeWorkspaceState({
      activePlanId: activePlan.id,
      plans,
      sources,
      registry,
      includesCredentials: includeCredsInLocalSave,
    })
    downloadJsonFile('proxy-chain-plans.json', envelope)
  }

  const handleAddRelay = () => {
    updateActivePlan((prev) => {
      const idx = prev.relays.length + 1
      return {
        ...prev,
        relays: [
          ...prev.relays,
          createDefaultStage(
            makeClientId('stage-relay'),
            language === 'zh' ? `中转层 ${idx}` : `Relay ${idx}`,
            true,
            'select',
          ),
        ],
      }
    })
  }

  const handleMoveRelay = (relayId: string, direction: -1 | 1) => {
    updateActivePlan((prev) => {
      const index = prev.relays.findIndex((r) => r.id === relayId)
      const targetIndex = index + direction
      if (index === -1 || targetIndex < 0 || targetIndex >= prev.relays.length) {
        return prev
      }
      const nextRelays = [...prev.relays]
      const [moved] = nextRelays.splice(index, 1)
      nextRelays.splice(targetIndex, 0, moved)
      return { ...prev, relays: nextRelays }
    })
  }

  const handleDropRelay = (targetRelayId: string) => {
    if (!draggedRelayId || draggedRelayId === targetRelayId) {
      setDraggedRelayId(null)
      return
    }
    updateActivePlan((prev) => {
      const from = prev.relays.findIndex((r) => r.id === draggedRelayId)
      const to = prev.relays.findIndex((r) => r.id === targetRelayId)
      if (from === -1 || to === -1) {
        return prev
      }
      const nextRelays = [...prev.relays]
      const [moved] = nextRelays.splice(from, 1)
      nextRelays.splice(to, 0, moved)
      return { ...prev, relays: nextRelays }
    })
    setDraggedRelayId(null)
  }

  const makeStageHandlers = (role: 'entry' | 'relay' | 'exit', stage: ChainStage) => ({
    onToggleEnabled: (enabled: boolean) =>
      updateStage(role, stage.id, (prev) => ({ ...prev, enabled })),
    onRenameStage: (name: string) =>
      updateStage(role, stage.id, (prev) => ({ ...prev, name })),
    onChangeStrategy: (strategy: SelectionStrategy) =>
      updateStage(role, stage.id, (prev) => ({
        ...prev,
        strategy,
        probe: prev.probe ?? { ...DEFAULT_PROBE_CONFIG },
      })),
    onChangeProbe: (field: 'url' | 'intervalSeconds' | 'toleranceMs', value: string) =>
      updateStage(role, stage.id, (prev) => {
        const cur = prev.probe ?? { ...DEFAULT_PROBE_CONFIG }
        if (field === 'url') {
          return { ...prev, probe: { ...cur, url: value } }
        }
        const numeric = Number(value)
        return {
          ...prev,
          probe: {
            ...cur,
            [field]: Number.isFinite(numeric) ? numeric : 0,
          },
        }
      }),
    onToggleNode: (nodeId: string) =>
      updateStage(role, stage.id, (prev) => {
        const exists = prev.candidateNodeIds.includes(nodeId)
        const nextIds = exists
          ? prev.candidateNodeIds.filter((id) => id !== nodeId)
          : [...prev.candidateNodeIds, nodeId]
        return { ...prev, candidateNodeIds: nextIds }
      }),
    onSelectFiltered: (filteredIds: string[]) =>
      updateStage(role, stage.id, (prev) => {
        const merged = [...prev.candidateNodeIds]
        const set = new Set(merged)
        for (const id of filteredIds) {
          if (!set.has(id)) {
            set.add(id)
            merged.push(id)
          }
        }
        return { ...prev, candidateNodeIds: merged }
      }),
    onClearFiltered: (filteredIds: string[]) =>
      updateStage(role, stage.id, (prev) => {
        const drop = new Set(filteredIds)
        return {
          ...prev,
          candidateNodeIds: prev.candidateNodeIds.filter((id) => !drop.has(id)),
        }
      }),
    onClearStage: () =>
      updateStage(role, stage.id, (prev) => ({ ...prev, candidateNodeIds: [] })),
    onRemoveMissingRef: (nodeId: string) =>
      updateStage(role, stage.id, (prev) => ({
        ...prev,
        candidateNodeIds: prev.candidateNodeIds.filter((id) => id !== nodeId),
      })),
  })

  const exitStageHandlers = makeStageHandlers('exit', activePlan.exit)
  const hasActiveRelays =
    activePlan.mode === 'advanced' && activePlan.relays.some((relay) => relay.enabled)

  const makeStageNodeImportActions = (
    role: 'entry' | 'exit',
    stage: ChainStage,
  ): StageNodeImportActions => {
    // 在发起导入时锁定方案与层，异步返回后不跟随当前活动方案漂移。
    const target: StageNodeImportTarget = { planId: activePlan.id, stageId: stage.id, role }
    return {
      fetchViaService: fetchMode === 'service' || fetchMode === 'hosted' ||
        (fetchMode === 'auto' && capabilities.fetchSubscription),
      onAddPaste: (text, onFeedback) => handleAddPaste('', text, { target, onFeedback }),
      onAddManual: (form, onFeedback) => handleAddManual(form, { target, onFeedback }),
      onAddSubscription: (url, onFeedback, signal) =>
        handleAddSubscription('', url, { target, onFeedback, signal }),
    }
  }

  // 在同一份只读状态快照上同步生成预览、完整配置与客户端参考结果
  const computed = useMemo(() => {
    const preview = buildChainPreview(activePlan, registry)
    const mihomoResult = validateAndExportPlan(activePlan, registry, plans, 'clash-mihomo')
    const xrayResult = validateAndExportPlan(activePlan, registry, plans, 'xray-json')
    return {
      preview,
      mihomoResult,
      xrayResult,
    }
  }, [activePlan, plans, registry])

  const finalEnabledStageId =
    computed.preview.stages.find((s) => s.isFinalExit)?.stageId ?? activePlan.entry.id
  const enabledStageCount = computed.preview.stages.length

  // ---- 三步流程状态（UI 状态，不触碰 plan.mode / 节点选择 / 启用状态）----
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [advChainOpen, setAdvChainOpen] = useState(false)
  const [advSaveOpen, setAdvSaveOpen] = useState(false)
  const [step2NextAttempted, setStep2NextAttempted] = useState(false)
  const step1HeadingRef = useRef<HTMLHeadingElement | null>(null)
  const step2HeadingRef = useRef<HTMLHeadingElement | null>(null)
  const step3HeadingRef = useRef<HTMLHeadingElement | null>(null)

  const registrySize = useMemo(() => Object.keys(registry).length, [registry])

  // 步骤 2 可直接新增节点；步骤 3 仍必须通过完整链路校验。
  const step3Enabled = computed.mihomoResult.valid
  const step2BlockingErrors = computed.mihomoResult.diagnostics.filter(
    (d) => d.severity === 'error',
  )

  const goToStep = useCallback((step: 1 | 2 | 3) => {
    setCurrentStep(step)
    if (step === 2) {
      setStep2NextAttempted(false)
    }
    // 焦点移至该步骤标题；跳过过渡以避免滚动跳动
    requestAnimationFrame(() => {
      const ref =
        step === 1 ? step1HeadingRef : step === 2 ? step2HeadingRef : step3HeadingRef
      ref.current?.focus()
    })
  }, [])

  const handleNextStep = useCallback(() => {
    if (currentStep === 1) {
      goToStep(2)
      return
    }
    if (currentStep === 2) {
      // 允许点击触发校验；不完整时留在本步并定位错误
      if (!step3Enabled) {
        setStep2NextAttempted(true)
        return
      }
      goToStep(3)
    }
  }, [currentStep, goToStep, step3Enabled])

  // 高级面板跳转入口：展开对应分组并定位
  const goToFixTarget = useCallback(
    (target: 'chain' | 'plan' | 'save') => {
      if (target === 'chain') {
        setAdvChainOpen(true)
      } else {
        setAdvSaveOpen(true)
      }
      setAdvancedOpen(true)
      if (currentStep !== 2) {
        setCurrentStep(2)
      }
    },
    [currentStep],
  )

  // 步骤 2/3 的方案摘要，例如“2 个入口 · 1 层中转 · 出口节点 · 国内直连”
  const planSummary = useMemo(() => {
    const parts: string[] = []
    if (language === 'zh') {
      parts.push(`${activePlan.entry.candidateNodeIds.length} 个入口`)
      const enabledRelays = activePlan.relays.filter((r) => r.enabled).length
      if (enabledRelays > 0) {
        parts.push(`${enabledRelays} 层中转`)
      }
      parts.push(activePlan.exit.enabled ? '出口节点' : '无出口节点')
      parts.push(
        activePlan.routingPreset === 'cn-direct'
          ? '国内直连'
          : activePlan.routingPreset === 'all-proxy'
            ? '全部走代理'
            : '自定义分流',
      )
    } else {
      parts.push(`${activePlan.entry.candidateNodeIds.length} entr${activePlan.entry.candidateNodeIds.length === 1 ? 'y' : 'ies'}`)
      const enabledRelays = activePlan.relays.filter((r) => r.enabled).length
      if (enabledRelays > 0) {
        parts.push(`${enabledRelays} relay${enabledRelays === 1 ? '' : 's'}`)
      }
      parts.push(activePlan.exit.enabled ? 'exit node' : 'no exit node')
      parts.push(
        activePlan.routingPreset === 'cn-direct'
          ? 'CN direct'
          : activePlan.routingPreset === 'all-proxy'
            ? 'proxy all'
            : 'custom routing',
      )
    }
    return parts.join(' · ')
  }, [activePlan, language])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1>{copy.title}</h1>
          </div>
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className={`ghost-btn sm advanced-toggle ${advancedOpen ? 'active' : ''}`}
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((prev) => !prev)}
          >
            <Settings2 size={14} aria-hidden="true" />
            {copy.advancedSettingsBtn}
          </button>
          <div className="language-toggle" role="group" aria-label="Language">
            <button
              type="button"
              className={language === 'zh' ? 'active' : ''}
              onClick={() => setLanguage('zh')}
            >
              中文
            </button>
            <button
              type="button"
              className={language === 'en' ? 'active' : ''}
              onClick={() => setLanguage('en')}
            >
              English
            </button>
          </div>
        </div>
      </header>

      {/* 高级设置：收起后保留所有正在生效的配置 */}
      {advancedOpen ? (
        <section className="advanced-panel" aria-label={copy.advancedSettingsBtn}>
          <div className="adv-env-row">
            <span className="badge neutral">
              {copy.envFetcherState}: {capabilities.fetchSubscription ? 'ON' : 'OFF'}
            </span>
            <span className="badge neutral">
              {copy.envTempState}: {capabilities.temporaryClashConfig ? 'ON' : 'OFF'}
            </span>
          </div>

          <div className="adv-group">
            <button
              type="button"
              className="ghost-btn sm adv-group-toggle"
              aria-expanded={advChainOpen}
              onClick={() => setAdvChainOpen((prev) => !prev)}
            >
              {copy.advChainGroup}
            </button>
            {advChainOpen ? (
              <div className="adv-group-body">
                <PlanWorkspaceBar
                language={language}
                copy={copy}
                plans={plans}
                activePlan={activePlan}
                includeCredsInLocalSave={includeCredsInLocalSave}
                hasLocalSavedData={hasLocalSavedData}
                  persistenceFeedback={persistenceFeedback}
                  variant="controls"
                onSelectPlan={(planId) =>
                  setWorkspace((prev) => ({ ...prev, activePlanId: planId }))
                }
                onCreatePlan={(name) => {
                  const newPlan = createDefaultChainPlan(makeClientId('plan'), name)
                  setWorkspace((prev) => ({
                    ...prev,
                    plans: [...prev.plans, newPlan],
                    activePlanId: newPlan.id,
                  }))
                }}
                onRenamePlan={(planId, name) =>
                  setWorkspace((prev) => ({
                    ...prev,
                    plans: prev.plans.map((p) => (p.id === planId ? { ...p, name } : p)),
                  }))
                }
                onDuplicatePlan={(planId) => {
                  setWorkspace((prev) => {
                    const source = prev.plans.find((p) => p.id === planId)
                    if (!source) {
                      return prev
                    }
                    const dup = duplicateChainPlan(
                      source,
                      makeClientId('plan'),
                      `${source.name} (${language === 'zh' ? '副本' : 'Copy'})`,
                    )
                    return {
                      ...prev,
                      plans: [...prev.plans, dup],
                      activePlanId: dup.id,
                    }
                  })
                }}
                onDeletePlan={(planId) => {
                  setWorkspace((prev) => {
                    if (prev.plans.length <= 1) {
                      return prev
                    }
                    const remaining = prev.plans.filter((p) => p.id !== planId)
                    return {
                      ...prev,
                      plans: remaining,
                      activePlanId: prev.activePlanId === planId ? remaining[0].id : prev.activePlanId,
                    }
                  })
                }}
                onSwitchMode={(mode) => updateActivePlan((prev) => ({ ...prev, mode }))}
                onToggleIncludeCreds={setIncludeCredsInLocalSave}
                onSaveLocal={handleSaveLocal}
                onRestoreLocal={handleRestoreLocal}
                onClearLocal={handleClearLocal}
                onExportPlanJson={handleExportPlanJson}
                onImportPlanJson={handleImportPlanFile}
                />
              <RoutingConfigCard
                language={language}
                copy={copy}
                plan={activePlan}
                allPlans={plans}
                onChangePreset={(preset: RoutingPreset) =>
                  updateActivePlan((prev) => ({ ...prev, routingPreset: preset }))
                }
                onAddRule={() =>
                  updateActivePlan((prev) => ({
                    ...prev,
                    customRules: [
                      ...prev.customRules,
                      {
                        id: makeClientId('rule'),
                        matchType: 'DOMAIN-SUFFIX',
                        pattern: '',
                        target: { kind: 'plan', planId: prev.id },
                      },
                    ],
                  }))
                }
                onUpdateRule={(ruleId, updater: (r: CustomRoutingRule) => CustomRoutingRule) =>
                  updateActivePlan((prev) => ({
                    ...prev,
                    customRules: prev.customRules.map((r) => (r.id === ruleId ? updater(r) : r)),
                  }))
                }
                onMoveRule={(ruleId, direction) =>
                  updateActivePlan((prev) => {
                    const idx = prev.customRules.findIndex((r) => r.id === ruleId)
                    const nextIdx = idx + direction
                    if (idx === -1 || nextIdx < 0 || nextIdx >= prev.customRules.length) {
                      return prev
                    }
                    const next = [...prev.customRules]
                    const [item] = next.splice(idx, 1)
                    next.splice(nextIdx, 0, item)
                    return { ...prev, customRules: next }
                  })
                }
                onRemoveRule={(ruleId) =>
                  updateActivePlan((prev) => ({
                    ...prev,
                    customRules: prev.customRules.filter((r) => r.id !== ruleId),
                  }))
                }
                onChangeFallbackTarget={(target: CustomRoutingTarget) =>
                  updateActivePlan((prev) => ({ ...prev, customFallbackTarget: target }))
                }
              />
              </div>
            ) : null}
          </div>

          <div className="adv-group">
            <button
              type="button"
              className="ghost-btn sm adv-group-toggle"
              aria-expanded={advSaveOpen}
              onClick={() => setAdvSaveOpen((prev) => !prev)}
            >
              {copy.advSaveGroup}
            </button>
            {advSaveOpen ? (
              <div className="adv-group-body">
                <PlanWorkspaceBar
                language={language}
                copy={copy}
                plans={plans}
                activePlan={activePlan}
                includeCredsInLocalSave={includeCredsInLocalSave}
                hasLocalSavedData={hasLocalSavedData}
                  persistenceFeedback={persistenceFeedback}
                  variant="save"
                onSelectPlan={(planId) =>
                  setWorkspace((prev) => ({ ...prev, activePlanId: planId }))
                }
                onCreatePlan={(name) => {
                  const newPlan = createDefaultChainPlan(makeClientId('plan'), name)
                  setWorkspace((prev) => ({
                    ...prev,
                    plans: [...prev.plans, newPlan],
                    activePlanId: newPlan.id,
                  }))
                }}
                onRenamePlan={(planId, name) =>
                  setWorkspace((prev) => ({
                    ...prev,
                    plans: prev.plans.map((p) => (p.id === planId ? { ...p, name } : p)),
                  }))
                }
                onDuplicatePlan={(planId) => {
                  setWorkspace((prev) => {
                    const source = prev.plans.find((p) => p.id === planId)
                    if (!source) {
                      return prev
                    }
                    const dup = duplicateChainPlan(
                      source,
                      makeClientId('plan'),
                      `${source.name} (${language === 'zh' ? '副本' : 'Copy'})`,
                    )
                    return {
                      ...prev,
                      plans: [...prev.plans, dup],
                      activePlanId: dup.id,
                    }
                  })
                }}
                onDeletePlan={(planId) => {
                  setWorkspace((prev) => {
                    if (prev.plans.length <= 1) {
                      return prev
                    }
                    const remaining = prev.plans.filter((p) => p.id !== planId)
                    return {
                      ...prev,
                      plans: remaining,
                      activePlanId: prev.activePlanId === planId ? remaining[0].id : prev.activePlanId,
                    }
                  })
                }}
                onSwitchMode={(mode) => updateActivePlan((prev) => ({ ...prev, mode }))}
                onToggleIncludeCreds={setIncludeCredsInLocalSave}
                onSaveLocal={handleSaveLocal}
                onRestoreLocal={handleRestoreLocal}
                onClearLocal={handleClearLocal}
                onExportPlanJson={handleExportPlanJson}
                onImportPlanJson={handleImportPlanFile}
                />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* 三步进度导航 */}
      <nav className="step-nav" aria-label={copy.stepNavAria}>
        <ol>
          {([1, 2, 3] as const).map((step) => {
            const titles = {
              1: copy.stepImportTitle,
              2: copy.stepChainTitle,
              3: copy.stepExportTitle,
            } as const
            const accessible =
              step !== 3 || step3Enabled
            return (
              <li key={step} className={currentStep === step ? 'current' : ''}>
                <button
                  type="button"
                  disabled={!accessible && step !== currentStep}
                  aria-current={currentStep === step ? 'step' : undefined}
                  onClick={() => (accessible ? goToStep(step) : undefined)}
                >
                  <span className="step-index" aria-hidden="true">
                    {step}
                  </span>
                  {titles[step]}
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <div className="chain-usage-control">
        <div className="chain-usage-heading" id="proxy-mode-label">
          <span className="chain-usage-icon" aria-hidden="true">
            <Route size={18} />
          </span>
          <span>{copy.proxyModeLabel}</span>
        </div>
        <div className="chain-mode-options" role="group" aria-labelledby="proxy-mode-label">
          <button
            type="button"
            className="chain-mode-option"
            aria-pressed={!activePlan.exit.enabled}
            onClick={() => exitStageHandlers.onToggleEnabled(false)}
          >
            <ArrowUpRight size={18} aria-hidden="true" />
            <span>{hasActiveRelays ? copy.relayOnlyMode : copy.entryOnlyMode}</span>
            <span className="chain-mode-check" aria-hidden="true">
              {!activePlan.exit.enabled ? <Check size={13} strokeWidth={3} /> : null}
            </span>
          </button>
          <button
            type="button"
            className="chain-mode-option"
            aria-pressed={activePlan.exit.enabled}
            onClick={() => exitStageHandlers.onToggleEnabled(true)}
          >
            <Link2 size={18} aria-hidden="true" />
            <span>{hasActiveRelays ? copy.relayWithExitMode : copy.chainProxyMode}</span>
            <span className="chain-mode-check" aria-hidden="true">
              {activePlan.exit.enabled ? <Check size={13} strokeWidth={3} /> : null}
            </span>
          </button>
        </div>
      </div>

      {/* 当前链路示意：常驻导航条下方，随方案实时更新；只显示层名称与数量 */}
      <ChainPreviewCard language={language} copy={copy} preview={computed.preview} />

      <main className="workspace step-layout">
        {/* 步骤 1：导入节点（hidden 切换，不卸载，草稿与在途请求保留） */}
        <div className="step-pane" hidden={currentStep !== 1}>
          <SourceManagerPanel
            headingRef={step1HeadingRef}
            language={language}
            copy={copy}
            capabilities={capabilities}
            sources={sources}
            registrySize={registrySize}
            fetchMode={fetchMode}
            fetcherEndpoint={fetcherEndpoint}
            fetcherToken={fetcherToken}
            pendingDeleteImpact={pendingDeleteImpact}
            hasUndoableDeletion={Boolean(undoSnapshot)}
            formFeedback={sourceFeedback}
            onChangeFetchMode={setFetchMode}
            onChangeFetcherEndpoint={setFetcherEndpoint}
            onChangeFetcherToken={setFetcherToken}
            onUploadError={(message) => setSourceFeedback({ kind: 'error', message })}
            onAddSubscription={handleAddSubscription}
            onAddPaste={handleAddPaste}
            onAddManual={handleAddManual}
            onRefreshSubscription={handleRefreshSubscription}
            onCancelRefresh={handleCancelRefresh}
            onRequestDeleteSource={handleRequestDeleteSource}
            onConfirmDeleteSource={handleConfirmDeleteSource}
            onCancelDeleteSource={() => setPendingDeleteImpact(null)}
            onUndoDeleteSource={handleUndoDeleteSource}
          />

          {/* 步骤 1 底部导航 */}
          <div className="step-footer">
            <span />
            <div className="step-footer-next">
              <button
                type="button"
                className="primary-btn"
                onClick={handleNextStep}
              >
                {copy.nextStepBtn}
              </button>
              {registrySize === 0 ? (
                <span className="muted-meta">{copy.stageAddNextStepHint}</span>
              ) : null}
            </div>
          </div>
        </div>

        {/* 步骤 2：选择链路（不卸载；切换/收起高级设置、切换语言不改变业务状态） */}
        <div className="step-pane" hidden={currentStep !== 2}>
          <section className="panel card">
            <div className="panel-header-row">
              <div>
                <h2 id="step-2-heading" ref={step2HeadingRef} tabIndex={-1}>
                  {copy.stepChainTitle}
                </h2>
                <p className="muted-meta">
                  {copy.currentPlanLabel}: {activePlan.name} · {planSummary}
                  {activePlan.mode === 'advanced' ? (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => goToFixTarget('chain')}
                    >
                      {copy.multiHopBadge}
                    </button>
                  ) : null}
                  {activePlan.routingPreset === 'custom' ? (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() => goToFixTarget('chain')}
                    >
                      {copy.customRoutingBadge}
                    </button>
                  ) : null}
                </p>
              </div>
            </div>

            {step2NextAttempted && step2BlockingErrors.length > 0 ? (
              <div className="feedback-banner error" role="alert">
                {copy.step2BlockedBanner}
              </div>
            ) : null}

            <div className="stages-stack">
              <StageConfigCard
                key={`entry:${activePlan.id}:${activePlan.entry.id}`}
                language={language}
                copy={copy}
                role="entry"
                nodeImport={makeStageNodeImportActions('entry', activePlan.entry)}
                stage={activePlan.entry}
                plan={activePlan}
                registry={registry}
                sources={sources}
                isFinalExit={finalEnabledStageId === activePlan.entry.id}
                onRenameNode={handleRenameNode}
                showStrategyDefault={false}
                {...makeStageHandlers('entry', activePlan.entry)}
              />

              {activePlan.mode === 'advanced' ? (
                <div className="relays-section">
                  <div className="relays-toolbar">
                    <strong>
                      {language === 'zh'
                        ? `中转层 (${activePlan.relays.length})`
                        : `Relay Stages (${activePlan.relays.length})`}
                    </strong>
                    <button
                      type="button"
                      className="ghost-btn xs"
                      disabled={enabledStageCount >= MAX_ENABLED_CHAIN_LAYERS}
                      onClick={handleAddRelay}
                    >
                      <Plus size={13} aria-hidden="true" />
                      {copy.addRelayBtn}
                    </button>
                  </div>

                  {activePlan.relays.map((relay, index) => (
                    <StageConfigCard
                      key={relay.id}
                      language={language}
                      copy={copy}
                      role="relay"
                      stage={relay}
                      plan={activePlan}
                      registry={registry}
                      sources={sources}
                      isFinalExit={finalEnabledStageId === relay.id}
                      canMoveUp={index > 0}
                      canMoveDown={index < activePlan.relays.length - 1}
                      draggable
                      onDragStart={() => setDraggedRelayId(relay.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDropRelay(relay.id)}
                      onMoveUp={() => handleMoveRelay(relay.id, -1)}
                      onMoveDown={() => handleMoveRelay(relay.id, 1)}
                      onRemoveRelay={() =>
                        updateActivePlan((prev) => ({
                          ...prev,
                          relays: prev.relays.filter((r) => r.id !== relay.id),
                        }))
                      }
                      onRenameNode={handleRenameNode}
                      showStrategyDefault={false}
                      {...makeStageHandlers('relay', relay)}
                    />
                  ))}
                </div>
              ) : null}

              <StageConfigCard
                key={`exit:${activePlan.id}:${activePlan.exit.id}`}
                language={language}
                copy={copy}
                role="exit"
                nodeImport={makeStageNodeImportActions('exit', activePlan.exit)}
                stage={activePlan.exit}
                plan={activePlan}
                registry={registry}
                sources={sources}
                isFinalExit={activePlan.exit.enabled && finalEnabledStageId === activePlan.exit.id}
                onRenameNode={handleRenameNode}
                showStrategyDefault={false}
                {...exitStageHandlers}
              />
            </div>
          </section>

          {/* 步骤 2 底部导航 */}
          <div className="step-footer">
            <button type="button" className="ghost-btn" onClick={() => goToStep(1)}>
              {copy.prevStepBtn}
            </button>
            <div className="step-footer-next">
              <button type="button" className="primary-btn" onClick={handleNextStep}>
                {step3Enabled ? copy.nextStepBtn : copy.nextStepBtn}
              </button>
              {!step3Enabled && step2NextAttempted ? (
                <span className="muted-meta">
                  {copy.needFixCount.replace('%d', String(step2BlockingErrors.length))}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* 步骤 3：下载配置 */}
        <div className="step-pane" hidden={currentStep !== 3}>
          <OutputPanel
            headingRef={step3HeadingRef}
            language={language}
            copy={copy}
            plan={activePlan}
            registry={registry}
            capabilities={capabilities}
            mihomoResult={computed.mihomoResult}
            xrayResult={computed.xrayResult}
            planSummary={planSummary}
            active={currentStep === 3}
            step2BlockingErrors={step2BlockingErrors}
            warnings={computed.mihomoResult.diagnostics.filter((d) => d.severity === 'warning')}
            onGoBack={() => goToStep(2)}
            onGoFix={() => goToFixTarget('chain')}
          />

          <div className="step-footer">
            <button type="button" className="ghost-btn" onClick={() => goToStep(2)}>
              {copy.backToEditBtn}
            </button>
            <span />
          </div>
        </div>
      </main>

      <StatusBar
        language={language}
        copy={copy}
        activePlan={activePlan}
        mihomoResult={computed.mihomoResult}
        currentStep={currentStep}
      />
    </div>
  )
}

export default App
