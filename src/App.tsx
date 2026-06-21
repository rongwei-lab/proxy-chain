import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Clipboard,
  Download,
  ExternalLink,
  GitBranch,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  SquareArrowDown,
  Trash2,
} from 'lucide-react'
import {
  generateClashYamlForSelections,
  generateImportLinks,
  generateXrayJsonForSelections,
  parseProxyInput,
  type NormalizedProxyNode,
} from './lib'
import './App.css'

type OutputMode = 'clash' | 'xray' | 'links'
type Language = 'zh' | 'en'
type FetchSlot = 'entry' | 'exit'
type FetchState = 'idle' | 'loading' | 'success' | 'failed' | 'unsupported'
type FetchMode = 'auto' | 'hosted' | 'direct' | 'service'
type SameOriginFetcherState = 'checking' | 'available' | 'unavailable'
type ImportState = 'idle' | 'packing' | 'opened' | 'failed'

const outputModes: OutputMode[] = ['clash', 'xray', 'links']

const copyText = {
  zh: {
    appName: '链式代理实验室',
    subtitle: '本地优先的链式代理配置生成器',
    privacyLabel: '隐私状态',
    localOnly: '本地解析',
    noUpload: '不保存',
    inputTitle: '输入',
    inputDescription: '入口和出口分开粘贴；订阅地址需要先拉取成完整配置内容，再从候选里选择节点。',
    entryInputTitle: '入口输入',
    entryInputDescription: '可直接粘贴拉取后的 Mihomo/Clash YAML 配置全文，也可粘贴入口订阅地址后点击拉取订阅。',
    exitInputTitle: '出口输入',
    exitInputDescription: '可直接粘贴 VLESS、SOCKS5、Hysteria2、Shadowsocks/SS、YAML 节点，也可粘贴出口订阅地址后点击拉取订阅。',
    examples: '示例',
    editorLabel: '内容',
    lines: '行',
    clear: '清空',
    fetchSubscription: '拉取订阅',
    fetchingSubscription: '拉取中...',
    fetchSuccess: '订阅内容已加载，已在本地解析。',
    fetchUnsupported: '请输入 http(s) 订阅地址后再拉取。',
    fetchFailed: '订阅拉取失败：可能被跨域策略、网络或订阅服务限制拦截。可以在浏览器打开订阅后复制配置内容粘贴。',
    subscriptionUrlHint: '检测到订阅地址。请点击“拉取订阅”；成功后输入框会替换为完整 Mihomo/Clash 配置内容并自动解析。也可以在浏览器打开订阅后复制完整配置粘贴。',
    fetcherTitle: '订阅拉取服务',
    fetcherDescription: '优先使用同源后端拉取订阅；只有选择外部服务时才需要填写地址和令牌。',
    hostedFetcherAvailable: '同源服务可用',
    hostedFetcherChecking: '正在检测同源服务',
    hostedFetcherUnavailable: '当前页面未检测到同源服务',
    fetcherEndpointLabel: '外部服务地址',
    fetcherEndpointPlaceholder: 'https://fetch.example.com/fetch-subscription',
    fetcherTokenLabel: '外部访问令牌',
    fetcherTokenPlaceholder: '外部服务 token，不会保存',
    fetcherModeDirect: '直连',
    fetcherModeHosted: '同源服务',
    fetcherModeService: '外部服务',
    fetcherModeAuto: '自动',
    fetchFailedHosted: '订阅拉取失败：同源服务不可用或订阅域名未被允许。',
    fetchFailedWithManaged: '订阅拉取失败：同源服务和浏览器直连都未成功。请检查允许域名或订阅链接，也可以切换到外部服务。',
    fetchFailedWithService: '订阅拉取失败：同源服务、浏览器直连和外部服务都未成功。请检查服务地址、令牌、允许域名或订阅链接。',
    parsedPrefix: '已解析',
    parsedSuffix: '个候选',
    chainTitle: '链式代理',
    chainDescription: '链路会按“入口 → 出口”生成；配置字段会自动使用对应客户端的链式写法。',
    entry: '入口',
    exit: '出口',
    selected: '已选',
    selectAll: '全选',
    clearSelection: '清空选择',
    missingEntry: '未找到可用入口节点',
    missingExit: '未找到可用出口节点',
    outputTitle: '输出',
    outputDescription: '生成内容只在当前浏览器会话中存在。',
    importClash: '导入 Clash',
    importingClash: '准备中...',
    importClashOpened: '已唤起 Clash',
    importClashFailed: '导入链接生成失败',
    copy: '复制',
    copied: '已复制',
    failed: '失败',
    download: '下载',
    outputType: '输出类型',
    outputModeClash: 'Clash 配置',
    outputModeXray: 'v2rayN 配置',
    outputModeLinks: '导入链接',
    preview: '预览',
    noOutput: '无输出',
    emptyOutput: '分别填写入口和出口后，这里会生成链式代理配置。',
    yamlStatus: '配置就绪',
    jsonStatus: '链路就绪',
    yamlDetail: '链式字段',
    jsonDetail: '链式字段',
    noUploadDetail: '仅当前会话',
    nodes: '候选',
    chain: '链路',
    selectedSummary: '已选节点',
    waitingChain: '等待选择入口和出口',
    languageLabel: '语言',
    zhLanguage: '中文',
    enLanguage: '英文',
    chainArrow: '→',
  },
  en: {
    appName: 'Proxy Chain Lab',
    subtitle: 'Local-first chained proxy config generator',
    privacyLabel: 'Privacy status',
    localOnly: 'Local parsing',
    noUpload: 'No storage',
    inputTitle: 'Input',
    inputDescription: 'Paste entry and exit separately. Fetch subscription URLs into full config content before selecting nodes.',
    entryInputTitle: 'Entry input',
    entryInputDescription: 'Paste fetched Mihomo/Clash YAML content directly, or paste an entry subscription URL and click Fetch subscription.',
    exitInputTitle: 'Exit input',
    exitInputDescription: 'Paste VLESS, SOCKS5, Hysteria2, Shadowsocks/SS, YAML nodes, or an exit subscription URL and click Fetch subscription.',
    examples: 'Example',
    editorLabel: 'Content',
    lines: 'lines',
    clear: 'Clear',
    fetchSubscription: 'Fetch subscription',
    fetchingSubscription: 'Fetching...',
    fetchSuccess: 'Subscription content loaded and parsed locally.',
    fetchUnsupported: 'Enter an http(s) subscription URL before fetching.',
    fetchFailed: 'Failed to fetch subscription. It may be blocked by CORS, network, or provider policy. Open it in your browser and paste the YAML content instead.',
    subscriptionUrlHint: 'Subscription URL detected. Click “Fetch subscription”; after success the input will be replaced with full Mihomo/Clash config content and parsed automatically. You can also open the URL in your browser and paste the full config here.',
    fetcherTitle: 'Subscription fetcher',
    fetcherDescription: 'The app prefers the same-origin backend. Endpoint and token are shown only when External is selected.',
    hostedFetcherAvailable: 'Same-origin service available',
    hostedFetcherChecking: 'Checking same-origin service',
    hostedFetcherUnavailable: 'No same-origin service detected on this page',
    fetcherEndpointLabel: 'External endpoint',
    fetcherEndpointPlaceholder: 'https://fetch.example.com/fetch-subscription',
    fetcherTokenLabel: 'External token',
    fetcherTokenPlaceholder: 'External service token, not stored',
    fetcherModeDirect: 'Direct',
    fetcherModeHosted: 'Same-origin',
    fetcherModeService: 'External',
    fetcherModeAuto: 'Auto',
    fetchFailedHosted: 'Failed to fetch subscription. The same-origin service is unavailable or the subscription host is not allowed.',
    fetchFailedWithManaged: 'Failed to fetch subscription. Same-origin service and browser direct fetch both failed. Check the allowed host or subscription URL, or switch to External.',
    fetchFailedWithService: 'Failed to fetch subscription. Same-origin service, browser direct fetch, and external service all failed. Check endpoint, token, allowed host, or subscription URL.',
    parsedPrefix: 'Parsed',
    parsedSuffix: 'candidates',
    chainTitle: 'Chain',
    chainDescription: 'The generated chain follows entry → exit and uses each client’s native chaining field.',
    entry: 'Entry',
    exit: 'Exit',
    selected: 'Selected',
    selectAll: 'Select all',
    clearSelection: 'Clear selection',
    missingEntry: 'No supported entry node found',
    missingExit: 'No supported exit node found',
    outputTitle: 'Output',
    outputDescription: 'Generated content stays in this browser session.',
    importClash: 'Import Clash',
    importingClash: 'Preparing...',
    importClashOpened: 'Clash opened',
    importClashFailed: 'Import link failed',
    copy: 'Copy',
    copied: 'Copied',
    failed: 'Failed',
    download: 'Download',
    outputType: 'Output type',
    outputModeClash: 'Clash Verge config',
    outputModeXray: 'v2rayN JSON config',
    outputModeLinks: 'Import links',
    preview: 'Preview',
    noOutput: 'No output',
    emptyOutput: 'Fill entry and exit inputs to generate chained proxy config.',
    yamlStatus: 'YAML OK',
    jsonStatus: 'JSON OK',
    yamlDetail: 'chain field',
    jsonDetail: 'chain field',
    noUploadDetail: 'session only',
    nodes: 'Candidates',
    chain: 'Chain',
    selectedSummary: 'Selected nodes',
    waitingChain: 'Waiting for entry and exit',
    languageLabel: 'Language',
    zhLanguage: 'Chinese',
    enLanguage: 'English',
    chainArrow: '→',
  },
} satisfies Record<Language, Record<string, string>>

const entryExample = [
  'vless://11111111-1111-4111-8111-111111111111@203.0.113.10:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.example.com&fp=chrome&pbk=********&type=tcp&headerType=none#入口-VLESS',
  'socks5://demo:********@203.0.113.20:1080#入口-SOCKS5',
  'hysteria2://demo-pass@203.0.113.30:8443?sni=www.example.com&insecure=1#入口-HY2',
  'ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpkZW1vLXBhc3M@203.0.113.40:8388#入口-SS',
].join('\n')

const exitExample = [
  'socks5://demo:********@198.51.100.14:1193#出口-SOCKS5',
  'hysteria2://demo-pass@198.51.100.24:8443?sni=www.example.com&insecure=1#出口-HY2',
  'vless://22222222-2222-4222-8222-222222222222@198.51.100.34:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.example.org&fp=chrome&pbk=********&type=tcp&headerType=none#出口-VLESS',
  'ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpkZW1vLXBhc3M@198.51.100.44:8388#出口-SS',
].join('\n')

function App() {
  const [language, setLanguage] = useState<Language>('zh')
  const [outputMode, setOutputMode] = useState<OutputMode>('clash')
  const [fetchMode, setFetchMode] = useState<FetchMode>('auto')
  const [sameOriginFetcherState, setSameOriginFetcherState] = useState<SameOriginFetcherState>('checking')
  const [fetcherEndpoint, setFetcherEndpoint] = useState('')
  const [fetcherToken, setFetcherToken] = useState('')
  const [entryInput, setEntryInput] = useState('')
  const [exitInput, setExitInput] = useState('')
  const [entryIds, setEntryIds] = useState<string[] | undefined>()
  const [exitIds, setExitIds] = useState<string[] | undefined>()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [importState, setImportState] = useState<ImportState>('idle')
  const [fetchState, setFetchState] = useState<Record<FetchSlot, FetchState>>({
    entry: 'idle',
    exit: 'idle',
  })
  const t = copyText[language]
  const outputModeLabels: Record<OutputMode, string> = {
    clash: t.outputModeClash,
    xray: t.outputModeXray,
    links: t.outputModeLinks,
  }
  const sameOriginFetcherAvailable = sameOriginFetcherState === 'available'
  const showExternalFetcherFields = fetchMode === 'service'
  const hostedFetcherStatusLabel =
    sameOriginFetcherState === 'available'
      ? t.hostedFetcherAvailable
      : sameOriginFetcherState === 'checking'
        ? t.hostedFetcherChecking
        : t.hostedFetcherUnavailable

  const entryParsed = useMemo(() => parseProxyInput(entryInput), [entryInput])
  const exitParsed = useMemo(() => parseProxyInput(exitInput), [exitInput])
  const entryCandidates = entryParsed.nodes
  const exitCandidates = exitParsed.nodes

  const selectedEntryIds = useMemo(() => resolveSelectedIds(entryIds, entryCandidates), [entryIds, entryCandidates])
  const selectedExitIds = useMemo(() => resolveSelectedIds(exitIds, exitCandidates), [exitIds, exitCandidates])
  const selectedEntries = useMemo(
    () => pickSelectedNodes(entryCandidates, selectedEntryIds),
    [entryCandidates, selectedEntryIds],
  )
  const selectedExits = useMemo(
    () => pickSelectedNodes(exitCandidates, selectedExitIds),
    [exitCandidates, selectedExitIds],
  )
  const selectedNodes = useMemo(() => [...selectedEntries, ...selectedExits], [selectedEntries, selectedExits])

  const generated = useMemo(() => {
    if (outputMode === 'links') {
      return selectedNodes.length > 0 ? generateImportLinks(selectedNodes) : ''
    }
    if (selectedEntries.length === 0 || selectedExits.length === 0) {
      return ''
    }
    return outputMode === 'clash'
      ? generateClashYamlForSelections(selectedEntries, selectedExits)
      : generateXrayJsonForSelections(selectedEntries, selectedExits)
  }, [outputMode, selectedEntries, selectedExits, selectedNodes])

  const outputFileName =
    outputMode === 'clash' ? 'config.yaml' : outputMode === 'xray' ? 'config.json' : 'import-links.txt'
  const chainLabel = buildChainLabel(selectedEntries, selectedExits, t)
  const entryIsSubscriptionUrl = isHttpSubscriptionInput(entryInput)
  const exitIsSubscriptionUrl = isHttpSubscriptionInput(exitInput)
  const fetchFailedMessage =
    fetchMode === 'hosted'
      ? t.fetchFailedHosted
      : fetchMode === 'auto'
        ? t.fetchFailedWithManaged
        : fetchMode === 'service'
          ? t.fetchFailedWithService
          : t.fetchFailed

  useEffect(() => {
    let cancelled = false

    async function detectSameOriginFetcher() {
      try {
        const response = await fetch('/api/healthz', { cache: 'no-store' })
        if (!cancelled) {
          setSameOriginFetcherState(response.ok ? 'available' : 'unavailable')
        }
      } catch {
        if (!cancelled) {
          setSameOriginFetcherState('unavailable')
        }
      }
    }

    // 只探测健康检查，不携带订阅地址；这样 GitHub Pages 模式也不会把用户输入泄露给不存在的 API。
    void detectSameOriginFetcher()

    return () => {
      cancelled = true
    }
  }, [])

  function setInputValue(slot: FetchSlot, value: string) {
    if (slot === 'entry') {
      setEntryInput(value)
      setEntryIds(undefined)
    } else {
      setExitInput(value)
      setExitIds(undefined)
    }
    setFetchState((current) => ({ ...current, [slot]: 'idle' }))
  }

  function loadExample(slot: FetchSlot) {
    setInputValue(slot, slot === 'entry' ? entryExample : exitExample)
  }

  async function fetchSubscription(slot: FetchSlot) {
    const source = (slot === 'entry' ? entryInput : exitInput).trim()

    if (!/^https?:\/\//i.test(source)) {
      setFetchState((current) => ({ ...current, [slot]: 'unsupported' }))
      return
    }

    setFetchState((current) => ({ ...current, [slot]: 'loading' }))
    try {
      const content = await loadSubscriptionContent(source, {
        endpoint: fetcherEndpoint.trim(),
        sameOriginAvailable: sameOriginFetcherAvailable,
        token: fetcherToken.trim(),
        mode: fetchMode,
      })
      setInputValue(slot, content)
      setFetchState((current) => ({ ...current, [slot]: 'success' }))
    } catch {
      setFetchState((current) => ({ ...current, [slot]: 'failed' }))
    }
  }

  async function copyOutput() {
    if (!generated) {
      return
    }
    try {
      await navigator.clipboard.writeText(generated)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    } finally {
      window.setTimeout(() => setCopyState('idle'), 1600)
    }
  }

  async function importClashOutput() {
    if (!generated || outputMode !== 'clash') {
      return
    }

    setImportState('packing')
    try {
      const importUrl = await buildClashImportUrl(generated)
      window.location.href = importUrl
      setImportState('opened')
    } catch {
      setImportState('failed')
    } finally {
      window.setTimeout(() => setImportState('idle'), 2200)
    }
  }

  function downloadOutput() {
    if (!generated) {
      return
    }
    const blob = new Blob([generated], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = outputFileName
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1>{t.appName}</h1>
            <p>{t.subtitle}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="language-toggle" role="group" aria-label={t.languageLabel}>
            <button
              type="button"
              className={language === 'zh' ? 'active' : ''}
              onClick={() => setLanguage('zh')}
            >
              {t.zhLanguage}
            </button>
            <button
              type="button"
              className={language === 'en' ? 'active' : ''}
              onClick={() => setLanguage('en')}
            >
              {t.enLanguage}
            </button>
          </div>
          <div className="privacy-strip" aria-label={t.privacyLabel}>
            <span>
              <LockKeyhole size={15} />
              {t.localOnly}
            </span>
            <span>
              <CheckCircle2 size={15} />
              {t.noUpload}
            </span>
          </div>
        </div>
      </header>

      <section className="workspace">
        <section className="panel input-panel" aria-labelledby="input-title">
          <div className="panel-heading">
            <div>
              <h2 id="input-title">{t.inputTitle}</h2>
              <p>{t.inputDescription}</p>
            </div>
          </div>

          <section className="fetcher-card" aria-label={t.fetcherTitle}>
            <div className="fetcher-heading">
              <div>
                <h3>{t.fetcherTitle}</h3>
                <p>{t.fetcherDescription}</p>
              </div>
              <span className={`fetcher-status ${sameOriginFetcherState}`}>
                <CheckCircle2 size={15} />
                {hostedFetcherStatusLabel}
              </span>
            </div>
            <div className={`fetcher-controls ${showExternalFetcherFields ? 'with-external' : 'managed-only'}`}>
              <div className="segmented-control fetcher-mode" role="tablist" aria-label={t.fetcherTitle}>
                {[
                  { value: 'auto', label: t.fetcherModeAuto },
                  { value: 'hosted', label: t.fetcherModeHosted },
                  { value: 'direct', label: t.fetcherModeDirect },
                  { value: 'service', label: t.fetcherModeService },
                ].map((mode) => (
                  <button
                    key={mode.value}
                    className={fetchMode === mode.value ? 'active' : ''}
                    type="button"
                    onClick={() => setFetchMode(mode.value as FetchMode)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              {showExternalFetcherFields && (
                <>
                  <label>
                    <span>{t.fetcherEndpointLabel}</span>
                    <input
                      value={fetcherEndpoint}
                      placeholder={t.fetcherEndpointPlaceholder}
                      spellCheck={false}
                      onChange={(event) => setFetcherEndpoint(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>{t.fetcherTokenLabel}</span>
                    <input
                      value={fetcherToken}
                      placeholder={t.fetcherTokenPlaceholder}
                      spellCheck={false}
                      type="password"
                      onChange={(event) => setFetcherToken(event.target.value)}
                    />
                  </label>
                </>
              )}
            </div>
          </section>

          <div className="dual-input-grid">
            <ProxyInputCard
              id="entry-input"
              title={t.entryInputTitle}
              description={t.entryInputDescription}
              value={entryInput}
              lineLabel={t.lines}
              editorLabel={t.editorLabel}
              exampleLabel={t.examples}
              clearLabel={t.clear}
              fetchLabel={t.fetchSubscription}
              fetchingLabel={t.fetchingSubscription}
              parsedPrefix={t.parsedPrefix}
              parsedSuffix={t.parsedSuffix}
              parsedCount={entryCandidates.length}
              fetchState={fetchState.entry}
              fetchMessages={t}
              fetchFailedMessage={fetchFailedMessage}
              subscriptionHint={
                entryIsSubscriptionUrl && fetchState.entry !== 'loading' && fetchState.entry !== 'success'
                  ? t.subscriptionUrlHint
                  : undefined
              }
              warnings={entryInput.trim() && !entryIsSubscriptionUrl ? entryParsed.warnings : []}
              onChange={(value) => setInputValue('entry', value)}
              onExample={() => loadExample('entry')}
              onClear={() => setInputValue('entry', '')}
              onFetch={() => fetchSubscription('entry')}
            />

            <ProxyInputCard
              id="exit-input"
              title={t.exitInputTitle}
              description={t.exitInputDescription}
              value={exitInput}
              lineLabel={t.lines}
              editorLabel={t.editorLabel}
              exampleLabel={t.examples}
              clearLabel={t.clear}
              fetchLabel={t.fetchSubscription}
              fetchingLabel={t.fetchingSubscription}
              parsedPrefix={t.parsedPrefix}
              parsedSuffix={t.parsedSuffix}
              parsedCount={exitCandidates.length}
              fetchState={fetchState.exit}
              fetchMessages={t}
              fetchFailedMessage={fetchFailedMessage}
              subscriptionHint={
                exitIsSubscriptionUrl && fetchState.exit !== 'loading' && fetchState.exit !== 'success'
                  ? t.subscriptionUrlHint
                  : undefined
              }
              warnings={exitInput.trim() && !exitIsSubscriptionUrl ? exitParsed.warnings : []}
              onChange={(value) => setInputValue('exit', value)}
              onExample={() => loadExample('exit')}
              onClear={() => setInputValue('exit', '')}
              onFetch={() => fetchSubscription('exit')}
            />
          </div>

          <div className="chain-card">
            <div className="chain-title">
              <GitBranch size={19} />
              <div>
                <h3>{t.chainTitle}</h3>
                <p>{t.chainDescription}</p>
              </div>
            </div>
            <div className="chain-grid">
              <NodeMultiSelect
                label={t.entry}
                nodes={entryCandidates}
                selectedIds={selectedEntryIds}
                emptyText={t.missingEntry}
                selectedLabel={t.selected}
                selectAllLabel={t.selectAll}
                clearSelectionLabel={t.clearSelection}
                onChange={(ids) => setEntryIds(ids)}
              />
              <div className="chain-arrow">{t.chainArrow}</div>
              <NodeMultiSelect
                label={t.exit}
                nodes={exitCandidates}
                selectedIds={selectedExitIds}
                emptyText={t.missingExit}
                selectedLabel={t.selected}
                selectAllLabel={t.selectAll}
                clearSelectionLabel={t.clearSelection}
                onChange={(ids) => setExitIds(ids)}
              />
            </div>
          </div>
        </section>

        <section className="panel output-panel" aria-labelledby="output-title">
          <div className="panel-heading output-heading">
            <div>
              <h2 id="output-title">{t.outputTitle}</h2>
              <p>{t.outputDescription}</p>
            </div>
            <div className="button-row">
              <button
                className="accent-button"
                type="button"
                disabled={!sameOriginFetcherAvailable || !generated || outputMode !== 'clash' || importState === 'packing'}
                onClick={importClashOutput}
              >
                <ExternalLink size={16} />
                {importState === 'packing'
                  ? t.importingClash
                  : importState === 'opened'
                    ? t.importClashOpened
                    : importState === 'failed'
                      ? t.importClashFailed
                      : t.importClash}
              </button>
              <button className="ghost-button" type="button" disabled={!generated} onClick={copyOutput}>
                <Clipboard size={16} />
                {copyState === 'copied' ? t.copied : copyState === 'failed' ? t.failed : t.copy}
              </button>
              <button className="primary-button" type="button" disabled={!generated} onClick={downloadOutput}>
                <Download size={16} />
                {t.download}
              </button>
            </div>
          </div>

          <div className="segmented-control output-tabs" role="tablist" aria-label={t.outputType}>
            {outputModes.map((mode) => (
              <button
                key={mode}
                className={outputMode === mode ? 'active' : ''}
                type="button"
                onClick={() => setOutputMode(mode)}
              >
                {outputModeLabels[mode]}
              </button>
            ))}
          </div>

          <div className="preview-meta">
            <span>
              {t.preview}: {outputFileName}
            </span>
            <span>{generated ? `${generated.split(/\r?\n/).length} ${t.lines}` : t.noOutput}</span>
          </div>
          <pre className="code-preview">
            <code>{generated || t.emptyOutput}</code>
          </pre>
        </section>
      </section>

      <footer className="status-bar">
        <StatusChip ok={generated.includes('dialer-proxy') || outputMode !== 'clash'} label={t.yamlStatus} detail={t.yamlDetail} />
        <StatusChip ok={isValidJsonOutput(outputMode, generated)} label={t.jsonStatus} detail={t.jsonDetail} />
        <StatusChip ok label={t.noUpload} detail={t.noUploadDetail} />
        <div className="status-summary">
          <span>
            {t.nodes}: {entryCandidates.length + exitCandidates.length}
          </span>
          <span>
            {t.selectedSummary}: {selectedNodes.length}
          </span>
          <span>
            {t.chain}: {chainLabel}
          </span>
        </div>
      </footer>
    </main>
  )
}

interface ProxyInputCardProps {
  id: string
  title: string
  description: string
  value: string
  lineLabel: string
  editorLabel: string
  exampleLabel: string
  clearLabel: string
  fetchLabel: string
  fetchingLabel: string
  parsedPrefix: string
  parsedSuffix: string
  parsedCount: number
  fetchState: FetchState
  fetchMessages: Record<string, string>
  fetchFailedMessage: string
  subscriptionHint?: string
  warnings: string[]
  onChange: (value: string) => void
  onExample: () => void
  onClear: () => void
  onFetch: () => void
}

function ProxyInputCard({
  id,
  title,
  description,
  value,
  lineLabel,
  editorLabel,
  exampleLabel,
  clearLabel,
  fetchLabel,
  fetchingLabel,
  parsedPrefix,
  parsedSuffix,
  parsedCount,
  fetchState,
  fetchMessages,
  fetchFailedMessage,
  subscriptionHint,
  warnings,
  onChange,
  onExample,
  onClear,
  onFetch,
}: ProxyInputCardProps) {
  return (
    <section className="input-card" aria-labelledby={`${id}-title`}>
      <div className="input-card-heading">
        <div>
          <h3 id={`${id}-title`}>{title}</h3>
          <p>{description}</p>
        </div>
        <button className="ghost-button compact" type="button" onClick={onExample}>
          <RotateCcw size={15} />
          {exampleLabel}
        </button>
      </div>

      <label className="editor-label" htmlFor={id}>
        {editorLabel}
        <span>
          {value.split(/\r?\n/).filter(Boolean).length} {lineLabel}
        </span>
      </label>
      <textarea
        id={id}
        className="input-editor split-editor"
        value={value}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />

      <div className="input-actions">
        <div className="input-button-row">
          <button className="ghost-button compact" type="button" onClick={onClear}>
            <Trash2 size={15} />
            {clearLabel}
          </button>
          <button
            className="ghost-button compact"
            type="button"
            disabled={fetchState === 'loading'}
            onClick={onFetch}
          >
            <SquareArrowDown size={15} />
            {fetchState === 'loading' ? fetchingLabel : fetchLabel}
          </button>
        </div>
        <div className="node-count">
          {parsedPrefix} <strong>{parsedCount}</strong> {parsedSuffix}
        </div>
      </div>

      {subscriptionHint && <div className="subscription-hint">{subscriptionHint}</div>}
      {warnings.length > 0 && (
        <div className="warnings">
          {warnings.slice(0, 2).map((warning) => (
            <span key={`${id}-${warning}`}>{warning}</span>
          ))}
        </div>
      )}
      {fetchState !== 'idle' && fetchState !== 'loading' && (
        <div className={`fetch-message ${fetchState}`}>
          {fetchState === 'success'
            ? fetchMessages.fetchSuccess
            : fetchState === 'unsupported'
              ? fetchMessages.fetchUnsupported
              : fetchFailedMessage}
        </div>
      )}
    </section>
  )
}

interface NodeMultiSelectProps {
  label: string
  nodes: NormalizedProxyNode[]
  selectedIds: string[]
  emptyText: string
  selectedLabel: string
  selectAllLabel: string
  clearSelectionLabel: string
  onChange: (value: string[]) => void
}

function NodeMultiSelect({
  label,
  nodes,
  selectedIds,
  emptyText,
  selectedLabel,
  selectAllLabel,
  clearSelectionLabel,
  onChange,
}: NodeMultiSelectProps) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedCount = nodes.filter((node) => selectedSet.has(node.id)).length

  function toggleNode(nodeId: string, checked: boolean) {
    if (checked) {
      onChange([...selectedIds, nodeId].filter((id, index, ids) => ids.indexOf(id) === index))
      return
    }
    onChange(selectedIds.filter((id) => id !== nodeId))
  }

  return (
    <section className="node-select" aria-label={label}>
      <div className="node-select-header">
        <span>{label}</span>
        <span>
          {selectedLabel} {selectedCount}/{nodes.length}
        </span>
      </div>
      <div className="node-select-actions">
        <button
          className="ghost-button compact"
          type="button"
          disabled={nodes.length === 0 || selectedCount === nodes.length}
          onClick={() => onChange(nodes.map((node) => node.id))}
        >
          <CheckCircle2 size={15} />
          {selectAllLabel}
        </button>
        <button
          className="ghost-button compact"
          type="button"
          disabled={selectedCount === 0}
          onClick={() => onChange([])}
        >
          <Trash2 size={15} />
          {clearSelectionLabel}
        </button>
      </div>
      <div className="node-list" role="group" aria-label={label}>
        {nodes.length === 0 ? (
          <div className="node-list-empty">{emptyText}</div>
        ) : (
          nodes.map((node) => {
            const checked = selectedSet.has(node.id)

            return (
              <label className={`node-option ${checked ? 'selected' : ''}`} key={node.id}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => toggleNode(node.id, event.target.checked)}
                />
                <span>
                  {node.name} · {node.type.toUpperCase()}
                </span>
              </label>
            )
          })
        )}
      </div>
    </section>
  )
}

function StatusChip({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className={`status-chip ${ok ? 'ok' : 'pending'}`}>
      <CheckCircle2 size={19} />
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
    </div>
  )
}

function resolveSelectedIds(selectedIds: string[] | undefined, nodes: NormalizedProxyNode[]) {
  if (selectedIds === undefined) {
    return nodes[0] ? [nodes[0].id] : []
  }

  const availableIds = new Set(nodes.map((node) => node.id))
  return selectedIds.filter((id) => availableIds.has(id))
}

function pickSelectedNodes(nodes: NormalizedProxyNode[], selectedIds: string[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return selectedIds.map((id) => byId.get(id)).filter((node): node is NormalizedProxyNode => Boolean(node))
}

function buildChainLabel(
  selectedEntries: NormalizedProxyNode[],
  selectedExits: NormalizedProxyNode[],
  t: Record<string, string>,
) {
  if (selectedEntries.length === 0 || selectedExits.length === 0) {
    return t.waitingChain
  }

  const entryLabel =
    selectedEntries.length === 1 ? selectedEntries[0].name : `${selectedEntries.length} ${t.entry}`
  const exitLabel = selectedExits.length === 1 ? selectedExits[0].name : `${selectedExits.length} ${t.exit}`
  return `${entryLabel} ${t.chainArrow} ${exitLabel}`
}

function isHttpSubscriptionInput(value: string) {
  const text = value.trim()

  // 这里仅识别“输入框里只有一个 http(s) 地址”的场景。
  // 如果用户粘贴的是完整 YAML，里面可能包含 URL 字段，不能误判为订阅地址。
  return /^https?:\/\/\S+$/i.test(text)
}

async function loadSubscriptionContent(
  sourceUrl: string,
  options: { endpoint: string; sameOriginAvailable: boolean; token: string; mode: FetchMode },
) {
  if (options.mode === 'hosted') {
    return fetchSameOriginSubscription(sourceUrl)
  }

  if (options.mode === 'service') {
    return fetchViaSubscriptionService(sourceUrl, options)
  }

  if (options.mode === 'direct') {
    return fetchDirectSubscription(sourceUrl)
  }

  if (options.sameOriginAvailable) {
    try {
      return await fetchSameOriginSubscription(sourceUrl)
    } catch {
      // 同源 Worker 可用但拉取失败时，继续尝试浏览器直连，给临时故障留一条退路。
    }
  }

  return fetchDirectSubscription(sourceUrl)
}

async function fetchDirectSubscription(sourceUrl: string) {
  // 订阅拉取只在用户点击后发生；不会自动请求，也不会经过后端保存或转发。
  const response = await fetch(sourceUrl, { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.text()
}

async function fetchSameOriginSubscription(sourceUrl: string) {
  // Cloudflare Worker 托管模式下，真实订阅拉取发生在同源 /api 后端；
  // 浏览器不需要携带 Worker 地址或 token，自然也不会把这些凭据暴露给用户。
  const response = await fetch('/api/fetch-subscription', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url: sourceUrl }),
  })

  if (!response.ok) {
    throw new Error(`same-origin fetcher HTTP ${response.status}`)
  }

  return readFetcherContent(response)
}

async function buildClashImportUrl(configYaml: string) {
  const configUrl = await createTemporaryClashConfigUrl(configYaml)
  return `clash://install-config?url=${encodeURIComponent(configUrl)}`
}

async function createTemporaryClashConfigUrl(configYaml: string) {
  const response = await fetch('/api/clash-config', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ content: configYaml }),
  })

  if (!response.ok) {
    throw new Error(`temporary config HTTP ${response.status}`)
  }

  const payload = await response.json() as { url?: unknown }
  if (typeof payload.url !== 'string') {
    throw new Error('temporary config URL missing')
  }
  return new URL(payload.url, window.location.origin).toString()
}

async function fetchViaSubscriptionService(
  sourceUrl: string,
  options: { endpoint: string; token: string },
) {
  if (!options.endpoint || !options.token) {
    throw new Error('subscription fetcher endpoint and token are required')
  }

  const response = await fetch(options.endpoint, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      authorization: `Bearer ${options.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url: sourceUrl }),
  })

  if (!response.ok) {
    throw new Error(`fetcher HTTP ${response.status}`)
  }

  return readFetcherContent(response)
}

async function readFetcherContent(response: Response) {
  const payload = await response.json() as { content?: unknown }
  if (typeof payload.content !== 'string') {
    throw new Error('fetcher response missing content')
  }
  return payload.content
}

function isValidJsonOutput(outputMode: OutputMode, generated: string) {
  if (outputMode !== 'xray') {
    return true
  }
  try {
    const parsed = JSON.parse(generated) as { outbounds?: Array<{ proxySettings?: unknown }> }
    return Boolean(parsed.outbounds?.some((outbound) => outbound.proxySettings))
  } catch {
    return false
  }
}

export default App
