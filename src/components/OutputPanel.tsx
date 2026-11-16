import { useMemo, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Link2,
} from 'lucide-react'
import {
  buildClashImportUrl,
  getEnabledStagesForPlan,
  readRegistryEntry,
} from '../lib'
import type {
  BackendCapabilities,
  ChainDiagnostic,
  ChainExportResult,
  ChainPlan,
  ManagedNodeEntry,
} from '../lib'
import type { Language, UiCopy } from './types-i18n'

interface OutputPanelProps {
  headingRef?: React.Ref<HTMLHeadingElement>
  language: Language
  copy: UiCopy
  plan: ChainPlan
  registry: Record<string, ManagedNodeEntry>
  capabilities: BackendCapabilities
  mihomoResult: ChainExportResult
  xrayResult: ChainExportResult
  planSummary: string
  /** 步骤 3 可见时才渲染阻断/警告诊断，避免隐藏 pane 出现空节点红色错误墙 */
  active: boolean
  step2BlockingErrors: ChainDiagnostic[]
  warnings: ChainDiagnostic[]
  onGoBack: () => void
  onGoFix: () => void
}

function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function OutputPanel({
  headingRef,
  language,
  copy,
  plan,
  registry,
  capabilities,
  mihomoResult,
  xrayResult,
  planSummary,
  active,
  step2BlockingErrors,
  warnings,
  onGoBack,
  onGoFix,
}: OutputPanelProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [copyFailed, setCopyFailed] = useState(false)
  const [yamlExpanded, setYamlExpanded] = useState(false)
  const [expandedSection, setExpandedSection] = useState<'temp' | 'guide' | null>(null)
  const [tempState, setTempState] = useState<{
    loading: boolean
    error?: string
    importUrl?: string
    configUrl?: string
    expiresInSeconds?: number
    createdForYaml?: string
  }>({ loading: false })

  const errors = step2BlockingErrors
  const enabledStages = useMemo(() => getEnabledStagesForPlan(plan), [plan])
  const firstEntryNode = enabledStages[0]?.stage.candidateNodeIds[0]
    ? readRegistryEntry(registry, enabledStages[0].stage.candidateNodeIds[0])
    : undefined
  const lastStage = enabledStages.length > 1 ? enabledStages[enabledStages.length - 1] : undefined
  const lastExitNode = lastStage?.stage.candidateNodeIds[0]
    ? readRegistryEntry(registry, lastStage.stage.candidateNodeIds[0])
    : undefined

  const handleCopy = async (key: string, text: string) => {
    if (!text) {
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setCopyFailed(false)
      setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1800)
    } catch {
      // 复制失败必须如实反馈，不能显示成功
      setCopyFailed(true)
      setCopiedKey(null)
      setTimeout(() => setCopyFailed(false), 2200)
    }
  }

  const handleCreateTempUrl = async () => {
    if (!capabilities.temporaryClashConfig || !mihomoResult.valid || !mihomoResult.output) {
      return
    }
    setTempState({ loading: true })
    try {
      const created = await buildClashImportUrl(mihomoResult.output)
      setTempState({
        loading: false,
        importUrl: created.importUrl,
        configUrl: created.configUrl,
        expiresInSeconds: created.expiresInSeconds,
        createdForYaml: mihomoResult.output,
      })
    } catch (err) {
      setTempState({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const handleDownloadMihomo = () => {
    if (!mihomoResult.valid) {
      return
    }
    downloadTextFile(
      `${plan.name || 'clash'}.mihomo.yaml`,
      mihomoResult.output,
      'text/yaml;charset=utf-8',
    )
  }

  return (
    <section className="panel card output-panel">
      <div className="panel-header-row">
        <div>
          <h2 id="step-3-heading" ref={headingRef} tabIndex={-1}>
            {copy.outputTitle}
          </h2>
          <p className="muted-meta">
            {copy.exportTargetLabel}: Mihomo (Clash Meta) · {planSummary}
          </p>
        </div>
        <button type="button" className="ghost-btn sm" onClick={onGoBack}>
          {copy.backToEditBtn}
        </button>
      </div>

      {/* 阻断错误：禁止导出并给出跳转 */}
      {active && errors.length > 0 ? (
        <div className="diagnostics-box error" role="alert">
          <div className="diagnostics-title">
            <AlertCircle size={15} aria-hidden="true" />
            <strong>{copy.needFixCount.replace('%d', String(errors.length))}</strong>
          </div>
          <ul>
            {errors.map((err, idx) => (
              <li key={`${err.code}-${idx}`}>{err.message}</li>
            ))}
          </ul>
          <button type="button" className="ghost-btn xs" onClick={onGoFix}>
            {copy.goToFixBtn}
          </button>
        </div>
      ) : null}

      {/* 主操作：下载 / 复制。直接使用当前计算结果，不要求先展开预览 */}
      <div className="output-actions-bar primary">
        <button
          type="button"
          className="primary-btn"
          disabled={!mihomoResult.valid}
          onClick={handleDownloadMihomo}
        >
          <Download size={15} aria-hidden="true" />
          {copy.downloadConfigBtn}
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={!mihomoResult.valid}
          onClick={() => handleCopy('mihomo', mihomoResult.output)}
        >
          {copiedKey === 'mihomo' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copiedKey === 'mihomo' ? copy.copiedBtn : copy.copyConfigBtn}
        </button>
        <button
          id="temporary-import-toggle"
          type="button"
          className="ghost-btn export-support-action"
          aria-expanded={expandedSection === 'temp'}
          aria-controls="export-support-panel"
          onClick={() => setExpandedSection((prev) => (prev === 'temp' ? null : 'temp'))}
        >
          <Link2 size={15} aria-hidden="true" />
          {copy.outputTabTempLink}
          <ChevronDown size={13} aria-hidden="true" className={`chev ${expandedSection === 'temp' ? 'up' : ''}`} />
        </button>
        <button
          id="client-guide-toggle"
          type="button"
          className="ghost-btn export-support-action"
          aria-expanded={expandedSection === 'guide'}
          aria-controls="export-support-panel"
          onClick={() => setExpandedSection((prev) => (prev === 'guide' ? null : 'guide'))}
        >
          <BookOpen size={15} aria-hidden="true" />
          {copy.outputTabV2rayn}
          <ChevronDown size={13} aria-hidden="true" className={`chev ${expandedSection === 'guide' ? 'up' : ''}`} />
        </button>
        {copyFailed ? (
          <span className="badge danger" role="alert">
            {language === 'zh' ? '复制失败' : 'Copy failed'}
          </span>
        ) : null}
      </div>

      {expandedSection !== null ? (
        <div
          id="export-support-panel"
          className="export-support-panel"
          role="region"
          aria-labelledby={expandedSection === 'temp' ? 'temporary-import-toggle' : 'client-guide-toggle'}
        >
          {expandedSection === 'temp' ? (
            <div className="temp-import-controls">
              <p className="temp-disclosure">{copy.tempImportDisclosure}</p>
              {!capabilities.temporaryClashConfig ? (
                <div className="inline-warning-banner">{copy.tempImportUnavailable}</div>
              ) : (
                <>
                  <button
                    type="button"
                    className="primary-btn sm"
                    disabled={!mihomoResult.valid || tempState.loading}
                    onClick={handleCreateTempUrl}
                  >
                    <Link2 size={14} aria-hidden="true" />
                    {tempState.loading ? copy.creatingTempImportBtn : copy.createTempImportBtn}
                  </button>

                  {tempState.error ? (
                    <div className="feedback-banner error compact" role="alert">
                      {tempState.error}
                    </div>
                  ) : null}

                  {tempState.importUrl && tempState.configUrl ? (
                    <div className="temp-url-result">
                      {tempState.createdForYaml !== mihomoResult.output ? (
                        <div className="inline-warning-banner">
                          {language === 'zh'
                            ? '当前方案在生成临时链接后发生了修改，如需包含最新改动请重新生成。'
                            : 'Active plan changed since this link was generated; regenerate to include edits.'}
                        </div>
                      ) : null}
                      <code className="temp-url-code">{tempState.configUrl}</code>
                      <div className="temp-url-actions">
                        <a
                          className="primary-btn xs"
                          href={tempState.importUrl}
                          rel="noopener noreferrer"
                        >
                          <ExternalLink size={13} aria-hidden="true" />
                          {copy.openClashSchemeBtn}
                        </a>
                        <button
                          type="button"
                          className="ghost-btn xs"
                          onClick={() => handleCopy('tempUrl', tempState.configUrl!)}
                        >
                          {copiedKey === 'tempUrl' ? copy.copiedBtn : copy.copyTempUrlBtn}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <>
              <div className="info-callout">
                <strong>
                  {language === 'zh'
                    ? 'v2rayN 仅提供手动配置指引（不直接生成 v2rayN 专属导入文件）'
                    : 'v2rayN Manual Setup Guide (Not Direct Client Import)'}
                </strong>
                <p>
                  {language === 'zh'
                    ? '由于各版本 v2rayN 导出 JSON 结构差异且不支持统一的一键多跳 URL 订阅，如需在 Windows v2rayN 手动组链，请按下列步骤设置前置代理：'
                    : 'Because v2rayN multi-hop links are not standardized as portable URLs, configure chaining manually in v2rayN using the steps below:'}
                </p>
              </div>

              <ol className="guide-steps">
                <li>
                  {language === 'zh'
                    ? `步骤 1：分别添加入口节点${firstEntryNode ? `（当前：${firstEntryNode.displayName} / ${firstEntryNode.node.type}）` : ''}与末级出口节点${lastExitNode ? `（当前：${lastExitNode.displayName} / ${lastExitNode.node.type}）` : ''}至服务器列表。`
                    : `Step 1: Import your entry node${firstEntryNode ? ` (${firstEntryNode.displayName} / ${firstEntryNode.node.type})` : ''} and final exit node${lastExitNode ? ` (${lastExitNode.displayName} / ${lastExitNode.node.type})` : ''} into v2rayN.`}
                </li>
                <li>
                  {language === 'zh'
                    ? '步骤 2：在 v2rayN 中右键末级出口节点（或新建链式组），选择“前置代理 (Pre-proxy)”并指向入口节点。'
                    : 'Step 2: Set the Entry node as the Pre-proxy (dialer) for your final Exit node in v2rayN.'}
                </li>
                <li>
                  {language === 'zh'
                    ? '步骤 3：若两节点协议包含 Hysteria2 或 3 层以上复杂中转，强烈建议直接导出本页的“下载配置”并在 Clash Meta / Mihomo 内核中使用。'
                    : 'Step 3: For Hysteria2 or 3+ stage chains, prefer the Download Config above and running Mihomo core directly.'}
                </li>
              </ol>

              <div className="compat-disclosure">{copy.shadowrocketDisclosure}</div>

              {xrayResult.valid ? (
                <div className="xray-debug-box">
                  <div className="output-actions-bar">
                    <span className="muted-meta">
                      {language === 'zh'
                        ? '参考用基础 Xray Outbounds JSON（仅当启用的首两跳均为 Xray 支持协议时生成）：'
                        : 'Reference Xray Outbounds JSON (for first two compatible hops):'}
                    </span>
                    <button
                      type="button"
                      className="ghost-btn xs"
                      onClick={() => handleCopy('xray', xrayResult.output)}
                    >
                      {copiedKey === 'xray' ? copy.copiedBtn : copy.copyOutputBtn}
                    </button>
                  </div>
                  <pre className="code-preview">
                    <code>{xrayResult.output}</code>
                  </pre>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {/* YAML 默认折叠 */}
      {mihomoResult.valid ? (
        <div className="yaml-fold">
          <button
            type="button"
            className="ghost-btn xs"
            aria-expanded={yamlExpanded}
            onClick={() => setYamlExpanded((prev) => !prev)}
          >
            <ChevronDown size={13} aria-hidden="true" className={`chev ${yamlExpanded ? 'up' : ''}`} />
            {yamlExpanded ? copy.hideConfigBtn : copy.viewConfigBtn}
          </button>
          {yamlExpanded ? (
            <>
              <details className="config-notes">
                <summary>{copy.dnsDisclosureTitle}</summary>
                <p>{copy.dnsDisclosureBody}</p>
              </details>
              <pre className="code-preview">
                <code>{mihomoResult.output}</code>
              </pre>
            </>
          ) : null}
        </div>
      ) : null}

      {/* 非阻断警告：折叠但显示数量 */}
      {active && warnings.length > 0 ? (
        <details className="warnings-fold">
          <summary>
            <AlertTriangle size={13} aria-hidden="true" />
            {copy.warningsCount.replace('%d', String(warnings.length))}
          </summary>
          <ul>
            {warnings.map((warn, idx) => (
              <li key={`${warn.code}-${idx}`}>{warn.message}</li>
            ))}
          </ul>
        </details>
      ) : null}

    </section>
  )
}
