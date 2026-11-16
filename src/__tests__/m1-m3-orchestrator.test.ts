import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  WORKSPACE_SCHEMA_VERSION,
  buildBatchPlanExports,
  buildChainPreview,
  computeSourceDeletionImpact,
  createDefaultChainPlan,
  createDefaultStage,
  duplicateChainPlan,
  exportSelectedNodesAsLinks,
  parseProxyInputDetailed,
  readNodeHint,
  readRegistryEntry,
  removeSourceFromWorkspace,
  renameNodeDisplayAlias,
  restoreDeletedSource,
  serializeWorkspaceState,
  createRegistryFromEntries,
  upsertSourceNodes,
  validateAndExportPlan,
  validateAndRestoreWorkspace,
} from '../lib'
import type { ManagedNodeEntry, NodeSource } from '../lib'

function buildFixtureWorkspace() {
  const entryParsed = parseProxyInputDetailed(
    [
      'socks5://user1:pass1@entry1.example.com:1080#入口甲',
      'socks5://user2:pass2@entry2.example.com:1081#入口乙',
      'vless://11111111-1111-4111-8111-111111111111@vless-tcp.example.com:443?security=reality&sni=cdn.example.com&fp=chrome&pbk=pub1&sid=0012&type=tcp#中转VLESS',
      'vless://22222222-2222-4222-8222-222222222222@vless-ws.example.com:443?security=tls&sni=ws.example.com&type=ws&path=%2Fws#VLESS-WS',
    ].join('\n'),
  )

  const exitParsed = parseProxyInputDetailed(
    [
      'ss://YWVzLTI1Ni1nY206ZXhpdC1wYXNz@exit-ss.example.com:8388#出口SS',
      'hysteria2://hy2pass@exit-hy2.example.com:443?sni=hy2.example.com#出口HY2',
      'ss://YWVzLTI1Ni1nY206b2Jmcy1wYXNz@obfs.example.com:8388?plugin=obfs-local%3Bobfs%3Dhttp#OBFS节点',
    ].join('\n'),
  )

  const src1: NodeSource = {
    id: 'src-entry',
    name: '机场订阅 A',
    kind: 'subscription',
    nodeIds: [],
    status: 'success',
  }
  const src2: NodeSource = {
    id: 'src-exit',
    name: '自建落地 B',
    kind: 'paste',
    nodeIds: [],
    status: 'success',
  }

  let registry: Record<string, ManagedNodeEntry> = {}
  let sources: NodeSource[] = []

  const step1 = upsertSourceNodes(registry, sources, src1, entryParsed.nodes)
  registry = step1.registry
  sources = step1.sources

  const step2 = upsertSourceNodes(registry, sources, src2, exitParsed.nodes)
  registry = step2.registry
  sources = step2.sources

  return {
    registry,
    sources,
    entryIds: entryParsed.nodes.map((n) => n.id),
    exitIds: exitParsed.nodes.map((n) => n.id),
  }
}

describe('M1/M2/M3 编排、路由、校验、多跳与持久化', () => {
  it('T12/T13: 独立出口关闭时保留选择但导出与校验零残留，重新启用自动恢复', () => {
    const { registry, entryIds, exitIds } = buildFixtureWorkspace()
    const plan = createDefaultChainPlan('plan-1', '测试方案')
    plan.entry.candidateNodeIds = [entryIds[0]]
    plan.exit.enabled = true
    plan.exit.candidateNodeIds = [exitIds[0]]

    const withExit = validateAndExportPlan(plan, registry, [plan], 'clash-mihomo')
    expect(withExit.valid).toBe(true)
    const parsedWithExit = parseYaml(withExit.output) as {
      proxies: Array<Record<string, unknown>>
      'proxy-groups': Array<{ name: string; proxies: string[] }>
      rules: string[]
    }
    expect(parsedWithExit.proxies).toHaveLength(2)
    expect(parsedWithExit.proxies[1]['dialer-proxy']).toBe('入口节点')
    expect(parsedWithExit['proxy-groups'].map((g) => g.name)).toEqual(['入口节点', 'PROXY'])

    // 关闭独立出口并即使塞入一条无效候选/缺失节点也不应阻碍入口直出导出
    plan.exit.enabled = false
    const disabledExport = validateAndExportPlan(plan, registry, [plan], 'clash-mihomo')
    expect(disabledExport.valid).toBe(true)
    expect(disabledExport.preview.stages).toHaveLength(1)
    expect(disabledExport.preview.disabledStageNames).toContain('出口节点')

    const parsedDisabled = parseYaml(disabledExport.output) as {
      proxies: Array<Record<string, unknown>>
      'proxy-groups': Array<{ name: string; proxies: string[] }>
      rules: string[]
    }
    expect(parsedDisabled.proxies).toHaveLength(1)
    expect(parsedDisabled.proxies[0]['dialer-proxy']).toBeUndefined()
    expect(parsedDisabled['proxy-groups']).toHaveLength(1)
    expect(parsedDisabled['proxy-groups'][0].name).toBe('入口节点')
    expect(parsedDisabled.rules).toContain('MATCH,入口节点')

    // 重新启用后保留原有的出口节点选择
    plan.exit.enabled = true
    expect(plan.exit.candidateNodeIds).toEqual([exitIds[0]])
    const reEnabledExport = validateAndExportPlan(plan, registry, [plan], 'clash-mihomo')
    expect(reEnabledExport.valid).toBe(true)
    expect(reEnabledExport.exportedNodeCount).toBe(2)

    // 独立出口关闭且中转全部关闭或无节点时，仅允许启用至少一个非空出口层
    plan.exit.enabled = false
    plan.entry.candidateNodeIds = []
    const noActiveCandidates = validateAndExportPlan(plan, registry, [plan], 'clash-mihomo')
    expect(noActiveCandidates.valid).toBe(false)
    expect(noActiveCandidates.diagnostics.some((d) => d.severity === 'error')).toBe(true)
  })

  it('T14/T16: 多来源混合解析统计、别名修改与来源删除影响分析', () => {
    const partialText = [
      'socks5://u:p@ok.example.com:1080#可用',
      'vless://33333333-3333-4333-8333-333333333333@x.example.com:443?type=xhttp#不支持',
      'socks5://bad-line-no-port',
    ].join('\n')
    const parsed = parseProxyInputDetailed(partialText)
    expect(parsed.validCount).toBe(1)
    expect(parsed.unsupportedCount).toBe(1)
    expect(parsed.invalidCount).toBe(1)

    const { registry, sources, entryIds, exitIds } = buildFixtureWorkspace()
    const nodeId = entryIds[0]
    const renamedRegistry = renameNodeDisplayAlias(registry, nodeId, '自命名入口')
    expect(renamedRegistry[nodeId].displayName).toBe('自命名入口')

    const plan = createDefaultChainPlan('plan-impact', '主方案')
    plan.entry.candidateNodeIds = [entryIds[0]]
    plan.exit.candidateNodeIds = [exitIds[0]]

    const impact = computeSourceDeletionImpact(renamedRegistry, sources, [plan], 'src-entry')
    expect(impact.removedExclusiveNodeIds).toContain(entryIds[0])
    expect(impact.affectedPlans).toHaveLength(1)
    expect(impact.affectedPlans[0].brokenNodeIds).toContain(entryIds[0])

    const afterRemove = removeSourceFromWorkspace(renamedRegistry, sources, 'src-entry')
    expect(afterRemove.registry[entryIds[0]]).toBeUndefined()
    expect(afterRemove.registry[exitIds[0]]).toBeDefined()

    // 删除后引用该节点应提示 missing_node_reference 而不是静默回退
    const brokenExport = validateAndExportPlan(plan, afterRemove.registry, [plan], 'clash-mihomo')
    expect(brokenExport.valid).toBe(false)
    expect(brokenExport.diagnostics.some((d) => d.code === 'missing_node_reference')).toBe(true)
  })

  it('T18/T19: 预览模型、保留字组名 DIRECT/REJECT 与节点重名避让', () => {
    const dupA = parseProxyInputDetailed('socks5://u1:p1@a.example.com:1080#DIRECT').nodes[0]
    const dupB = parseProxyInputDetailed('socks5://u2:p2@b.example.com:1081#DIRECT').nodes[0]
    const { registry } = upsertSourceNodes(
      {},
      [],
      { id: 's1', name: 'S1', kind: 'paste', nodeIds: [], status: 'success' },
      [dupA, dupB],
    )

    const plan = createDefaultChainPlan('plan-collide', '重名测试')
    plan.entry.name = 'DIRECT'
    plan.entry.candidateNodeIds = [dupA.id]
    plan.exit.name = 'REJECT'
    plan.exit.candidateNodeIds = [dupB.id]

    const preview = buildChainPreview(plan, registry)
    expect(preview.stages).toHaveLength(2)
    expect(preview.stages[1].isFinalExit).toBe(true)
    expect(preview.isComplete).toBe(true)

    const result = validateAndExportPlan(plan, registry, [plan], 'clash-mihomo')
    expect(result.valid).toBe(true)
    const parsed = parseYaml(result.output) as {
      proxies: Array<{ name: string; 'dialer-proxy'?: string }>
      'proxy-groups': Array<{ name: string; proxies: string[] }>
    }

    const proxyNames = parsed.proxies.map((p) => p.name)
    const groupNames = parsed['proxy-groups'].map((g) => g.name)
    for (const reserved of ['DIRECT', 'REJECT', 'GLOBAL']) {
      expect(proxyNames).not.toContain(reserved)
      expect(groupNames).not.toContain(reserved)
    }
    expect(new Set([...proxyNames, ...groupNames]).size).toBe(proxyNames.length + groupNames.length)
  })

  it('T20: 节点选择策略 select / url-test / fallback 与参数校验及出口切换提示', () => {
    const { registry, entryIds, exitIds } = buildFixtureWorkspace()
    const plan = createDefaultChainPlan('plan-strategy', '策略测试')
    plan.entry.candidateNodeIds = [entryIds[0], entryIds[1]]
    plan.entry.strategy = 'url-test'
    plan.entry.probe = { url: 'https://cp.cloudflare.com/generate_204', intervalSeconds: 180, toleranceMs: 30 }

    plan.exit.candidateNodeIds = [exitIds[0]]
    plan.exit.strategy = 'fallback'
    plan.exit.probe = { url: 'https://www.gstatic.com/generate_204', intervalSeconds: 120 }

    const okResult = validateAndExportPlan(plan, registry, [plan], 'clash-mihomo')
    expect(okResult.valid).toBe(true)
    expect(okResult.diagnostics.some((d) => d.code === 'exit_auto_strategy_warning' && d.severity === 'warning')).toBe(true)

    const parsed = parseYaml(okResult.output) as {
      'proxy-groups': Array<Record<string, unknown>>
    }
    expect(parsed['proxy-groups'][0].type).toBe('url-test')
    expect(parsed['proxy-groups'][0].url).toBe('https://cp.cloudflare.com/generate_204')
    expect(parsed['proxy-groups'][0].interval).toBe(180)
    expect(parsed['proxy-groups'][0].tolerance).toBe(30)
    expect(parsed['proxy-groups'][1].type).toBe('fallback')
    expect(parsed['proxy-groups'][1].interval).toBe(120)

    // 非法探测 URL / 间隔必须报错阻止导出
    plan.entry.probe = { url: 'not-a-url', intervalSeconds: 3, toleranceMs: -1 }
    const badResult = validateAndExportPlan(plan, registry, [plan], 'clash-mihomo')
    expect(badResult.valid).toBe(false)
    expect(badResult.diagnostics.some((d) => d.code === 'invalid_probe_url')).toBe(true)
    expect(badResult.diagnostics.some((d) => d.code === 'invalid_probe_interval')).toBe(true)
    expect(badResult.diagnostics.some((d) => d.code === 'invalid_probe_tolerance')).toBe(true)
  })

  it('T21/T22: 多方案隔离与 schemaVersion: 1 默认不含凭据保存与缺节点提示恢复', () => {
    const { registry, sources, entryIds, exitIds } = buildFixtureWorkspace()
    const planA = createDefaultChainPlan('plan-a', '日常节点')
    planA.entry.candidateNodeIds = [entryIds[0]]
    planA.exit.candidateNodeIds = [exitIds[0]]

    const planB = duplicateChainPlan(planA, 'plan-b', '备用方案')
    planB.exit.enabled = false
    expect(planA.exit.enabled).toBe(true)

    const envelopeNoCreds = serializeWorkspaceState({
      activePlanId: planA.id,
      plans: [planA, planB],
      sources,
      registry,
      includesCredentials: false,
    })
    expect(envelopeNoCreds.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION)
    expect(envelopeNoCreds.includesCredentials).toBe(false)
    expect(envelopeNoCreds.nodes).toBeUndefined()
    const serializedStr = JSON.stringify(envelopeNoCreds)
    expect(serializedStr).not.toContain('pass1')
    expect(serializedStr).not.toContain('hy2pass')

    const restored = validateAndRestoreWorkspace(serializedStr)
    expect(restored.ok).toBe(true)
    if (!restored.ok) {
      throw new Error(restored.error)
    }

    // 未恢复节点正文时，预览应标为 missing，导出阻断而不是回退 DIRECT
    const previewWithoutNodes = buildChainPreview(restored.envelope.plans[0], {})
    expect(previewWithoutNodes.stages[0].candidates[0].missing).toBe(true)
    expect(previewWithoutNodes.isComplete).toBe(false)
    const exportWithoutNodes = validateAndExportPlan(restored.envelope.plans[0], {}, restored.envelope.plans, 'clash-mihomo')
    expect(exportWithoutNodes.valid).toBe(false)
    expect(exportWithoutNodes.diagnostics.some((d) => d.code === 'missing_node_reference')).toBe(true)

    // schemaVersion 错误拒绝恢复
    const badVersion = validateAndRestoreWorkspace(JSON.stringify({ schemaVersion: 99, activePlanId: 'x', plans: [], sources: [] }))
    expect(badVersion.ok).toBe(false)
  })

  it('T23: all-proxy / cn-direct / custom 规则模板及多方案引用合并导出无名称冲突', () => {
    const { registry, entryIds, exitIds } = buildFixtureWorkspace()
    const workPlan = createDefaultChainPlan('plan-work', 'Work')
    workPlan.entry.candidateNodeIds = [entryIds[0]]
    workPlan.exit.candidateNodeIds = [exitIds[0]]

    const homePlan = createDefaultChainPlan('plan-home', 'Home')
    homePlan.entry.candidateNodeIds = [entryIds[1]]
    homePlan.exit.enabled = false

    workPlan.routingPreset = 'all-proxy'
    const allProxyYaml = validateAndExportPlan(workPlan, registry, [workPlan, homePlan], 'clash-mihomo')
    const parsedAllProxy = parseYaml(allProxyYaml.output) as { rules: string[] }
    expect(parsedAllProxy.rules).toEqual(['MATCH,PROXY'])

    workPlan.routingPreset = 'cn-direct'
    const cnDirectYaml = validateAndExportPlan(workPlan, registry, [workPlan, homePlan], 'clash-mihomo')
    const parsedCnDirect = parseYaml(cnDirectYaml.output) as { rules: string[] }
    expect(parsedCnDirect.rules).toContain('GEOIP,CN,DIRECT')

    workPlan.routingPreset = 'custom'
    workPlan.customRules = [
      { id: 'r1', matchType: 'DOMAIN-SUFFIX', pattern: 'internal.company.com', target: { kind: 'plan', planId: homePlan.id } },
      { id: 'r2', matchType: 'DOMAIN', pattern: 'ads.example.com', target: { kind: 'reject' } },
      { id: 'r3', matchType: 'DOMAIN-KEYWORD', pattern: 'localdev', target: { kind: 'direct' } },
    ]
    workPlan.customFallbackTarget = { kind: 'plan', planId: workPlan.id }

    const customMerged = validateAndExportPlan(workPlan, registry, [workPlan, homePlan], 'clash-mihomo')
    expect(customMerged.valid).toBe(true)
    const parsedCustom = parseYaml(customMerged.output) as {
      proxies: Array<{ name: string; 'dialer-proxy'?: string }>
      'proxy-groups': Array<{ name: string; proxies: string[] }>
      rules: string[]
    }

    // 同名节点跨方案被拆分成独立代理实例，不会互相覆盖 dialer-proxy
    expect(parsedCustom.proxies.length).toBeGreaterThanOrEqual(3)
    const allProxyAndGroupNames = [
      ...parsedCustom.proxies.map((p) => p.name),
      ...parsedCustom['proxy-groups'].map((g) => g.name),
    ]
    expect(new Set(allProxyAndGroupNames).size).toBe(allProxyAndGroupNames.length)
    expect(parsedCustom.rules[0]).toMatch(/^DOMAIN-SUFFIX,internal\.company\.com,/)
    expect(parsedCustom.rules[1]).toBe('DOMAIN,ads.example.com,REJECT')
    expect(parsedCustom.rules[2]).toBe('DOMAIN-KEYWORD,localdev,DIRECT')
    expect(parsedCustom.rules[3]).toBe('MATCH,Work / 出口节点')
  })

  it('T24: Clash 完整配置、合并片段、普通节点链接与批量下载文件名边界', () => {
    const { registry, entryIds, exitIds } = buildFixtureWorkspace()
    const p1 = createDefaultChainPlan('p1', '研发/美国:主线?')
    p1.entry.candidateNodeIds = [entryIds[0]]
    p1.exit.candidateNodeIds = [exitIds[0]]

    const p2 = createDefaultChainPlan('p2', '研发/美国:主线?')
    p2.entry.candidateNodeIds = [entryIds[1]]
    p2.exit.enabled = false

    const snippet = validateAndExportPlan(p1, registry, [p1, p2], 'clash-snippet')
    expect(snippet.valid).toBe(true)
    const parsedSnippet = parseYaml(snippet.output) as Record<string, unknown>
    expect(parsedSnippet['mixed-port']).toBeUndefined()
    expect(parsedSnippet.dns).toBeUndefined()
    expect(Array.isArray(parsedSnippet.proxies)).toBe(true)
    expect(Array.isArray(parsedSnippet['proxy-groups'])).toBe(true)
    expect(Array.isArray(parsedSnippet.rules)).toBe(true)

    const linksExport = validateAndExportPlan(p1, registry, [p1, p2], 'import-links')
    expect(linksExport.valid).toBe(true)
    expect(linksExport.output.split('\n')).toHaveLength(2)

    const registryLinks = exportSelectedNodesAsLinks([entryIds[0], exitIds[0]], registry)
    expect(registryLinks.valid).toBe(true)
    expect(registryLinks.output.split('\n')).toHaveLength(2)

    const batch = buildBatchPlanExports([p1, p2], registry, 'clash-mihomo')
    expect(batch).toHaveLength(2)
    expect(batch[0].fileName).not.toBe(batch[1].fileName)
    expect(batch[0].fileName).toMatch(/\.yaml$/)
    expect(batch[0].fileName).not.toContain('pass1')
    expect(batch[0].fileName).not.toMatch(/[/:?]/)
  })

  it('T25/T26: 高级模式多跳顺序、超过 5 层阻断、同链路重复节点循环阻断与 HY2 上游限制', () => {
    const { registry, entryIds, exitIds } = buildFixtureWorkspace()
    const plan = createDefaultChainPlan('plan-adv', '三跳链')
    plan.mode = 'advanced'
    plan.entry.candidateNodeIds = [entryIds[0]]
    const r1 = createDefaultStage('relay-1', '中转一跳', true, 'select')
    r1.candidateNodeIds = [entryIds[1]]
    const r2 = createDefaultStage('relay-2', '中转二跳', true, 'url-test')
    r2.candidateNodeIds = [entryIds[2]]
    plan.relays = [r1, r2]
    plan.exit.candidateNodeIds = [exitIds[0]]

    const advResult = validateAndExportPlan(plan, registry, [plan], 'clash-mihomo')
    expect(advResult.valid).toBe(true)
    const parsedAdv = parseYaml(advResult.output) as {
      proxies: Array<{ name: string; 'dialer-proxy'?: string }>
      'proxy-groups': Array<{ name: string }>
    }
    expect(parsedAdv.proxies[0]['dialer-proxy']).toBeUndefined()
    expect(parsedAdv.proxies[1]['dialer-proxy']).toBe('入口节点')
    expect(parsedAdv.proxies[2]['dialer-proxy']).toBe('中转一跳')
    expect(parsedAdv.proxies[3]['dialer-proxy']).toBe('中转二跳')

    // 切回简洁模式应保留 relays 配置但导出时忽略 relays
    plan.mode = 'simple'
    const backSimple = validateAndExportPlan(plan, registry, [plan], 'clash-mihomo')
    expect(backSimple.valid).toBe(true)
    expect(backSimple.preview.hiddenRelayCount).toBe(2)
    expect(backSimple.exportedNodeCount).toBe(2)

    // 恢复高级模式验证同链路重复节点阻断
    plan.mode = 'advanced'
    plan.relays[0].candidateNodeIds = [entryIds[0]]
    const loopResult = validateAndExportPlan(plan, registry, [plan], 'clash-mihomo')
    expect(loopResult.valid).toBe(false)
    expect(loopResult.diagnostics.some((d) => d.code === 'same_path_duplicate_node')).toBe(true)

    // 恢复不重复，测试 > 5 启用层阻断
    plan.relays = [
      { ...createDefaultStage('r1', 'R1', true), candidateNodeIds: [entryIds[1]] },
      { ...createDefaultStage('r2', 'R2', true), candidateNodeIds: [entryIds[2]] },
      { ...createDefaultStage('r3', 'R3', true), candidateNodeIds: [entryIds[3]] },
      { ...createDefaultStage('r4', 'R4', true), candidateNodeIds: [exitIds[0]] },
    ]
    const tooManyLayers = validateAndExportPlan(plan, registry, [plan], 'clash-mihomo')
    expect(tooManyLayers.valid).toBe(false)
    expect(tooManyLayers.diagnostics.some((d) => d.code === 'too_many_enabled_layers')).toBe(true)

    // T26: simple-obfs 上游承载 HY2、WS 上游承载 HY2 与嵌套 HY2 均被明确阻断
    const hy2Plan = createDefaultChainPlan('plan-hy2', 'HY2边界')
    hy2Plan.entry.candidateNodeIds = [exitIds[2]] // OBFS SS
    hy2Plan.exit.candidateNodeIds = [exitIds[1]] // HY2
    const obfsToHy2 = validateAndExportPlan(hy2Plan, registry, [hy2Plan], 'clash-mihomo')
    expect(obfsToHy2.valid).toBe(false)
    expect(obfsToHy2.diagnostics.some((d) => d.code === 'upstream_obfs_no_udp_for_hy2')).toBe(true)

    hy2Plan.entry.candidateNodeIds = [entryIds[3]] // VLESS WS
    const wsToHy2 = validateAndExportPlan(hy2Plan, registry, [hy2Plan], 'clash-mihomo')
    expect(wsToHy2.valid).toBe(false)
    expect(wsToHy2.diagnostics.some((d) => d.code === 'upstream_transport_unverified_for_hy2')).toBe(true)

    const secondHy2 = parseProxyInputDetailed('hysteria2://p@hy2-entry.example.com:443?sni=hy2.example.com#HY2入口').nodes[0]
    const withSecondHy2 = upsertSourceNodes(
      registry,
      [],
      { id: 's-hy2', name: 'HY2', kind: 'paste', nodeIds: [], status: 'success' },
      [secondHy2],
    )
    hy2Plan.entry.candidateNodeIds = [secondHy2.id]
    const nestedHy2 = validateAndExportPlan(hy2Plan, withSecondHy2.registry, [hy2Plan], 'clash-mihomo')
    expect(nestedHy2.valid).toBe(false)
    expect(nestedHy2.diagnostics.some((d) => d.code === 'nested_quic_unverified')).toBe(true)

    // 正常 SOCKS5 UDP 入口 -> HY2 出口给出未真机验证 warning 但允许导出
    hy2Plan.entry.candidateNodeIds = [entryIds[0]]
    const socksToHy2 = validateAndExportPlan(hy2Plan, registry, [hy2Plan], 'clash-mihomo')
    expect(socksToHy2.valid).toBe(true)
    expect(socksToHy2.diagnostics.some((d) => d.severity === 'warning' && d.code === 'quic_over_dialer_proxy_unverified')).toBe(true)
  })
})

describe('R02: 方案文件严格深层校验与安全恢复', () => {
  const validMinimalPayload = () => ({
    schemaVersion: 1,
    includesCredentials: false,
    activePlanId: 'review-plan',
    plans: [
      {
        schemaVersion: 1,
        id: 'review-plan',
        name: '脱敏校验样例',
        mode: 'simple',
        entry: {
          id: 'entry',
          name: '入口',
          enabled: true,
          candidateNodeIds: [],
          strategy: 'select',
        },
        relays: [],
        exit: {
          id: 'exit',
          name: '出口',
          enabled: false,
          candidateNodeIds: [],
          strategy: 'select',
        },
        routingPreset: 'custom',
        customRules: [],
        customFallbackTarget: {
          kind: 'plan',
          planId: 'review-plan',
        },
      },
    ],
    sources: [],
  })

  it('R02-T01: 拒绝 customRules: [null] 并返回可读字段路径，不崩溃也不回显凭据', () => {
    const payload = validMinimalPayload()
    ;(payload.plans[0].customRules as unknown[]).push(null)
    const res = validateAndRestoreWorkspace(JSON.stringify(payload))
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toMatch(/customRules/)
    }
  })

  it('R02-T02: 拒绝规则 target 为 null / 未知 kind / 缺失 planId，及非法 customFallbackTarget', () => {
    const cases: Array<() => unknown> = [
      () => {
        const p = validMinimalPayload()
        ;(p.plans[0].customRules as unknown[]).push({
          id: 'r1',
          matchType: 'DOMAIN-SUFFIX',
          pattern: 'example.com',
          target: null,
        })
        return p
      },
      () => {
        const p = validMinimalPayload()
        ;(p.plans[0].customRules as unknown[]).push({
          id: 'r1',
          matchType: 'DOMAIN-SUFFIX',
          pattern: 'example.com',
          target: { kind: 'unknown-kind' },
        })
        return p
      },
      () => {
        const p = validMinimalPayload()
        ;(p.plans[0].customRules as unknown[]).push({
          id: 'r1',
          matchType: 'DOMAIN-SUFFIX',
          pattern: 'example.com',
          target: { kind: 'plan' },
        })
        return p
      },
      () => {
        const p = validMinimalPayload()
        ;(p.plans[0].customFallbackTarget as unknown) = { kind: 'bogus' }
        return p
      },
      () => {
        const p = validMinimalPayload()
        ;(p.plans[0].customFallbackTarget as unknown) = { kind: 'plan', planId: '' }
        return p
      },
      () => {
        const p = validMinimalPayload()
        ;(p.plans[0].customRules as unknown[]).push({
          id: 'r1',
          matchType: 'IP-CIDR',
          pattern: '1.2.3.0/24',
          target: { kind: 'direct' },
        })
        return p
      },
    ]

    for (const build of cases) {
      const res = validateAndRestoreWorkspace(JSON.stringify(build()))
      expect(res.ok).toBe(false)
    }
  })

  it('R02-T03: 拒绝数字或无效 probe URL、非对象 probe 及越界或非整数间隔/容差', () => {
    const badProbes: unknown[] = [
      'not-an-object',
      { url: 12345, intervalSeconds: 300 },
      { url: 'ftp://example.com', intervalSeconds: 300 },
      { url: 'https://www.gstatic.com/generate_204', intervalSeconds: 5 },
      { url: 'https://www.gstatic.com/generate_204', intervalSeconds: 300.5 },
      { url: 'https://www.gstatic.com/generate_204', intervalSeconds: 300, toleranceMs: -1 },
      { url: 'https://www.gstatic.com/generate_204', intervalSeconds: 300, toleranceMs: '50' },
    ]

    for (const probe of badProbes) {
      const p = validMinimalPayload()
      ;(p.plans[0].entry as Record<string, unknown>).probe = probe
      const res = validateAndRestoreWorkspace(JSON.stringify(p))
      expect(res.ok).toBe(false)
    }
  })

  it('R02-T04: 拒绝非法嵌套来源、非法节点字段及重复 ID，不静默丢弃也不在错误中回显凭据', () => {
    const badSourcePayload = {
      ...validMinimalPayload(),
      sources: [{ id: 's1', name: 'A', kind: 'paste', nodeIds: [null], status: 'success' }],
    }
    expect(validateAndRestoreWorkspace(JSON.stringify(badSourcePayload)).ok).toBe(false)

    const dupSourcePayload = {
      ...validMinimalPayload(),
      sources: [
        { id: 'dup-src', name: 'S1', kind: 'paste', nodeIds: [], status: 'success' },
        { id: 'dup-src', name: 'S2', kind: 'paste', nodeIds: [], status: 'success' },
      ],
    }
    expect(validateAndRestoreWorkspace(JSON.stringify(dupSourcePayload)).ok).toBe(false)

    const dupPlanPayload = validMinimalPayload()
    dupPlanPayload.plans.push({ ...dupPlanPayload.plans[0] })
    expect(validateAndRestoreWorkspace(JSON.stringify(dupPlanPayload)).ok).toBe(false)

    const dupStagePayload = validMinimalPayload()
    dupStagePayload.plans[0].exit.id = dupStagePayload.plans[0].entry.id
    expect(validateAndRestoreWorkspace(JSON.stringify(dupStagePayload)).ok).toBe(false)

    const badNodePayload = {
      ...validMinimalPayload(),
      includesCredentials: true,
      nodes: [
        {
          node: {
            id: 'n-secret',
            name: 'bad-vless',
            type: 'vless',
            server: 'vless.example.invalid',
            port: 'not-a-number',
            uuid: 'SUPER-SECRET-UUID-DO-NOT-ECHO',
            security: 'tls',
          },
          sourceIds: ['src-1'],
          sourceAliases: { 'src-1': 'bad-vless' },
          displayName: 'bad-vless',
        },
      ],
    }
    const badNodeRes = validateAndRestoreWorkspace(JSON.stringify(badNodePayload))
    expect(badNodeRes.ok).toBe(false)
    if (!badNodeRes.ok) {
      expect(badNodeRes.error).not.toContain('SUPER-SECRET-UUID-DO-NOT-ECHO')
    }
  })

  it('R02-T05: 正常无凭据与正常含凭据方案可完整恢复；缺失节点引用保留并阻止导出而非改直连', () => {
    const { registry, sources, entryIds, exitIds } = buildFixtureWorkspace()
    const plan = createDefaultChainPlan('plan-ok', '完整方案')
    plan.entry.candidateNodeIds = [entryIds[0]]
    plan.exit.candidateNodeIds = [exitIds[0]]

    const credFree = serializeWorkspaceState({
      activePlanId: plan.id,
      plans: [plan],
      sources,
      registry,
      includesCredentials: false,
    })
    const restoredFree = validateAndRestoreWorkspace(JSON.stringify(credFree))
    expect(restoredFree.ok).toBe(true)
    if (restoredFree.ok) {
      const exportMissing = validateAndExportPlan(
        restoredFree.envelope.plans[0],
        {},
        restoredFree.envelope.plans,
        'clash-mihomo',
      )
      expect(exportMissing.valid).toBe(false)
      expect(exportMissing.diagnostics.some((d) => d.code === 'missing_node_reference')).toBe(true)
    }

    const withCreds = serializeWorkspaceState({
      activePlanId: plan.id,
      plans: [plan],
      sources,
      registry,
      includesCredentials: true,
    })
    const restoredFull = validateAndRestoreWorkspace(JSON.stringify(withCreds))
    expect(restoredFull.ok).toBe(true)
    if (restoredFull.ok) {
      expect(restoredFull.envelope.nodes?.length).toBe(Object.keys(registry).length)
    }
  })
})

describe('R05: 刷新订阅与多来源操作保留用户自定义节点别名', () => {
  const makeSrc = (id: string, name: string): NodeSource => ({
    id,
    name,
    kind: 'subscription',
    nodeIds: [],
    status: 'success',
  })

  it('R05-T01: 单来源节点修改显示别名后用相同内容刷新，保留用户别名、节点 ID 与方案引用', () => {
    const parsed1 = parseProxyInputDetailed('socks5://u:p@node1.example.invalid:1080#entry')
    const src = makeSrc('src-single', '订阅单源')
    const init = upsertSourceNodes({}, [], src, parsed1.nodes)
    const nodeId = parsed1.nodes[0].id

    const renamedReg = renameNodeDisplayAlias(init.registry, nodeId, '自定义别名')
    expect(renamedReg[nodeId].displayName).toBe('自定义别名')

    const plan = createDefaultChainPlan('p-alias', '别名方案')
    plan.entry.candidateNodeIds = [nodeId]
    plan.exit.enabled = false

    const parsedSame = parseProxyInputDetailed('socks5://u:p@node1.example.invalid:1080#entry')
    const refreshed = upsertSourceNodes(renamedReg, init.sources, src, parsedSame.nodes)

    expect(refreshed.registry[nodeId]).toBeDefined()
    expect(refreshed.registry[nodeId].displayName).toBe('自定义别名')
    expect(refreshed.registry[nodeId].sourceAliases['src-single']).toBe('entry')

    const exported = validateAndExportPlan(plan, refreshed.registry, [plan], 'clash-mihomo')
    expect(exported.valid).toBe(true)
    const parsedYaml = parseYaml(exported.output) as { proxies: Array<{ name: string }> }
    expect(parsedYaml.proxies[0].name).toBe('自定义别名')
  })

  it('R05-T02: 已设用户别名时来源原名变化（连接不变），仍优先保留用户别名并更新来源原始别名', () => {
    const parsed1 = parseProxyInputDetailed('socks5://u:p@node2.example.invalid:1080#原名Alpha')
    const src = makeSrc('src-r2', '订阅源')
    const init = upsertSourceNodes({}, [], src, parsed1.nodes)
    const nodeId = parsed1.nodes[0].id
    const renamedReg = renameNodeDisplayAlias(init.registry, nodeId, '我的固定节点')

    const parsedRenamedUpstream = parseProxyInputDetailed(
      'socks5://u:p@node2.example.invalid:1080#上游改名Beta',
    )
    const refreshed = upsertSourceNodes(renamedReg, init.sources, src, parsedRenamedUpstream.nodes)
    expect(refreshed.registry[nodeId].displayName).toBe('我的固定节点')
    expect(refreshed.registry[nodeId].sourceAliases['src-r2']).toBe('上游改名Beta')
  })

  it('R05-T03: 未设置用户别名时来源原名变化，应更新展示名称并保持节点 ID 与方案选中状态', () => {
    const parsed1 = parseProxyInputDetailed('socks5://u:p@node3.example.invalid:1080#机场旧名')
    const src = makeSrc('src-r3', '机场')
    const init = upsertSourceNodes({}, [], src, parsed1.nodes)
    const nodeId = parsed1.nodes[0].id
    const plan = createDefaultChainPlan('p-r3', '默认')
    plan.entry.candidateNodeIds = [nodeId]
    plan.exit.enabled = false

    const parsed2 = parseProxyInputDetailed('socks5://u:p@node3.example.invalid:1080#机场新名')
    const refreshed = upsertSourceNodes(init.registry, init.sources, src, parsed2.nodes)
    expect(refreshed.registry[nodeId].displayName).toBe('机场新名')
    expect(refreshed.registry[nodeId].sourceAliases['src-r3']).toBe('机场新名')

    const exported = validateAndExportPlan(plan, refreshed.registry, [plan], 'clash-mihomo')
    expect(exported.valid).toBe(true)
    const yaml = parseYaml(exported.output) as { proxies: Array<{ name: string }> }
    expect(yaml.proxies[0].name).toBe('机场新名')
  })

  it('R05-T04: 多来源共享节点设置别名后，刷新或删除任一来源、保存恢复后仍保留用户别名与其余来源', () => {
    const linkA = 'socks5://u:p@shared.example.invalid:1080#来源A名字'
    const linkB = 'socks5://u:p@shared.example.invalid:1080#来源B名字'
    const srcA = makeSrc('src-a', '来源A')
    const srcB = makeSrc('src-b', '来源B')

    const step1 = upsertSourceNodes({}, [], srcA, parseProxyInputDetailed(linkA).nodes)
    const step2 = upsertSourceNodes(
      step1.registry,
      step1.sources,
      srcB,
      parseProxyInputDetailed(linkB).nodes,
    )
    const nodeId = Object.keys(step2.registry)[0]
    const renamed = renameNodeDisplayAlias(step2.registry, nodeId, '共享自定义名称')

    const refreshedA = upsertSourceNodes(
      renamed,
      step2.sources,
      srcA,
      parseProxyInputDetailed('socks5://u:p@shared.example.invalid:1080#A最新名字').nodes,
    )
    expect(refreshedA.registry[nodeId].displayName).toBe('共享自定义名称')
    expect(refreshedA.registry[nodeId].sourceIds).toEqual(['src-a', 'src-b'])
    expect(refreshedA.registry[nodeId].sourceAliases['src-a']).toBe('A最新名字')
    expect(refreshedA.registry[nodeId].sourceAliases['src-b']).toBe('来源B名字')

    const afterRemoveA = removeSourceFromWorkspace(refreshedA.registry, refreshedA.sources, 'src-a')
    expect(afterRemoveA.registry[nodeId].displayName).toBe('共享自定义名称')
    expect(afterRemoveA.registry[nodeId].sourceIds).toEqual(['src-b'])

    const plan = createDefaultChainPlan('p-multi', '多源')
    plan.entry.candidateNodeIds = [nodeId]
    plan.exit.enabled = false
    const envelope = serializeWorkspaceState({
      activePlanId: plan.id,
      plans: [plan],
      sources: afterRemoveA.sources,
      registry: afterRemoveA.registry,
      includesCredentials: true,
    })
    const restored = validateAndRestoreWorkspace(JSON.stringify(envelope))
    expect(restored.ok).toBe(true)
    if (restored.ok) {
      const restoredEntry = restored.envelope.nodes?.[0]
      expect(restoredEntry?.displayName).toBe('共享自定义名称')
    }
  })

  it('R05-T05: 同名同地址但凭据或传输参数变化时创建新连接 ID，旧方案引用明确标为失效', () => {
    const src = makeSrc('src-cred', '凭据变更源')
    const p1 = parseProxyInputDetailed('socks5://u:oldpass@host.example.invalid:1080#固定名')
    const oldId = p1.nodes[0].id
    const s1 = upsertSourceNodes({}, [], src, p1.nodes)
    const renamed = renameNodeDisplayAlias(s1.registry, oldId, '我的别名')

    const plan = createDefaultChainPlan('p-cred', '方案')
    plan.entry.candidateNodeIds = [oldId]
    plan.exit.enabled = false

    const p2 = parseProxyInputDetailed('socks5://u:newpass@host.example.invalid:1080#固定名')
    const newId = p2.nodes[0].id
    expect(newId).not.toBe(oldId)

    const s2 = upsertSourceNodes(renamed, s1.sources, src, p2.nodes)
    expect(s2.registry[oldId]).toBeUndefined()
    expect(s2.registry[newId]).toBeDefined()
    expect(s2.registry[newId].displayName).toBe('固定名')

    const exp = validateAndExportPlan(plan, s2.registry, [plan], 'clash-mihomo')
    expect(exp.valid).toBe(false)
    expect(exp.diagnostics.some((d) => d.code === 'missing_node_reference' && d.nodeId === oldId)).toBe(
      true,
    )
  })
})

describe('Z01: 特殊缺失节点引用不被对象原型属性误判为有效节点', () => {
  const makePlanWithRef = (nodeId: string) => {
    const plan = createDefaultChainPlan('plan-z01', '特殊引用方案')
    plan.entry.candidateNodeIds = [nodeId]
    plan.exit.enabled = false
    return plan
  }

  it('Z01-T02: toString / __proto__ / hasOwnProperty 引用不会被当成节点，也不异常导出', () => {
    for (const specialId of ['toString', '__proto__', 'hasOwnProperty', 'constructor', 'valueOf']) {
      const registry: Record<string, ManagedNodeEntry> = {}
      const plan = makePlanWithRef(specialId)

      // 预览：识别为缺失引用而不是读取到继承属性后崩溃
      const preview = buildChainPreview(plan, registry)
      expect(preview.stages[0].candidates[0].missing).toBe(true)
      expect(preview.isComplete).toBe(false)

      // 校验与导出：明确 missing_node_reference 阻止导出，不产出代理
      const clash = validateAndExportPlan(plan, registry, [plan], 'clash-mihomo')
      expect(clash.valid).toBe(false)
      expect(clash.diagnostics.some((d) => d.code === 'missing_node_reference' && d.nodeId === specialId)).toBe(true)
      expect(clash.output).toBe('')

      const links = validateAndExportPlan(plan, registry, [plan], 'import-links')
      expect(links.valid).toBe(false)
      expect(links.output).toBe('')

      const regLinks = exportSelectedNodesAsLinks([specialId], registry)
      expect(regLinks.valid).toBe(false)

      // nodeHints 同样按自有属性读取
      expect(readNodeHint(plan.nodeHints, specialId)).toBeUndefined()
      expect(readRegistryEntry(registry, specialId)).toBeUndefined()
    }
  })

  it('Z01-T03: 预览、拓扑校验、方案链接与节点库链接读取同类缺失引用时不抛异常', () => {
    const plan = createDefaultChainPlan('plan-z0103', '多入口引用')
    plan.entry.candidateNodeIds = ['constructor', 'toString', 'normal-missing']
    plan.exit.candidateNodeIds = ['__proto__']
    plan.exit.enabled = true

    expect(() => buildChainPreview(plan, {})).not.toThrow()
    const clash = validateAndExportPlan(plan, {}, [plan], 'clash-mihomo')
    expect(clash.valid).toBe(false)
    expect(clash.diagnostics.filter((d) => d.code === 'missing_node_reference')).toHaveLength(4)
    const xray = validateAndExportPlan(plan, {}, [plan], 'xray-json')
    expect(xray.valid).toBe(false)
    expect(() => validateAndExportPlan(plan, {}, [plan], 'import-links')).not.toThrow()
  })

  it('Z01-T04: 导入附带节点数据使用特殊标识时注册表保持自有属性且不伪造有效节点', () => {
    const parsed = parseProxyInputDetailed('socks5://u:p@z01.example.invalid:1080#z01node')
    const normalNode = parsed.nodes[0]
    const specialEntry: ManagedNodeEntry = {
      node: { ...normalNode, id: 'constructor', name: 'special-id-node' },
      sourceIds: ['src-z1'],
      sourceAliases: { 'src-z1': 'special-id-node' },
      displayName: 'special-id-node',
    }

    const envelope = serializeWorkspaceState({
      activePlanId: 'p',
      plans: [createDefaultChainPlan('p', 'P')],
      sources: [{ id: 'src-z1', name: 'S1', kind: 'paste', nodeIds: ['constructor'], status: 'success' }],
      registry: { constructor: specialEntry },
      includesCredentials: true,
    })

    const restored = validateAndRestoreWorkspace(JSON.stringify(envelope))
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.envelope.nodes?.some((e) => e.node.id === 'constructor')).toBe(true)

    // App.applyRestoredEnvelope 使用 createRegistryFromEntries 重建注册表；这里直接验证其行为
    const registry = createRegistryFromEntries(restored.envelope.nodes ?? [])
    expect(Object.prototype.hasOwnProperty.call(registry, 'constructor')).toBe(true)
    expect(readRegistryEntry(registry, 'constructor')?.displayName).toBe('special-id-node')
    expect(Object.getPrototypeOf(registry)).toBe(Object.prototype)
  })

  it('Z01-T05: 普通缺失引用保持可编辑待补全；正常方案不受特殊读取规则影响', () => {
    const fixture = buildFixtureWorkspace()
    const plan = createDefaultChainPlan('plan-z0105', '正常方案')
    plan.entry.candidateNodeIds = [fixture.entryIds[0]]
    plan.exit.enabled = false
    const ok = validateAndExportPlan(plan, fixture.registry, [plan], 'clash-mihomo')
    expect(ok.valid).toBe(true)

    const missingPlan = makePlanWithRef('not-exist-id')
    const missingPreview = buildChainPreview(missingPlan, fixture.registry)
    expect(missingPreview.stages[0].candidates[0].name).toContain('已失效')
    expect(missingPreview.isComplete).toBe(false)
  })
})

describe('Z02: 撤销只恢复目标来源自己的节点关联', () => {
  const NODE_N = 'socks5://demo:REDACTED@old.example.invalid:1080#original'
  const NODE_M = 'socks5://demo:REDACTED@new.example.invalid:1080#newer'
  const makeSrc = (id: string, name: string): NodeSource => ({
    id,
    name,
    kind: 'subscription',
    nodeIds: [],
    status: 'success',
  })

  it('Z02-T01: 删除 A → C 刷新移除 N → 撤销 A 仅恢复 A 关联；再次删除 A 后 N 消失', () => {
    const nNodes = parseProxyInputDetailed(NODE_N).nodes
    const mNodes = parseProxyInputDetailed(NODE_M).nodes
    const nodeNId = nNodes[0].id

    const srcA = makeSrc('src-a', '来源A')
    const srcC = makeSrc('src-c', '来源C')
    const step1 = upsertSourceNodes({}, [], srcA, nNodes)
    const step2 = upsertSourceNodes(step1.registry, step1.sources, srcC, nNodes)
    expect(step2.registry[nodeNId].sourceIds).toEqual(['src-a', 'src-c'])

    // 删除 A
    const snapshot = {
      source: step2.sources.find((s) => s.id === 'src-a')!,
      nodeEntries: [structuredClone(step2.registry[nodeNId])],
    }
    const afterDeleteA = removeSourceFromWorkspace(step2.registry, step2.sources, 'src-a')
    expect(afterDeleteA.registry[nodeNId].sourceIds).toEqual(['src-c'])

    // C 刷新，结果只包含 M
    const afterRefreshC = upsertSourceNodes(
      afterDeleteA.registry,
      afterDeleteA.sources,
      srcC,
      mNodes,
    )
    expect(afterRefreshC.registry[nodeNId]).toBeUndefined()

    // 撤销 A：N 恢复且仅关联 A
    const undone = restoreDeletedSource(afterRefreshC.registry, afterRefreshC.sources, snapshot)
    expect(undone.registry[nodeNId]).toBeDefined()
    expect(undone.registry[nodeNId].sourceIds).toEqual(['src-a'])
    expect(undone.registry[nodeNId].sourceAliases).toEqual({ 'src-a': 'original' })

    // 双向一致：A.nodeIds 包含 N
    const restoredSourceA = undone.sources.find((s) => s.id === 'src-a')!
    expect(restoredSourceA.nodeIds).toContain(nodeNId)

    // 再次删除 A：N 从节点库消失
    const reDelete = removeSourceFromWorkspace(undone.registry, undone.sources, 'src-a')
    expect(reDelete.registry[nodeNId]).toBeUndefined()
  })

  it('Z02-T02: 删除 A 后 C 仍保留 N 并刷新了别名，恢复 A 不回滚 C 的最新数据', () => {
    const nNodes = parseProxyInputDetailed(NODE_N).nodes
    const nodeNId = nNodes[0].id
    const srcA = makeSrc('src-a', '来源A')
    const srcC = makeSrc('src-c', '来源C')

    const step1 = upsertSourceNodes({}, [], srcA, nNodes)
    const step2 = upsertSourceNodes(step1.registry, step1.sources, srcC, nNodes)
    const renamed = renameNodeDisplayAlias(step2.registry, nodeNId, '用户新别名')
    const snapshot = {
      source: step2.sources.find((s) => s.id === 'src-a')!,
      nodeEntries: [structuredClone(renamed[nodeNId])],
    }

    const afterDeleteA = removeSourceFromWorkspace(renamed, step2.sources, 'src-a')
    // C 仍在提供 N，且用户改过别名
    expect(afterDeleteA.registry[nodeNId].displayName).toBe('用户新别名')

    const undone = restoreDeletedSource(afterDeleteA.registry, afterDeleteA.sources, snapshot)
    expect(undone.registry[nodeNId].displayName).toBe('用户新别名')
    expect(undone.registry[nodeNId].userAlias).toBe('用户新别名')
    expect(undone.registry[nodeNId].sourceIds).toEqual(['src-c', 'src-a'])
    expect(undone.registry[nodeNId].sourceAliases['src-a']).toBe('original')
    expect(undone.registry[nodeNId].sourceAliases['src-c']).toBe('original')
  })

  it('Z02-T03: 删除 A 后再删除 C，然后恢复 A：不复活 C 及其别名关联', () => {
    const nNodes = parseProxyInputDetailed(NODE_N).nodes
    const nodeNId = nNodes[0].id
    const srcA = makeSrc('src-a', '来源A')
    const srcC = makeSrc('src-c', '来源C')

    const step1 = upsertSourceNodes({}, [], srcA, nNodes)
    const step2 = upsertSourceNodes(step1.registry, step1.sources, srcC, nNodes)
    const snapshot = {
      source: step2.sources.find((s) => s.id === 'src-a')!,
      nodeEntries: [structuredClone(step2.registry[nodeNId])],
    }

    const afterBothDeleted = removeSourceFromWorkspace(
      removeSourceFromWorkspace(step2.registry, step2.sources, 'src-a').registry,
      removeSourceFromWorkspace(step2.registry, step2.sources, 'src-a').sources,
      'src-c',
    )
    expect(afterBothDeleted.registry[nodeNId]).toBeUndefined()

    const undone = restoreDeletedSource(afterBothDeleted.registry, afterBothDeleted.sources, snapshot)
    expect(undone.registry[nodeNId]).toBeDefined()
    expect(undone.registry[nodeNId].sourceIds).toEqual(['src-a'])
    expect(undone.registry[nodeNId].sourceAliases).toEqual({ 'src-a': 'original' })
    expect(undone.sources.some((s) => s.id === 'src-c')).toBe(false)
  })

  it('Z02-T04: N 还由 D 提供；删除 A 后 C 移除 N，恢复 A 后 N 仅关联 D 与 A', () => {
    const nNodes = parseProxyInputDetailed(NODE_N).nodes
    const nodeNId = nNodes[0].id
    const srcA = makeSrc('src-a', '来源A')
    const srcC = makeSrc('src-c', '来源C')
    const srcD = makeSrc('src-d', '来源D')

    let state = upsertSourceNodes({}, [], srcA, nNodes)
    state = upsertSourceNodes(state.registry, state.sources, srcC, nNodes)
    state = upsertSourceNodes(state.registry, state.sources, srcD, nNodes)

    const snapshot = {
      source: state.sources.find((s) => s.id === 'src-a')!,
      nodeEntries: [structuredClone(state.registry[nodeNId])],
    }

    // 删除 A 后，C 刷新移除 N（D 仍提供）
    let after = removeSourceFromWorkspace(state.registry, state.sources, 'src-a')
    after = upsertSourceNodes(after.registry, after.sources, srcC, [])
    expect(after.registry[nodeNId].sourceIds).toEqual(['src-d'])

    const undone = restoreDeletedSource(after.registry, after.sources, snapshot)
    expect(undone.registry[nodeNId].sourceIds).toEqual(['src-d', 'src-a'])
    expect(undone.registry[nodeNId].sourceAliases).toEqual({
      'src-d': 'original',
      'src-a': 'original',
    })
  })

  it('Z02-T05: 删除 A 后新增 B、撤销 A、重复触发撤销：B 与节点保留且无重复追加', () => {
    const nNodes = parseProxyInputDetailed(NODE_N).nodes
    const nodeNId = nNodes[0].id
    const srcA = makeSrc('src-a', '来源A')
    const srcB = makeSrc('src-b', '来源B')

    const init = upsertSourceNodes({}, [], srcA, nNodes)
    const snapshot = {
      source: init.sources.find((s) => s.id === 'src-a')!,
      nodeEntries: [structuredClone(init.registry[nodeNId])],
    }
    const afterDelete = removeSourceFromWorkspace(init.registry, init.sources, 'src-a')

    // 期间新增 B（提供另一连接 M）
    const withB = upsertSourceNodes(
      afterDelete.registry,
      afterDelete.sources,
      srcB,
      parseProxyInputDetailed(NODE_M).nodes,
    )

    const undone = restoreDeletedSource(withB.registry, withB.sources, snapshot)
    expect(undone.sources.map((s) => s.id)).toEqual(['src-b', 'src-a'])
    expect(undone.registry[nodeNId].sourceIds).toEqual(['src-a'])
    expect(Object.keys(undone.registry)).toHaveLength(2)

    // 重复撤销：来源已存在时为无操作
    const undoneTwice = restoreDeletedSource(undone.registry, undone.sources, snapshot)
    expect(undoneTwice.registry).toBe(undone.registry)
    expect(undoneTwice.sources).toBe(undone.sources)
  })
})

describe('Z03: 旧版 schemaVersion 1 文件的自定义别名迁移', () => {
  const makeSrc = (id: string, name: string): NodeSource => ({
    id,
    name,
    kind: 'subscription',
    nodeIds: [],
    status: 'success',
  })

  function buildLegacyEnvelope(userAliasStripped: boolean) {
    const parsed = parseProxyInputDetailed('socks5://demo:REDACTED@old.example.invalid:1080#original')
    const src = makeSrc('src-legacy', '旧订阅')
    const state = upsertSourceNodes({}, [], src, parsed.nodes)
    const nodeId = parsed.nodes[0].id
    const renamed = renameNodeDisplayAlias(state.registry, nodeId, '历史自定义别名')

    const plan = createDefaultChainPlan('p-legacy', '旧方案')
    plan.entry.candidateNodeIds = [nodeId]
    plan.exit.enabled = false

    const envelope = serializeWorkspaceState({
      activePlanId: plan.id,
      plans: [plan],
      sources: state.sources,
      registry: renamed,
      includesCredentials: true,
    })

    if (userAliasStripped) {
      for (const entry of envelope.nodes ?? []) {
        delete (entry as unknown as Record<string, unknown>).userAlias
      }
    }
    return { envelope, nodeId, src, plan }
  }

  it('Z03-T01: 旧文件有自定义 displayName、无 userAlias → 恢复 → 相同来源刷新后历史别名保持', () => {
    const { envelope, nodeId, src, plan } = buildLegacyEnvelope(true)
    const restored = validateAndRestoreWorkspace(JSON.stringify(envelope))
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    const restoredEntry = restored.envelope.nodes?.find((e) => e.node.id === nodeId)
    expect(restoredEntry?.displayName).toBe('历史自定义别名')
    expect(restoredEntry?.userAlias).toBe('历史自定义别名')

    // 相同内容刷新
    const registry: Record<string, ManagedNodeEntry> = {}
    for (const e of restored.envelope.nodes ?? []) registry[e.node.id] = e
    const refreshed = upsertSourceNodes(
      registry,
      restored.envelope.sources,
      src,
      parseProxyInputDetailed('socks5://demo:REDACTED@old.example.invalid:1080#original').nodes,
    )
    expect(refreshed.registry[nodeId].displayName).toBe('历史自定义别名')
    expect(refreshed.registry[nodeId].sourceAliases['src-legacy']).toBe('original')

    const exported = validateAndExportPlan(plan, refreshed.registry, [plan], 'clash-mihomo')
    expect(exported.valid).toBe(true)
    const yaml = parseYaml(exported.output) as { proxies: Array<{ name: string }> }
    expect(yaml.proxies[0].name).toBe('历史自定义别名')
  })

  it('Z03-T02: 旧文件恢复后来源改名但连接不变：历史别名优先，来源原名信息更新', () => {
    const { envelope, nodeId, src } = buildLegacyEnvelope(true)
    const restored = validateAndRestoreWorkspace(JSON.stringify(envelope))
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    const registry: Record<string, ManagedNodeEntry> = {}
    for (const e of restored.envelope.nodes ?? []) registry[e.node.id] = e

    const refreshed = upsertSourceNodes(
      registry,
      restored.envelope.sources,
      src,
      parseProxyInputDetailed('socks5://demo:REDACTED@old.example.invalid:1080#上游改名Beta').nodes,
    )
    expect(refreshed.registry[nodeId].displayName).toBe('历史自定义别名')
    expect(refreshed.registry[nodeId].sourceAliases['src-legacy']).toBe('上游改名Beta')
  })

  it('Z03-T03: 无用户覆盖的正常名称不固化；新版显式 userAlias 保留', () => {
    // 未改名的正常节点：displayName 与来源原名一致 → 不迁移为 userAlias
    const parsed = parseProxyInputDetailed('socks5://u:p@plain.example.invalid:1080#plainName')
    const src = makeSrc('src-plain', '普通源')
    const state = upsertSourceNodes({}, [], src, parsed.nodes)
    const nodeId = parsed.nodes[0].id
    const envelope = serializeWorkspaceState({
      activePlanId: 'p',
      plans: [createDefaultChainPlan('p', 'P')],
      sources: state.sources,
      registry: state.registry,
      includesCredentials: true,
    })
    for (const entry of envelope.nodes ?? []) {
      delete (entry as unknown as Record<string, unknown>).userAlias
    }
    const restored = validateAndRestoreWorkspace(JSON.stringify(envelope))
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    const entry = restored.envelope.nodes?.find((e) => e.node.id === nodeId)
    expect(entry?.userAlias).toBeUndefined()
    // 来源改名后显示名跟随更新
    const registry: Record<string, ManagedNodeEntry> = {}
    for (const e of restored.envelope.nodes ?? []) registry[e.node.id] = e
    const refreshed = upsertSourceNodes(
      registry,
      restored.envelope.sources,
      src,
      parseProxyInputDetailed('socks5://u:p@plain.example.invalid:1080#renamedUpstream').nodes,
    )
    expect(refreshed.registry[nodeId].displayName).toBe('renamedUpstream')

    // 新版显式 userAlias 文件正常保留
    const { envelope: withAlias, nodeId: aliasNodeId } = buildLegacyEnvelope(false)
    const restoredNew = validateAndRestoreWorkspace(JSON.stringify(withAlias))
    expect(restoredNew.ok).toBe(true)
    if (restoredNew.ok) {
      expect(restoredNew.envelope.nodes?.find((e) => e.node.id === aliasNodeId)?.userAlias).toBe(
        '历史自定义别名',
      )
    }
  })

  it('Z03-T04: 旧文件迁移 → 共享来源增删与撤销 → 再保存恢复，别名与来源关系保持', () => {
    const { envelope, nodeId } = buildLegacyEnvelope(true)
    const restored = validateAndRestoreWorkspace(JSON.stringify(envelope))
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    const registry: Record<string, ManagedNodeEntry> = {}
    for (const e of restored.envelope.nodes ?? []) registry[e.node.id] = e

    // 新增共享来源 B（同名同连接，不同原始名）
    const srcB = makeSrc('src-b', '来源B')
    const withB = upsertSourceNodes(
      registry,
      restored.envelope.sources,
      srcB,
      parseProxyInputDetailed('socks5://demo:REDACTED@old.example.invalid:1080#B名字').nodes,
    )
    expect(withB.registry[nodeId].displayName).toBe('历史自定义别名')

    // 删除 B 再撤销：别名仍保留且只恢复 B 关联
    const snapshot = {
      source: withB.sources.find((s) => s.id === 'src-b')!,
      nodeEntries: [structuredClone(withB.registry[nodeId])],
    }
    const afterDelB = removeSourceFromWorkspace(withB.registry, withB.sources, 'src-b')
    const undoneB = restoreDeletedSource(afterDelB.registry, afterDelB.sources, snapshot)
    expect(undoneB.registry[nodeId].displayName).toBe('历史自定义别名')
    expect(undoneB.registry[nodeId].sourceIds).toEqual(['src-legacy', 'src-b'])

    // 再次保存/恢复：迁移后的别名持续保留
    const resaved = serializeWorkspaceState({
      activePlanId: 'p-legacy',
      plans: restored.envelope.plans,
      sources: undoneB.sources,
      registry: undoneB.registry,
      includesCredentials: true,
    })
    const restoredAgain = validateAndRestoreWorkspace(JSON.stringify(resaved))
    expect(restoredAgain.ok).toBe(true)
    if (restoredAgain.ok) {
      expect(restoredAgain.envelope.nodes?.find((e) => e.node.id === nodeId)?.userAlias).toBe(
        '历史自定义别名',
      )
    }
  })

  it('Z03-T05: 旧版无凭据结构文件待补全；同名但凭据变化不继承身份', () => {
    // 无凭据结构文件：不附节点正文
    const parsed = parseProxyInputDetailed('socks5://demo:REDACTED@old.example.invalid:1080#original')
    const src = makeSrc('src-legacy', '旧订阅')
    const state = upsertSourceNodes({}, [], src, parsed.nodes)
    const plan = createDefaultChainPlan('p-struct', '结构文件')
    plan.entry.candidateNodeIds = [parsed.nodes[0].id]
    plan.exit.enabled = false
    const envelope = serializeWorkspaceState({
      activePlanId: plan.id,
      plans: [plan],
      sources: state.sources,
      registry: state.registry,
      includesCredentials: false,
    })
    const restored = validateAndRestoreWorkspace(JSON.stringify(envelope))
    expect(restored.ok).toBe(true)
    if (restored.ok) {
      expect(restored.envelope.nodes).toBeUndefined()
      const exportMissing = validateAndExportPlan(restored.envelope.plans[0], {}, restored.envelope.plans, 'clash-mihomo')
      expect(exportMissing.valid).toBe(false)
    }

    // 同名同地址但凭据变化（同一来源刷新）：新连接身份，旧引用失效
    const oldId = parsed.nodes[0].id
    const newNodes = parseProxyInputDetailed(
      'socks5://demo:newpass@old.example.invalid:1080#original',
    ).nodes
    expect(newNodes[0].id).not.toBe(oldId)
    const s2 = upsertSourceNodes(state.registry, state.sources, src, newNodes)
    expect(s2.registry[oldId]).toBeUndefined()
    expect(s2.registry[newNodes[0].id]).toBeDefined()
    const exp = validateAndExportPlan(plan, s2.registry, [plan], 'clash-mihomo')
    expect(exp.valid).toBe(false)
    expect(exp.diagnostics.some((d) => d.code === 'missing_node_reference' && d.nodeId === oldId)).toBe(true)
  })
})
