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
  const [inputMode, setInputMode] = useState<InputMode>('links')
  const [outputMode, setOutputMode] = useState<OutputMode>('clash')
  const [input, setInput] = useState(examples.links)
  const [entryId, setEntryId] = useState('')
  const [exitId, setExitId] = useState('')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

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
    selectedEntry && selectedExit ? `${selectedEntry.name} -> ${selectedExit.name}` : '等待选择入口和出口'

  function loadExample(mode = inputMode) {
    setInput(examples[mode])
    setEntryId('')
    setExitId('')
  }

  function handleModeChange(mode: InputMode) {
    setInputMode(mode)
    loadExample(mode)
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
            <p>本地优先的链式代理配置生成器</p>
          </div>
        </div>
        <div className="privacy-strip" aria-label="隐私状态">
          <span>
            <LockKeyhole size={15} />
            Local only
          </span>
          <span>
            <CheckCircle2 size={15} />
            No upload
          </span>
        </div>
      </header>

      <section className="workspace">
        <section className="panel input-panel" aria-labelledby="input-title">
          <div className="panel-heading">
            <div>
              <h2 id="input-title">Input</h2>
              <p>粘贴代理链接、节点片段，或 Mihomo/Clash 订阅 YAML 内容。</p>
            </div>
            <button className="ghost-button" type="button" onClick={() => loadExample()}>
              <RotateCcw size={16} />
              Examples
            </button>
          </div>

          <div className="segmented-control" role="tablist" aria-label="输入类型">
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
            Proxy links / snippets
            <span>{input.split(/\r?\n/).filter(Boolean).length} lines</span>
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
            <button className="ghost-button" type="button" onClick={() => setInput('')}>
              <Trash2 size={16} />
              Clear
            </button>
            <div className="node-count">
              已解析 <strong>{parsed.nodes.length}</strong> 个节点
            </div>
          </div>

          <div className="chain-card">
            <div className="chain-title">
              <GitBranch size={19} />
              <div>
                <h3>Chain</h3>
                <p>入口建议选择 VLESS Reality，出口选择 SOCKS5 或 Hysteria2。</p>
              </div>
            </div>
            <div className="chain-grid">
              <NodeSelect
                label="Entry"
                nodes={entryCandidates}
                value={selectedEntry?.id ?? ''}
                emptyText="未找到 VLESS 入口"
                onChange={setEntryId}
              />
              <div className="chain-arrow">{'->'}</div>
              <NodeSelect
                label="Exit"
                nodes={exitCandidates}
                value={selectedExit?.id ?? ''}
                emptyText="未找到 SOCKS5/HY2 出口"
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
        </section>

        <section className="panel output-panel" aria-labelledby="output-title">
          <div className="panel-heading output-heading">
            <div>
              <h2 id="output-title">Output</h2>
              <p>生成内容只在当前浏览器会话中存在。</p>
            </div>
            <div className="button-row">
              <button className="ghost-button" type="button" disabled={!generated} onClick={copyOutput}>
                <Clipboard size={16} />
                {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy'}
              </button>
              <button className="primary-button" type="button" disabled={!generated} onClick={downloadOutput}>
                <Download size={16} />
                Download
              </button>
            </div>
          </div>

          <div className="segmented-control output-tabs" role="tablist" aria-label="输出类型">
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
            <span>Preview: {outputFileName}</span>
            <span>{generated ? `${generated.split(/\r?\n/).length} lines` : 'No output'}</span>
          </div>
          <pre className="code-preview">
            <code>{generated || '选择入口节点和出口节点后，这里会生成链式代理配置。'}</code>
          </pre>
        </section>
      </section>

      <footer className="status-bar">
        <StatusChip ok={generated.includes('dialer-proxy') || outputMode !== 'clash'} label="YAML OK" detail="dialer-proxy" />
        <StatusChip ok={isValidJsonOutput(outputMode, generated)} label="JSON OK" detail="proxySettings" />
        <StatusChip ok label="No upload" detail="browser local" />
        <div className="status-summary">
          <span>Nodes: {parsed.nodes.length}</span>
          <span>Chain: {chainLabel}</span>
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
