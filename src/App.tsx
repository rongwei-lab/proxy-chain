import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  Clipboard,
  Download,
  FileCode2,
  GitBranch,
  Link2,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  SquareArrowDown,
  TerminalSquare,
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

type InputMode = 'links' | 'subscription' | 'snippet'
type OutputMode = 'clash' | 'xray' | 'links'
type Language = 'zh' | 'en'

const inputModes: Array<{ id: InputMode; label: string; icon: typeof Link2 }> = [
  { id: 'links', label: 'Import links', icon: Link2 },
  { id: 'subscription', label: 'YAML subscription', icon: FileCode2 },
  { id: 'snippet', label: 'Node snippet', icon: TerminalSquare },
]

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
    inputDescription: '粘贴代理链接、节点片段，或 Mihomo/Clash 订阅 YAML 内容。',
    examples: '示例',
    inputType: '输入类型',
    editorLabel: '代理链接 / 节点片段',
    lines: '行',
    clear: '清空',
    fetchSubscription: '拉取订阅',
    fetchingSubscription: '拉取中...',
    fetchSuccess: '订阅内容已加载，已在本地解析。',
    fetchUnsupported: '请输入 http(s) 订阅地址后再拉取。',
    fetchFailed: '订阅拉取失败：可能被 CORS、网络或订阅服务限制拦截。可以在浏览器打开订阅后复制 YAML 内容粘贴。',
    parsedPrefix: '已解析',
    parsedSuffix: '个节点',
    chainTitle: '链式代理',
    chainDescription: '入口建议选择 VLESS Reality，出口选择 SOCKS5 或 Hysteria2。',
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
    emptyOutput: '选择入口节点和出口节点后，这里会生成链式代理配置。',
    yamlDetail: 'dialer-proxy',
    jsonDetail: 'proxySettings',
    noUploadDetail: '浏览器本地',
    nodes: '节点',
    chain: '链路',
    waitingChain: '等待选择入口和出口',
    languageLabel: '语言',
  },
  en: {
    subtitle: 'Local-first chained proxy config generator',
    privacyLabel: 'Privacy status',
    inputTitle: 'Input',
    inputDescription: 'Paste proxy links, node snippets, or Mihomo/Clash subscription YAML.',
    examples: 'Examples',
    inputType: 'Input type',
    editorLabel: 'Proxy links / snippets',
    lines: 'lines',
    clear: 'Clear',
    fetchSubscription: 'Fetch subscription',
    fetchingSubscription: 'Fetching...',
    fetchSuccess: 'Subscription content loaded and parsed locally.',
    fetchUnsupported: 'Enter an http(s) subscription URL before fetching.',
    fetchFailed: 'Failed to fetch subscription. It may be blocked by CORS, network, or provider policy. Open it in your browser and paste the YAML content instead.',
    parsedPrefix: 'Parsed',
    parsedSuffix: 'nodes',
    chainTitle: 'Chain',
    chainDescription: 'Use VLESS Reality as entry, then SOCKS5 or Hysteria2 as exit.',
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
    emptyOutput: 'Select an entry and exit node to generate chained proxy config.',
    yamlDetail: 'dialer-proxy',
    jsonDetail: 'proxySettings',
    noUploadDetail: 'browser local',
    nodes: 'Nodes',
    chain: 'Chain',
    waitingChain: 'Waiting for entry and exit',
    languageLabel: 'Language',
  },
} satisfies Record<Language, Record<string, string>>

const examples: Record<InputMode, string> = {
  links: [
    'vless://11111111-1111-4111-8111-111111111111@203.0.113.10:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.example.com&fp=chrome&pbk=********&type=tcp&headerType=none#入口-VLESS',
    'socks5://demo:********@198.51.100.14:1193#出口-SOCKS5',
  ].join('\n'),
  subscription: `proxies:
  - name: "入口-VLESS"
    type: vless
    server: 203.0.113.10
    port: 443
    uuid: 11111111-1111-4111-8111-111111111111
    network: tcp
    tls: true
    flow: xtls-rprx-vision
    servername: www.example.com
    client-fingerprint: chrome
    reality-opts:
      public-key: "********"

  - name: "出口-SOCKS5"
    type: socks5
    server: 198.51.100.14
    port: 1193
    username: demo
    password: "********"
    udp: false`,
  snippet: `name: "出口-HY2"
type: hysteria2
server: 198.51.100.24
port: 8556
password: "********"
sni: www.example.com
skip-cert-verify: true
udp: false`,
}

function App() {
  const [language, setLanguage] = useState<Language>('zh')
  const [inputMode, setInputMode] = useState<InputMode>('links')
  const [outputMode, setOutputMode] = useState<OutputMode>('clash')
  const [input, setInput] = useState(examples.links)
  const [entryId, setEntryId] = useState('')
  const [exitId, setExitId] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'success' | 'failed' | 'unsupported'>('idle')
  const t = copyText[language]

  const parsed = useMemo(() => parseProxyInput(input), [input])
  const entryCandidates = useMemo(() => parsed.nodes.filter((node) => node.type === 'vless'), [parsed.nodes])
  const exitCandidates = useMemo(
    () => parsed.nodes.filter((node) => node.type === 'socks5' || node.type === 'hysteria2'),
    [parsed.nodes],
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
      return parsed.nodes.length > 0 ? generateImportLinks(parsed.nodes) : ''
    }
    if (!selectedEntry || !selectedExit) {
      return ''
    }
    return outputMode === 'clash'
      ? generateClashYaml(selectedEntry, selectedExit)
      : generateXrayJson(selectedEntry, selectedExit)
  }, [outputMode, parsed.nodes, selectedEntry, selectedExit])

  const outputFileName =
    outputMode === 'clash' ? 'config.yaml' : outputMode === 'xray' ? 'config.json' : 'import-links.txt'
  const chainLabel =
    selectedEntry && selectedExit ? `${selectedEntry.name} -> ${selectedExit.name}` : t.waitingChain

  function loadExample(mode = inputMode) {
    setInput(examples[mode])
    setEntryId('')
    setExitId('')
  }

  function handleModeChange(mode: InputMode) {
    setInputMode(mode)
    loadExample(mode)
  }

  async function fetchSubscription() {
    const source = input.trim()

    if (!/^https?:\/\//i.test(source)) {
      setFetchState('unsupported')
      return
    }

    setFetchState('loading')
    try {
      // 订阅拉取只在用户点击后发生；不会自动请求，也不会经过后端保存或转发。
      const response = await fetch(source, { cache: 'no-store' })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const text = await response.text()
      setInput(text)
      setEntryId('')
      setExitId('')
      setFetchState('success')
    } catch {
      setFetchState('failed')
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
            <button className="ghost-button" type="button" onClick={() => loadExample()}>
              <RotateCcw size={16} />
              {t.examples}
            </button>
          </div>

          <div className="segmented-control" role="tablist" aria-label={t.inputType}>
            {inputModes.map((mode) => {
              const Icon = mode.icon
              return (
                <button
                  key={mode.id}
                  className={inputMode === mode.id ? 'active' : ''}
                  type="button"
                  onClick={() => handleModeChange(mode.id)}
                >
                  <Icon size={16} />
                  {mode.label}
                </button>
              )
            })}
          </div>

          <label className="editor-label" htmlFor="proxy-input">
            {t.editorLabel}
            <span>
              {input.split(/\r?\n/).filter(Boolean).length} {t.lines}
            </span>
          </label>
          <textarea
            id="proxy-input"
            className="input-editor"
            value={input}
            spellCheck={false}
            onChange={(event) => {
              setInput(event.target.value)
              setEntryId('')
              setExitId('')
            }}
          />

          <div className="input-actions">
            <div className="input-button-row">
              <button className="ghost-button" type="button" onClick={() => setInput('')}>
                <Trash2 size={16} />
                {t.clear}
              </button>
              <button
                className="ghost-button"
                type="button"
                disabled={fetchState === 'loading'}
                onClick={fetchSubscription}
              >
                <SquareArrowDown size={16} />
                {fetchState === 'loading' ? t.fetchingSubscription : t.fetchSubscription}
              </button>
            </div>
            <div className="node-count">
              {t.parsedPrefix} <strong>{parsed.nodes.length}</strong> {t.parsedSuffix}
            </div>
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

          {parsed.warnings.length > 0 && (
            <div className="warnings">
              {parsed.warnings.slice(0, 2).map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          )}
          {fetchState !== 'idle' && fetchState !== 'loading' && (
            <div className={`fetch-message ${fetchState}`}>
              {fetchState === 'success'
                ? t.fetchSuccess
                : fetchState === 'unsupported'
                  ? t.fetchUnsupported
                  : t.fetchFailed}
            </div>
          )}
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
            {t.nodes}: {parsed.nodes.length}
          </span>
          <span>
            {t.chain}: {chainLabel}
          </span>
        </div>
      </footer>
    </main>
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
