import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  Clipboard,
  Download,
  GitBranch,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  SquareArrowDown,
  Trash2,
} from 'lucide-react'
import {
  generateClashYaml,
  generateImportLinks,
  generateXrayJson,
  parseProxyInput,
  type NormalizedProxyNode,
} from './lib'
import './App.css'

type OutputMode = 'clash' | 'xray' | 'links'
type Language = 'zh' | 'en'
type FetchSlot = 'entry' | 'exit'
type FetchState = 'idle' | 'loading' | 'success' | 'failed' | 'unsupported'

const outputModes: Array<{ id: OutputMode; label: string }> = [
  { id: 'clash', label: 'Clash Verge' },
  { id: 'xray', label: 'v2rayN JSON' },
  { id: 'links', label: 'Import links' },
]

const copyText = {
  zh: {
    subtitle: '本地优先的链式代理配置生成器',
    privacyLabel: '隐私状态',
    inputTitle: '输入',
    inputDescription: '入口和出口分开粘贴，避免订阅节点与出口节点混在一起。',
    entryInputTitle: '入口输入',
    entryInputDescription: '粘贴 VLESS Reality 链接、入口订阅 URL，或 Mihomo/Clash 订阅 YAML。',
    exitInputTitle: '出口输入',
    exitInputDescription: '粘贴 SOCKS5 链接、Hysteria2 节点片段，或包含出口节点的 YAML。',
    examples: '示例',
    editorLabel: '内容',
    lines: '行',
    clear: '清空',
    fetchSubscription: '拉取订阅',
    fetchingSubscription: '拉取中...',
    fetchSuccess: '订阅内容已加载，已在本地解析。',
    fetchUnsupported: '请输入 http(s) 订阅地址后再拉取。',
    fetchFailed: '订阅拉取失败：可能被 CORS、网络或订阅服务限制拦截。可以在浏览器打开订阅后复制 YAML 内容粘贴。',
    parsedPrefix: '已解析',
    parsedSuffix: '个候选',
    chainTitle: '链式代理',
    chainDescription: '链路会按“入口 -> 出口”生成；Clash 使用 dialer-proxy，v2rayN/Xray 使用 proxySettings。',
    entry: '入口',
    exit: '出口',
    missingEntry: '未找到 VLESS 入口',
    missingExit: '未找到 SOCKS5/HY2 出口',
    outputTitle: '输出',
    outputDescription: '生成内容只在当前浏览器会话中存在。',
    copy: '复制',
    copied: '已复制',
    failed: '失败',
    download: '下载',
    outputType: '输出类型',
    preview: '预览',
    noOutput: '无输出',
    emptyOutput: '分别填写入口和出口后，这里会生成链式代理配置。',
    yamlDetail: 'dialer-proxy',
    jsonDetail: 'proxySettings',
    noUploadDetail: '浏览器本地',
    nodes: '候选',
    chain: '链路',
    waitingChain: '等待选择入口和出口',
    languageLabel: '语言',
  },
  en: {
    subtitle: 'Local-first chained proxy config generator',
    privacyLabel: 'Privacy status',
    inputTitle: 'Input',
    inputDescription: 'Paste entry and exit separately so subscription nodes never mix with exit nodes.',
    entryInputTitle: 'Entry input',
    entryInputDescription: 'Paste a VLESS Reality link, entry subscription URL, or Mihomo/Clash subscription YAML.',
    exitInputTitle: 'Exit input',
    exitInputDescription: 'Paste a SOCKS5 link, Hysteria2 snippet, or YAML containing exit nodes.',
    examples: 'Example',
    editorLabel: 'Content',
    lines: 'lines',
    clear: 'Clear',
    fetchSubscription: 'Fetch subscription',
    fetchingSubscription: 'Fetching...',
    fetchSuccess: 'Subscription content loaded and parsed locally.',
    fetchUnsupported: 'Enter an http(s) subscription URL before fetching.',
    fetchFailed: 'Failed to fetch subscription. It may be blocked by CORS, network, or provider policy. Open it in your browser and paste the YAML content instead.',
    parsedPrefix: 'Parsed',
    parsedSuffix: 'candidates',
    chainTitle: 'Chain',
    chainDescription: 'The generated chain follows entry -> exit. Clash uses dialer-proxy; v2rayN/Xray uses proxySettings.',
    entry: 'Entry',
    exit: 'Exit',
    missingEntry: 'No VLESS entry found',
    missingExit: 'No SOCKS5/HY2 exit found',
    outputTitle: 'Output',
    outputDescription: 'Generated content stays in this browser session.',
    copy: 'Copy',
    copied: 'Copied',
    failed: 'Failed',
    download: 'Download',
    outputType: 'Output type',
    preview: 'Preview',
    noOutput: 'No output',
    emptyOutput: 'Fill entry and exit inputs to generate chained proxy config.',
    yamlDetail: 'dialer-proxy',
    jsonDetail: 'proxySettings',
    noUploadDetail: 'browser local',
    nodes: 'Candidates',
    chain: 'Chain',
    waitingChain: 'Waiting for entry and exit',
    languageLabel: 'Language',
  },
} satisfies Record<Language, Record<string, string>>

const entryExample =
  'vless://11111111-1111-4111-8111-111111111111@203.0.113.10:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.example.com&fp=chrome&pbk=********&type=tcp&headerType=none#入口-VLESS'

const exitExample = 'socks5://demo:********@198.51.100.14:1193#出口-SOCKS5'

function App() {
  const [language, setLanguage] = useState<Language>('zh')
  const [outputMode, setOutputMode] = useState<OutputMode>('clash')
  const [entryInput, setEntryInput] = useState(entryExample)
  const [exitInput, setExitInput] = useState(exitExample)
  const [entryId, setEntryId] = useState('')
  const [exitId, setExitId] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [fetchState, setFetchState] = useState<Record<FetchSlot, FetchState>>({
    entry: 'idle',
    exit: 'idle',
  })
  const t = copyText[language]

  const entryParsed = useMemo(() => parseProxyInput(entryInput), [entryInput])
  const exitParsed = useMemo(() => parseProxyInput(exitInput), [exitInput])
  const entryCandidates = useMemo(
    () => entryParsed.nodes.filter((node) => node.type === 'vless'),
    [entryParsed.nodes],
  )
  const exitCandidates = useMemo(
    () => exitParsed.nodes.filter((node) => node.type === 'socks5' || node.type === 'hysteria2'),
    [exitParsed.nodes],
  )
  const allNodes = useMemo(
    () => [...entryParsed.nodes, ...exitParsed.nodes],
    [entryParsed.nodes, exitParsed.nodes],
  )

  const selectedEntry = useMemo(
    () => pickNode(entryCandidates, entryId),
    [entryCandidates, entryId],
  )
  const selectedExit = useMemo(
    () => pickNode(exitCandidates, exitId),
    [exitCandidates, exitId],
  )

  const generated = useMemo(() => {
    if (outputMode === 'links') {
      return allNodes.length > 0 ? generateImportLinks(allNodes) : ''
    }
    if (!selectedEntry || !selectedExit) {
      return ''
    }
    return outputMode === 'clash'
      ? generateClashYaml(selectedEntry, selectedExit)
      : generateXrayJson(selectedEntry, selectedExit)
  }, [allNodes, outputMode, selectedEntry, selectedExit])

  const outputFileName =
    outputMode === 'clash' ? 'config.yaml' : outputMode === 'xray' ? 'config.json' : 'import-links.txt'
  const chainLabel =
    selectedEntry && selectedExit ? `${selectedEntry.name} -> ${selectedExit.name}` : t.waitingChain

  function setInputValue(slot: FetchSlot, value: string) {
    if (slot === 'entry') {
      setEntryInput(value)
      setEntryId('')
    } else {
      setExitInput(value)
      setExitId('')
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
      // 订阅拉取只在用户点击后发生；不会自动请求，也不会经过后端保存或转发。
      const response = await fetch(source, { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      setInputValue(slot, await response.text())
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
            <h1>Proxy Chain Lab</h1>
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
          <div className="privacy-strip" aria-label={t.privacyLabel}>
            <span>
              <LockKeyhole size={15} />
              Local only
            </span>
            <span>
              <CheckCircle2 size={15} />
              No upload
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
              warnings={entryInput.trim() ? entryParsed.warnings : []}
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
              warnings={exitInput.trim() ? exitParsed.warnings : []}
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
              <NodeSelect
                label={t.entry}
                nodes={entryCandidates}
                value={selectedEntry?.id ?? ''}
                emptyText={t.missingEntry}
                onChange={setEntryId}
              />
              <div className="chain-arrow">{'->'}</div>
              <NodeSelect
                label={t.exit}
                nodes={exitCandidates}
                value={selectedExit?.id ?? ''}
                emptyText={t.missingExit}
                onChange={setExitId}
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
                key={mode.id}
                className={outputMode === mode.id ? 'active' : ''}
                type="button"
                onClick={() => setOutputMode(mode.id)}
              >
                {mode.label}
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
        <StatusChip ok={generated.includes('dialer-proxy') || outputMode !== 'clash'} label="YAML OK" detail={t.yamlDetail} />
        <StatusChip ok={isValidJsonOutput(outputMode, generated)} label="JSON OK" detail={t.jsonDetail} />
        <StatusChip ok label="No upload" detail={t.noUploadDetail} />
        <div className="status-summary">
          <span>
            {t.nodes}: {entryCandidates.length + exitCandidates.length}
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
              : fetchMessages.fetchFailed}
        </div>
      )}
    </section>
  )
}

interface NodeSelectProps {
  label: string
  nodes: NormalizedProxyNode[]
  value: string
  emptyText: string
  onChange: (value: string) => void
}

function NodeSelect({ label, nodes, value, emptyText, onChange }: NodeSelectProps) {
  return (
    <label className="node-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={nodes.length === 0}>
        {nodes.length === 0 ? (
          <option value="">{emptyText}</option>
        ) : (
          nodes.map((node) => (
            <option key={node.id} value={node.id}>
              {node.name} · {node.type.toUpperCase()}
            </option>
          ))
        )}
      </select>
    </label>
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

function pickNode(nodes: NormalizedProxyNode[], selectedId: string) {
  return nodes.find((node) => node.id === selectedId) ?? nodes[0]
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
