import type { TargetFormat } from '../lib'

export type Language = 'zh' | 'en'

export type ExportTabKey =
  | 'clash-mihomo'
  | 'clash-snippet'
  | 'links'
  | 'batch'
  | 'v2rayn-guide'

export interface UiCopy {
  title: string
  privacyLocalBadge: string
  privacyRemoteNote: string
  sourcesTitle: string
  sourcesDesc: string
  tabSubscription: string
  tabPaste: string
  tabManual: string
  sourceNameLabel: string
  sourceNamePlaceholder: string
  subUrlLabel: string
  subUrlPlaceholder: string
  fetchModeLabel: string
  fetchModeAuto: string
  fetchModeHosted: string
  fetchModeDirect: string
  fetchModeService: string
  fetcherEndpointLabel: string
  fetcherTokenLabel: string
  fetcherHintHostedOk: string
  fetcherHintHostedOff: string
  addSubscriptionBtn: string
  pasteLabel: string
  pastePlaceholder: string
  addPasteBtn: string
  addManualBtn: string
  manualProtocolLabel: string
  manualNameLabel: string
  manualServerLabel: string
  manualPortLabel: string
  manualUuidLabel: string
  manualSecurityLabel: string
  manualTransportLabel: string
  manualSniLabel: string
  manualFpLabel: string
  manualPbkLabel: string
  manualSidLabel: string
  manualWsPathLabel: string
  manualWsHostLabel: string
  manualGrpcServiceLabel: string
  manualUsernameLabel: string
  manualPasswordLabel: string
  manualCipherLabel: string
  manualPluginLabel: string
  manualPluginOptsLabel: string
  manualHy2ObfsLabel: string
  manualHy2ObfsPasswordLabel: string
  manualHy2PortsLabel: string
  manualUdpLabel: string
  manualSkipCertLabel: string
  refreshSource: string
  cancelRefresh: string
  deleteSource: string
  confirmDelete: string
  cancelDelete: string
  undoDelete: string
  deletedNotice: string
  sourceStatusLoading: string
  sourceStatusSuccess: string
  sourceStatusFailed: string
  sourceKeepOldNotice: string
  parseStatsPrefix: string
  planWorkspaceTitle: string
  activePlanLabel: string
  newPlanBtn: string
  renamePlanBtn: string
  duplicatePlanBtn: string
  deletePlanBtn: string
  modeLabel: string
  modeSimple: string
  modeAdvanced: string
  simpleModeHiddenRelaysNotice: string
  persistenceTitle: string
  saveLocalBtn: string
  restoreLocalBtn: string
  clearLocalBtn: string
  exportPlanJsonBtn: string
  importPlanJsonBtn: string
  includeCredsToggle: string
  includeCredsWarning: string
  localDefaultSafeNote: string
  useIndependentExit: string
  stageAddNode: string
  stageImportNodes: string
  stageAddAndSelect: string
  stageImportAndSelect: string
  stageCloseForm: string
  stageNodesSelected: string
  stageUnsupportedInput: string
  stageEmptyNodes: string
  stageAddNextStepHint: string
  proxyModeLabel: string
  entryOnlyMode: string
  chainProxyMode: string
  relayOnlyMode: string
  relayWithExitMode: string
  exitDisabledBanner: string
  addRelayBtn: string
  maxLayersBadge: string
  enableStage: string
  disableStage: string
  moveUp: string
  moveDown: string
  removeStage: string
  strategyLabel: string
  strategySelect: string
  strategyUrlTest: string
  strategyFallback: string
  probeUrlLabel: string
  probeIntervalLabel: string
  probeToleranceLabel: string
  exitAutoStrategyNote: string
  searchNodesPlaceholder: string
  filterAllProtocols: string
  filterAllSources: string
  selectFilteredBtn: string
  clearFilteredBtn: string
  clearStageBtn: string
  renameNodePlaceholder: string
  saveAliasBtn: string
  cancelAliasBtn: string
  missingRefBadge: string
  removeBrokenRefBtn: string
  routingTitle: string
  routingPresetLabel: string
  routingAllProxy: string
  routingCnDirect: string
  routingCustom: string
  addRuleBtn: string
  fallbackTargetLabel: string
  targetDirect: string
  targetReject: string
  targetPlanPrefix: string
  previewTitle: string
  previewSubtitle: string
  localDevice: string
  targetWebsite: string
  finalExitBadge: string
  emptyCandidates: string
  outputTitle: string
  outputTabMihomo: string
  outputTabSnippet: string
  outputTabLinks: string
  outputTabBatch: string
  outputTabTempLink: string
  outputTabV2rayn: string
  copyOutputBtn: string
  copiedBtn: string
  downloadOutputBtn: string
  exportBlockedTitle: string
  exportWarningsTitle: string
  dnsDisclosureTitle: string
  dnsDisclosureBody: string
  snippetMergeTitle: string
  snippetMergeBody: string
  linksModeNotice: string
  linksSourcePlan: string
  linksSourceRegistry: string
  tempImportTitle: string
  tempImportDisclosure: string
  tempImportUnavailable: string
  createTempImportBtn: string
  creatingTempImportBtn: string
  openClashSchemeBtn: string
  copyTempUrlBtn: string
  shadowrocketDisclosure: string
  statusReady: string
  statusBlocked: string
  statusIdle: string
  capabilitiesLabel: string
  // ---- 三步流程与高级面板（本轮 UI 简化新增）----
  stepNavAria: string
  stepImportTitle: string
  stepChainTitle: string
  stepExportTitle: string
  nextStepBtn: string
  prevStepBtn: string
  downloadConfigBtn: string
  nextDisabledEmptyReason: string
  step2BlockedBanner: string
  currentPlanLabel: string
  multiHopBadge: string
  customRoutingBadge: string
  relayCountSummary: string
  exitOnSummary: string
  exitOffSummary: string
  advancedSettingsBtn: string
  advChainGroup: string
  advPlanGroup: string
  advSaveGroup: string
  advEnvGroup: string
  envFetcherState: string
  envTempState: string
  uploadFileBtn: string
  unifiedInputLabel: string
  unifiedInputPlaceholder: string
  unifiedImportBtn: string
  unifiedImportingBtn: string
  unifiedWillFetchNote: string
  unifiedWillFetchViaServiceNote: string
  unifiedMixedError: string
  unifiedEmptyError: string
  moreWaysBtn: string
  moreWaysManual: string
  moreWaysSubOptions: string
  sourceRowExpand: string
  sourceRowCollapse: string
  sourceActionsLabel: string
  importedCountMsg: string
  importedCountWithSkippedMsg: string
  viewDetailsBtn: string
  hideDetailsBtn: string
  stageSettingsLabel: string
  strategyShortSelect: string
  strategyShortUrlTest: string
  strategyShortFallback: string
  currentChainTitle: string
  currentChainSubtitle: string
  stageSelectedCount: string
  stageMissingCount: string
  exitOffShortNote: string
  copyConfigBtn: string
  viewConfigBtn: string
  hideConfigBtn: string
  backToEditBtn: string
  exportTargetLabel: string
  needFixCount: string
  goToFixBtn: string
  warningsCount: string
  moreExportsBtn: string
  linksNotChainedNote: string
  saveCredsShortNote: string
  saveStructureShortNote: string
  goStep2FocusTarget: string
}

export const COPY: Record<Language, UiCopy> = {
  zh: {
    title: '代理编辑工具',
    privacyLocalBadge: '解析与导出在本机完成',
    privacyRemoteNote:
      '节点解析与配置导出仅在本机浏览器完成；拉取订阅或生成临时导入链接时才会联网。',
    sourcesTitle: '导入节点',
    sourcesDesc: '粘贴一个订阅地址、节点链接或 Clash YAML，自动识别导入。',
    tabSubscription: '添加订阅',
    tabPaste: '粘贴节点/配置',
    tabManual: '手动添加',
    sourceNameLabel: '来源名称',
    sourceNamePlaceholder: '例如：日常机场订阅 / 自建落地节点',
    subUrlLabel: '订阅地址 (HTTPS / HTTP)',
    subUrlPlaceholder: 'https://sub.example.com/clash.yaml',
    fetchModeLabel: '拉取方式',
    fetchModeAuto: '自动判断（同源可用时优先同源，否则直连）',
    fetchModeHosted: '同源后端 (/api/fetch-subscription)',
    fetchModeDirect: '浏览器直连 (需订阅源支持 CORS)',
    fetchModeService: '外部拉取服务 (URL + Token)',
    fetcherEndpointLabel: '拉取服务地址',
    fetcherTokenLabel: '访问令牌 (Bearer Token，仅本次使用)',
    fetcherHintHostedOk: '已检测到同源后端订阅拉取能力 (/api/fetch-subscription)。',
    fetcherHintHostedOff: '当前未检测到同源后端；纯静态部署下直连订阅需目标站允许 CORS，或配置外部拉取服务。',
    addSubscriptionBtn: '拉取并添加订阅来源',
    pasteLabel: '粘贴节点链接 (vless/socks5/hy2/ss) 或 Clash YAML 片段',
    pastePlaceholder: '每行一条代理链接，或直接粘贴含 proxies: 的 YAML 配置…',
    addPasteBtn: '解析并添加到节点库',
    addManualBtn: '校验并添加手动节点',
    manualProtocolLabel: '协议',
    manualNameLabel: '节点别名',
    manualServerLabel: '服务器 (域名/IP)',
    manualPortLabel: '端口',
    manualUuidLabel: 'UUID',
    manualSecurityLabel: '安全层',
    manualTransportLabel: '传输协议',
    manualSniLabel: 'SNI / Servername',
    manualFpLabel: 'Fingerprint (fp)',
    manualPbkLabel: 'Reality Public Key (pbk)',
    manualSidLabel: 'Reality Short ID (sid)',
    manualWsPathLabel: 'WS Path',
    manualWsHostLabel: 'WS Host',
    manualGrpcServiceLabel: 'gRPC Service Name',
    manualUsernameLabel: '用户名 (可选)',
    manualPasswordLabel: '密码',
    manualCipherLabel: '加密方式 (Cipher)',
    manualPluginLabel: '插件 (可选)',
    manualPluginOptsLabel: '插件参数 (如 obfs=tls;obfs-host=example.com)',
    manualHy2ObfsLabel: '混淆类型 (可选)',
    manualHy2ObfsPasswordLabel: '混淆密码',
    manualHy2PortsLabel: '端口跳跃范围 (可选，如 20000-30000)',
    manualUdpLabel: '启用 UDP 转发',
    manualSkipCertLabel: '跳过证书校验 (skip-cert-verify)',
    refreshSource: '刷新',
    cancelRefresh: '取消刷新',
    deleteSource: '删除来源',
    confirmDelete: '确认删除该来源',
    cancelDelete: '取消',
    undoDelete: '撤销删除',
    deletedNotice: '已删除来源。若为误删可立即撤销恢复：',
    sourceStatusLoading: '拉取中…',
    sourceStatusSuccess: '正常',
    sourceStatusFailed: '失败（已保留旧节点）',
    sourceKeepOldNotice: '最近一次刷新失败，节点库仍保留上次成功解析的节点。',
    parseStatsPrefix: '解析统计',
    planWorkspaceTitle: '链路与分流',
    activePlanLabel: '当前方案',
    newPlanBtn: '新建方案',
    renamePlanBtn: '重命名',
    duplicatePlanBtn: '复制',
    deletePlanBtn: '删除方案',
    modeLabel: '编排模式',
    modeSimple: '简洁模式 (入口 → 出口节点)',
    modeAdvanced: '高级模式 (入口 → 多跳中转 → 出口节点)',
    simpleModeHiddenRelaysNotice: '当前简洁模式已暂隐 %d 个中转层（完整保留配置，不参与当前导出；切回高级模式可恢复）。',
    persistenceTitle: '本机保存与方案 JSON（均需显式触发）',
    saveLocalBtn: '保存到本机',
    restoreLocalBtn: '从本机恢复',
    clearLocalBtn: '清除本机保存',
    exportPlanJsonBtn: '导出方案 JSON',
    importPlanJsonBtn: '导入方案 JSON',
    includeCredsToggle: '一并在本机存储节点凭据（默认关闭；明文存储在浏览器 localStorage 存在泄露风险）',
    includeCredsWarning: '已开启：节点凭据将明文写入浏览器 localStorage，请仅在受信任的个人设备开启。',
    localDefaultSafeNote: '默认仅保存方案结构与节点引用提示（不含 UUID / 密码 / 令牌），恢复后需重新导入节点来源。',
    useIndependentExit: '使用出口节点',
    stageAddNode: '添加节点',
    stageImportNodes: '导入节点',
    stageAddAndSelect: '添加并选中',
    stageImportAndSelect: '导入并选中',
    stageCloseForm: '关闭节点表单',
    stageNodesSelected: '已选入%s。',
    stageUnsupportedInput: '未识别到节点，请输入订阅地址、节点链接或 Clash YAML。',
    stageEmptyNodes: '暂无节点，可点击上方“添加节点”或“导入节点”。',
    stageAddNextStepHint: '也可在下一步直接添加节点',
    proxyModeLabel: '代理方式',
    entryOnlyMode: '仅入口代理',
    chainProxyMode: '链式代理',
    relayOnlyMode: '入口 + 中转',
    relayWithExitMode: '中转 + 出口',
    exitDisabledBanner: '已关闭出口节点',
    addRelayBtn: '添加中转层',
    maxLayersBadge: '启用上限 5 层',
    enableStage: '启用此层',
    disableStage: '停用此层',
    moveUp: '上移',
    moveDown: '下移',
    removeStage: '移除层',
    strategyLabel: '选路策略',
    strategySelect: '手动切换 (select)',
    strategyUrlTest: '自动测速 (url-test)',
    strategyFallback: '故障转移 (fallback)',
    probeUrlLabel: '探测 URL',
    probeIntervalLabel: '间隔 (秒)',
    probeToleranceLabel: '容差 (ms)',
    exitAutoStrategyNote: '出口节点使用自动策略时，客户端切换节点可能导致外部出口 IP 变化。',
    searchNodesPlaceholder: '搜索别名 / 协议 / 服务器 / 端口 / 来源…',
    filterAllProtocols: '全部协议',
    filterAllSources: '全部来源',
    selectFilteredBtn: '全选当前结果',
    clearFilteredBtn: '清空当前结果',
    clearStageBtn: '清空本层',
    renameNodePlaceholder: '输入新别名',
    saveAliasBtn: '保存',
    cancelAliasBtn: '取消',
    missingRefBadge: '节点缺失',
    removeBrokenRefBtn: '移除失效引用',
    routingTitle: '分流规则',
    routingPresetLabel: '分流模板',
    routingAllProxy: '全部走代理',
    routingCnDirect: '国内直连，其余走代理',
    routingCustom: '自定义规则',
    addRuleBtn: '添加规则',
    fallbackTargetLabel: '未命中规则默认去向 (MATCH)',
    targetDirect: 'DIRECT（直连）',
    targetReject: 'REJECT（拦截）',
    targetPlanPrefix: '方案出口: ',
    previewTitle: '当前链路',
    previewSubtitle: '结构示意，不含连通性检测',
    localDevice: '本机',
    targetWebsite: '目标网站',
    finalExitBadge: '最终出口',
    emptyCandidates: '尚未选择候选节点',
    outputTitle: '下载配置',
    outputTabMihomo: '完整 Mihomo 配置',
    outputTabSnippet: '配置片段',
    outputTabLinks: '节点链接',
    outputTabBatch: '批量下载',
    outputTabTempLink: '临时导入链接',
    outputTabV2rayn: '客户端使用帮助',
    copyOutputBtn: '复制配置',
    copiedBtn: '已复制',
    downloadOutputBtn: '下载文件',
    exportBlockedTitle: '导出被阻断：请先处理以下错误',
    exportWarningsTitle: '注意事项与兼容性提示',
    dnsDisclosureTitle: '内置基础 DNS 参数说明',
    dnsDisclosureBody:
      '完整配置包含 fake-ip、国内 DNS 和 fallback；如已有自定义 DNS，请按需调整生成配置中的 dns 区块。',
    snippetMergeTitle: '如何合并到现有 Clash / Mihomo 配置',
    snippetMergeBody:
      '本片段仅输出 proxies、proxy-groups 与 rules（不含 mixed-port / dns），且组名与节点名已避让常见冲突；可按区块并入现有 YAML。',
    linksModeNotice:
      '重要：标准 vless:// / socks5:// / hysteria2:// / ss:// 链接不包含 Clash dialer-proxy 链式关系，仅作普通单节点迁移之用。',
    linksSourcePlan: '当前方案启用层内选中的节点',
    linksSourceRegistry: '从节点库任意勾选节点导出',
    tempImportTitle: '临时订阅链接导入 Clash / Mihomo',
    tempImportDisclosure:
      '安全与存储说明：点击下方按钮会将当前导出的完整 YAML（含节点服务器、UUID 与密码）上传至同源 Cloudflare Worker Durable Object (SQLite)，并在 600 秒内对持有该链接的任何人可读；Cloudflare Durable Object SQLite 平台 PITR 备份保留机制可能保留历史数据最长 30 天。若介意云端临时托管，请直接使用本地“复制”或“下载”。',
    tempImportUnavailable: '当前环境未启用同源临时配置存储 (/api/clash-config)，无法生成一键导入链接，请使用复制或下载本地文件。',
    createTempImportBtn: '生成 600 秒临时导入链接',
    creatingTempImportBtn: '正在生成…',
    openClashSchemeBtn: '在 Clash 中一键导入',
    copyTempUrlBtn: '复制临时订阅 URL',
    shadowrocketDisclosure:
      '客户端兼容说明：链式配置以 Mihomo (Clash Meta) 为主导出目标；Shadowrocket 虽支持部分 Clash 字段解析，但本项目尚未在真实 Shadowrocket 设备上完成完整多跳链式导入实测，请在实机自行验证后再作为主力方案。',
    statusReady: '导出就绪',
    statusBlocked: '存在阻塞错误，未生成可导出配置',
    statusIdle: '等待完成节点选择',
    capabilitiesLabel: '环境状态',
    // ---- 三步流程与高级面板 ----
    stepNavAria: '流程步骤',
    stepImportTitle: '导入节点',
    stepChainTitle: '选择链路',
    stepExportTitle: '下载配置',
    nextStepBtn: '下一步',
    prevStepBtn: '上一步',
    downloadConfigBtn: '下载配置',
    nextDisabledEmptyReason: '请先导入节点',
    step2BlockedBanner: '链路尚未完整，请补齐下方必选项后再进入下一步。',
    currentPlanLabel: '当前方案',
    multiHopBadge: '多跳链路',
    customRoutingBadge: '自定义分流',
    relayCountSummary: '%d 层中转',
    exitOnSummary: '出口节点',
    exitOffSummary: '无出口节点',
    advancedSettingsBtn: '高级设置',
    advChainGroup: '链路与分流',
    advPlanGroup: '方案管理',
    advSaveGroup: '本机保存',
    advEnvGroup: '环境状态',
    envFetcherState: '订阅代拉服务',
    envTempState: '临时配置存储',
    uploadFileBtn: '上传文件',
    unifiedInputLabel: '订阅地址或节点内容',
    unifiedInputPlaceholder: '粘贴一个订阅地址、节点链接或 Clash YAML',
    unifiedImportBtn: '导入',
    unifiedImportingBtn: '导入中…',
    unifiedWillFetchNote: '将联网获取订阅内容。',
    unifiedWillFetchViaServiceNote: '将联网获取订阅内容；地址会发送到所选拉取服务。',
    unifiedMixedError: '请单独导入订阅地址或节点内容。',
    unifiedEmptyError: '请输入订阅地址或节点内容。',
    moreWaysBtn: '更多方式',
    moreWaysManual: '手动添加节点',
    moreWaysSubOptions: '订阅拉取选项',
    sourceRowExpand: '展开',
    sourceRowCollapse: '收起',
    sourceActionsLabel: '来源操作',
    importedCountMsg: '已导入 %d 个节点',
    importedCountWithSkippedMsg: '已导入 %d 个节点，%d 项未导入',
    viewDetailsBtn: '查看详情',
    hideDetailsBtn: '收起详情',
    stageSettingsLabel: '层设置',
    strategyShortSelect: '手动切换',
    strategyShortUrlTest: '自动测速',
    strategyShortFallback: '故障转移',
    currentChainTitle: '当前链路',
    currentChainSubtitle: '层名称 · 已选数量 · 最终出口',
    stageSelectedCount: '已选 %d 个',
    stageMissingCount: '%d 项待处理',
    exitOffShortNote: '已关闭出口节点',
    copyConfigBtn: '复制配置',
    viewConfigBtn: '查看配置',
    hideConfigBtn: '收起配置',
    backToEditBtn: '返回修改',
    exportTargetLabel: '导出目标',
    needFixCount: '需要处理 %d 项',
    goToFixBtn: '前往修改',
    warningsCount: '%d 条兼容性提示',
    moreExportsBtn: '更多导出',
    linksNotChainedNote: '节点链接不包含链式关系。',
    saveCredsShortNote: '节点凭据将明文保存在此浏览器。',
    saveStructureShortNote: '仅保存方案结构，恢复后需重新导入节点。',
    goStep2FocusTarget: '链路设置',
  },
  en: {
    title: 'Proxy Editor',
    privacyLocalBadge: 'Parses & exports locally',
    privacyRemoteNote:
      'Parsing and config generation stay in this browser. Network access happens only when fetching a subscription or creating a temporary import link.',
    sourcesTitle: 'Import Nodes',
    sourcesDesc: 'Paste a subscription URL, node links, or Clash YAML — detected automatically.',
    tabSubscription: 'Add Subscription',
    tabPaste: 'Paste Nodes / YAML',
    tabManual: 'Manual Form',
    sourceNameLabel: 'Source Name',
    sourceNamePlaceholder: 'e.g. Daily Subscription / Self-hosted Exit',
    subUrlLabel: 'Subscription URL (HTTPS / HTTP)',
    subUrlPlaceholder: 'https://sub.example.com/clash.yaml',
    fetchModeLabel: 'Fetch Mode',
    fetchModeAuto: 'Auto (prefer same-origin backend, fallback to direct CORS)',
    fetchModeHosted: 'Same-origin Backend (/api/fetch-subscription)',
    fetchModeDirect: 'Browser Direct (requires upstream CORS)',
    fetchModeService: 'External Fetcher Service (URL + Token)',
    fetcherEndpointLabel: 'Fetcher Service Endpoint',
    fetcherTokenLabel: 'Bearer Token (session only)',
    fetcherHintHostedOk: 'Same-origin subscription fetcher detected (/api/fetch-subscription).',
    fetcherHintHostedOff: 'No same-origin backend detected; static hosting requires upstream CORS or an external fetcher service.',
    addSubscriptionBtn: 'Fetch & Add Subscription Source',
    pasteLabel: 'Paste proxy links (vless/socks5/hy2/ss) or Clash YAML proxies',
    pastePlaceholder: 'One link per line, or paste Clash YAML with proxies: …',
    addPasteBtn: 'Parse & Append to Registry',
    addManualBtn: 'Validate & Add Manual Node',
    manualProtocolLabel: 'Protocol',
    manualNameLabel: 'Display Alias',
    manualServerLabel: 'Server (host/IP)',
    manualPortLabel: 'Port',
    manualUuidLabel: 'UUID',
    manualSecurityLabel: 'Security',
    manualTransportLabel: 'Transport',
    manualSniLabel: 'SNI / Servername',
    manualFpLabel: 'Fingerprint (fp)',
    manualPbkLabel: 'Reality Public Key (pbk)',
    manualSidLabel: 'Reality Short ID (sid)',
    manualWsPathLabel: 'WS Path',
    manualWsHostLabel: 'WS Host',
    manualGrpcServiceLabel: 'gRPC Service Name',
    manualUsernameLabel: 'Username (optional)',
    manualPasswordLabel: 'Password',
    manualCipherLabel: 'Cipher',
    manualPluginLabel: 'Plugin (optional)',
    manualPluginOptsLabel: 'Plugin Options (e.g. obfs=tls;obfs-host=example.com)',
    manualHy2ObfsLabel: 'Obfs Type (optional)',
    manualHy2ObfsPasswordLabel: 'Obfs Password',
    manualHy2PortsLabel: 'Port Hopping Range (optional, e.g. 20000-30000)',
    manualUdpLabel: 'Enable UDP relay',
    manualSkipCertLabel: 'Skip cert verification (skip-cert-verify)',
    refreshSource: 'Refresh',
    cancelRefresh: 'Cancel',
    deleteSource: 'Delete Source',
    confirmDelete: 'Confirm Delete',
    cancelDelete: 'Cancel',
    undoDelete: 'Undo Delete',
    deletedNotice: 'Source removed. Undo immediately to restore:',
    sourceStatusLoading: 'Fetching…',
    sourceStatusSuccess: 'OK',
    sourceStatusFailed: 'Failed (previous nodes kept)',
    sourceKeepOldNotice: 'Latest refresh failed; previously parsed nodes remain intact in registry.',
    parseStatsPrefix: 'Parse Stats',
    planWorkspaceTitle: 'Chain & Routing',
    activePlanLabel: 'Active Plan',
    newPlanBtn: 'New Plan',
    renamePlanBtn: 'Rename',
    duplicatePlanBtn: 'Duplicate',
    deletePlanBtn: 'Delete Plan',
    modeLabel: 'Editor Mode',
    modeSimple: 'Simple (Entry → Exit)',
    modeAdvanced: 'Advanced (Entry → Relays → Exit)',
    simpleModeHiddenRelaysNotice: '%d relay stage(s) preserved in storage but excluded from Simple-mode export; switch back to Advanced to restore.',
    persistenceTitle: 'Local Storage & Plan JSON (Explicit Action Only)',
    saveLocalBtn: 'Save Locally',
    restoreLocalBtn: 'Restore Saved',
    clearLocalBtn: 'Clear Local Storage',
    exportPlanJsonBtn: 'Export Plan JSON',
    importPlanJsonBtn: 'Import Plan JSON',
    includeCredsToggle: 'Also store node credentials in browser localStorage (off by default; plaintext risk)',
    includeCredsWarning: 'Enabled: node credentials will be persisted in plaintext in browser localStorage on this device.',
    localDefaultSafeNote: 'Defaults to topology and reference hints only (no UUID/passwords/tokens); re-import node sources after restore.',
    useIndependentExit: 'Use Exit Node',
    stageAddNode: 'Add Node',
    stageImportNodes: 'Import Nodes',
    stageAddAndSelect: 'Add & Select',
    stageImportAndSelect: 'Import & Select',
    stageCloseForm: 'Close node form',
    stageNodesSelected: 'Selected in %s.',
    stageUnsupportedInput: 'Enter a subscription URL, node links, or Clash YAML.',
    stageEmptyNodes: 'No nodes yet. Use Add Node or Import Nodes above.',
    stageAddNextStepHint: 'You can also add nodes in the next step',
    proxyModeLabel: 'Proxy mode',
    entryOnlyMode: 'Entry only',
    chainProxyMode: 'Proxy chain',
    relayOnlyMode: 'Entry + relays',
    relayWithExitMode: 'Relays + exit',
    exitDisabledBanner: 'Exit node off',
    addRelayBtn: 'Add Relay Stage',
    maxLayersBadge: 'Max 5 enabled stages',
    enableStage: 'Enable',
    disableStage: 'Disable',
    moveUp: 'Move Up',
    moveDown: 'Move Down',
    removeStage: 'Remove Stage',
    strategyLabel: 'Selection Strategy',
    strategySelect: 'Manual (select)',
    strategyUrlTest: 'Latency Test (url-test)',
    strategyFallback: 'Fallback (fallback)',
    probeUrlLabel: 'Probe URL',
    probeIntervalLabel: 'Interval (s)',
    probeToleranceLabel: 'Tolerance (ms)',
    exitAutoStrategyNote: 'Using url-test or fallback on final Exit may switch outbound IP automatically.',
    searchNodesPlaceholder: 'Search alias / protocol / server / port / source…',
    filterAllProtocols: 'All Protocols',
    filterAllSources: 'All Sources',
    selectFilteredBtn: 'Select Filtered',
    clearFilteredBtn: 'Clear Filtered',
    clearStageBtn: 'Clear Stage',
    renameNodePlaceholder: 'New alias',
    saveAliasBtn: 'Save',
    cancelAliasBtn: 'Cancel',
    missingRefBadge: 'Missing Node',
    removeBrokenRefBtn: 'Remove Broken Ref',
    routingTitle: 'Routing Rules',
    routingPresetLabel: 'Routing Preset',
    routingAllProxy: 'Proxy all traffic',
    routingCnDirect: 'Direct CN, proxy the rest',
    routingCustom: 'Custom rules',
    addRuleBtn: 'Add Rule',
    fallbackTargetLabel: 'Default Fallback (MATCH)',
    targetDirect: 'DIRECT',
    targetReject: 'REJECT',
    targetPlanPrefix: 'Plan Exit: ',
    previewTitle: 'Current Chain',
    previewSubtitle: 'Structural view, no live connectivity probing',
    localDevice: 'This device',
    targetWebsite: 'Target site',
    finalExitBadge: 'Final Exit',
    emptyCandidates: 'No candidate nodes selected',
    outputTitle: 'Download Config',
    outputTabMihomo: 'Full Mihomo Config',
    outputTabSnippet: 'Config Snippet',
    outputTabLinks: 'Node Links',
    outputTabBatch: 'Batch Download',
    outputTabTempLink: 'Temporary Link',
    outputTabV2rayn: 'Client Guide',
    copyOutputBtn: 'Copy Config',
    copiedBtn: 'Copied',
    downloadOutputBtn: 'Download File',
    exportBlockedTitle: 'Export Blocked: Fix the errors below',
    exportWarningsTitle: 'Warnings & Compatibility Notes',
    dnsDisclosureTitle: 'Bundled Basic DNS Settings',
    dnsDisclosureBody:
      'The full config includes fake-ip, DNS nameservers, and fallback. Adjust the dns section to match any existing custom DNS settings.',
    snippetMergeTitle: 'Merging Clash Snippet Manually',
    snippetMergeBody:
      'Contains only proxies, proxy-groups, and rules with collision-avoided names for safe insertion into an existing Mihomo profile.',
    linksModeNotice:
      'Important: Standard proxy URIs do NOT encode Clash dialer-proxy chaining; exported links represent standalone nodes only.',
    linksSourcePlan: 'Nodes in active plan enabled stages',
    linksSourceRegistry: 'Select individual nodes from registry',
    tempImportTitle: 'Temporary Clash / Mihomo Import Link',
    tempImportDisclosure:
      'Privacy & Storage Disclosure: Generating a link uploads the full exported YAML (including server addresses, UUIDs, and passwords) to the same-origin Cloudflare Worker SQLite Durable Object, readable by anyone with the link for 600s. Cloudflare Durable Object SQLite PITR platform retention may preserve backup history for up to 30 days. Copy or download locally if you prefer zero server upload.',
    tempImportUnavailable: 'Same-origin /api/clash-config backend is unavailable in this environment; copy or download locally instead.',
    createTempImportBtn: 'Create 600s Temporary Import Link',
    creatingTempImportBtn: 'Creating…',
    openClashSchemeBtn: 'Open in Clash',
    copyTempUrlBtn: 'Copy Temp Subscription URL',
    shadowrocketDisclosure:
      'Compatibility Note: Mihomo (Clash Meta) is the primary export target. Shadowrocket chained Clash import is NOT verified on a real device in this release—verify manually before relying on it.',
    statusReady: 'Ready to export',
    statusBlocked: 'Blocked by validation errors',
    statusIdle: 'Awaiting stage selections',
    capabilitiesLabel: 'Environment',
    // ---- Three-step flow & advanced panel ----
    stepNavAria: 'Workflow steps',
    stepImportTitle: 'Import Nodes',
    stepChainTitle: 'Build Chain',
    stepExportTitle: 'Download Config',
    nextStepBtn: 'Next',
    prevStepBtn: 'Back',
    downloadConfigBtn: 'Download Config',
    nextDisabledEmptyReason: 'Import at least one node first',
    step2BlockedBanner: 'The chain is incomplete; finish the required selections below before continuing.',
    currentPlanLabel: 'Current plan',
    multiHopBadge: 'Multi-hop',
    customRoutingBadge: 'Custom routing',
    relayCountSummary: '%d relay stage(s)',
    exitOnSummary: 'Exit node',
    exitOffSummary: 'No exit node',
    advancedSettingsBtn: 'Advanced Settings',
    advChainGroup: 'Chain & Routing',
    advPlanGroup: 'Plans',
    advSaveGroup: 'Local Save',
    advEnvGroup: 'Environment',
    envFetcherState: 'Subscription fetcher',
    envTempState: 'Temporary config storage',
    uploadFileBtn: 'Upload File',
    unifiedInputLabel: 'Subscription URL or node content',
    unifiedInputPlaceholder: 'Paste a subscription URL, node links, or Clash YAML',
    unifiedImportBtn: 'Import',
    unifiedImportingBtn: 'Importing…',
    unifiedWillFetchNote: 'This will fetch the subscription over the network.',
    unifiedWillFetchViaServiceNote:
      'This will fetch the subscription over the network; the URL will be sent to the selected fetcher service.',
    unifiedMixedError: 'Import the subscription URL and node content separately.',
    unifiedEmptyError: 'Enter a subscription URL or node content first.',
    moreWaysBtn: 'More Options',
    moreWaysManual: 'Add Node Manually',
    moreWaysSubOptions: 'Subscription Fetch Options',
    sourceRowExpand: 'Expand',
    sourceRowCollapse: 'Collapse',
    sourceActionsLabel: 'Source actions',
    importedCountMsg: 'Imported %d node(s)',
    importedCountWithSkippedMsg: 'Imported %d node(s), %d item(s) skipped',
    viewDetailsBtn: 'View Details',
    hideDetailsBtn: 'Hide Details',
    stageSettingsLabel: 'Stage settings',
    strategyShortSelect: 'Manual',
    strategyShortUrlTest: 'Auto latency',
    strategyShortFallback: 'Failover',
    currentChainTitle: 'Current Chain',
    currentChainSubtitle: 'Stage names · selected counts · final exit',
    stageSelectedCount: '%d selected',
    stageMissingCount: '%d item(s) to fix',
    exitOffShortNote: 'Exit node off',
    copyConfigBtn: 'Copy Config',
    viewConfigBtn: 'View Config',
    hideConfigBtn: 'Hide Config',
    backToEditBtn: 'Back to Edit',
    exportTargetLabel: 'Export target',
    needFixCount: '%d item(s) need attention',
    goToFixBtn: 'Go Fix',
    warningsCount: '%d compatibility note(s)',
    moreExportsBtn: 'More Exports',
    linksNotChainedNote: 'Node links do not include chain relationships.',
    saveCredsShortNote: 'Node credentials will be stored in plaintext in this browser.',
    saveStructureShortNote: 'Saves structure only; re-import nodes after restoring.',
    goStep2FocusTarget: 'chain settings',
  },
}

export function exportTabToTargetFormat(tab: ExportTabKey): TargetFormat {
  if (tab === 'clash-snippet') {
    return 'clash-snippet'
  }
  if (tab === 'links') {
    return 'import-links'
  }
  return 'clash-mihomo'
}
