import { useMemo, useRef, useState } from 'react'
import {
  Plus,
  RefreshCw,
  Trash2,
  UploadCloud,
  X,
  AlertCircle,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  FileUp,
} from 'lucide-react'
import { classifyUnifiedInput, MAX_PLAN_FILE_BYTES, PLAN_FILE_TOO_LARGE_MESSAGE } from '../lib'
import type {
  BackendCapabilities,
  FetchMode,
  NodeSource,
  SourceDeletionImpact,
} from '../lib'
import { ManualNodeForm } from './ManualNodeForm'
import { INITIAL_MANUAL_FORM, type ManualNodeFormState } from './manual-node-form-state'
import type { Language, UiCopy } from './types-i18n'

interface SourceManagerPanelProps {
  headingRef?: React.Ref<HTMLHeadingElement>
  language: Language
  copy: UiCopy
  capabilities: BackendCapabilities
  sources: NodeSource[]
  registrySize: number
  fetchMode: FetchMode
  fetcherEndpoint: string
  fetcherToken: string
  pendingDeleteImpact: SourceDeletionImpact | null
  hasUndoableDeletion: boolean
  formFeedback: { kind: 'info' | 'error'; message: string } | null
  onChangeFetchMode: (mode: FetchMode) => void
  onChangeFetcherEndpoint: (val: string) => void
  onChangeFetcherToken: (val: string) => void
  onUploadError: (message: string) => void
  onAddSubscription: (name: string, url: string) => Promise<boolean>
  onAddPaste: (name: string, text: string) => boolean
  onAddManual: (form: ManualNodeFormState) => boolean
  onRefreshSubscription: (sourceId: string) => void
  onCancelRefresh: (sourceId: string) => void
  onRequestDeleteSource: (sourceId: string) => void
  onConfirmDeleteSource: () => void
  onCancelDeleteSource: () => void
  onUndoDeleteSource: () => void
}

export function SourceManagerPanel({
  headingRef,
  language,
  copy,
  capabilities,
  sources,
  registrySize,
  fetchMode,
  fetcherEndpoint,
  fetcherToken,
  pendingDeleteImpact,
  hasUndoableDeletion,
  formFeedback,
  onChangeFetchMode,
  onChangeFetcherEndpoint,
  onChangeFetcherToken,
  onUploadError,
  onAddSubscription,
  onAddPaste,
  onAddManual,
  onRefreshSubscription,
  onCancelRefresh,
  onRequestDeleteSource,
  onConfirmDeleteSource,
  onCancelDeleteSource,
  onUndoDeleteSource,
}: SourceManagerPanelProps) {
  // 统一输入 + 折叠区草稿。这些状态保存在本组件，切步骤时组件不卸载（父级用
  // hidden 切换显示），草稿与在途请求因此天然保留。
  const [unifiedText, setUnifiedText] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [moreWaysOpen, setMoreWaysOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [subOptionsOpen, setSubOptionsOpen] = useState(false)
  const [manualForm, setManualForm] = useState<ManualNodeFormState>(INITIAL_MANUAL_FORM)
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null)
  const [subName, setSubName] = useState('')
  const [subUrl, setSubUrl] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 本地上传文件：读取后按统一输入分派处理（节点/YAML 本地解析；单个订阅地址走订阅拉取）。
  const handleUploadFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || isImporting) {
      return
    }
    if (file.size > MAX_PLAN_FILE_BYTES) {
      onUploadError(PLAN_FILE_TOO_LARGE_MESSAGE)
      return
    }
    try {
      const text = await file.text()
      const result = classifyUnifiedInput(text)
      if (result.kind === 'subscription-url') {
        setIsImporting(true)
        try {
          const ok = await onAddSubscription(subName, result.url)
          if (ok) {
            setSubName('')
          }
        } finally {
          setIsImporting(false)
        }
        return
      }
      if (result.kind === 'local-content') {
        if (onAddPaste(subName, result.text)) {
          setSubName('')
        }
      }
      // mixed / unrecognized：App 层 formFeedback 显示错误，不上传不清空
    } catch (err) {
      onUploadError(err instanceof Error ? err.message : String(err))
    }
  }

  // 自动识别仅用于展示提示，不发起请求
  const classified = useMemo(() => classifyUnifiedInput(unifiedText), [unifiedText])
  const willFetch = classified.kind === 'subscription-url'

  const handleUnifiedImport = async () => {
    if (isImporting) {
      return
    }
    const result = classifyUnifiedInput(unifiedText)
    if (result.kind === 'empty') {
      return
    }
    if (result.kind === 'subscription-url') {
      setIsImporting(true)
      try {
        const ok = await onAddSubscription(subName, result.url)
        if (ok) {
          setUnifiedText('')
          setSubName('')
        }
      } finally {
        setIsImporting(false)
      }
      return
    }
    if (result.kind === 'local-content') {
      if (onAddPaste(subName, result.text)) {
        setUnifiedText('')
        setSubName('')
      }
    }
    // mixed / unrecognized：错误反馈由 App 层显示（formFeedback），
    // 输入保留不清空。
  }

  const handleSubmitManual = (e: React.FormEvent) => {
    e.preventDefault()
    if (onAddManual(manualForm)) {
      setManualForm((prev) => ({
        ...INITIAL_MANUAL_FORM,
        protocol: prev.protocol,
      }))
    }
  }

  return (
    <section className="panel card">
      <div className="panel-header-row">
        <div>
          <h2 id="step-1-heading" ref={headingRef} tabIndex={-1}>{copy.sourcesTitle}</h2>
          <p>{copy.sourcesDesc}</p>
        </div>
      </div>

      {/* 统一输入 */}
      <form
        className="source-form unified-form"
        onSubmit={(e) => {
          e.preventDefault()
          void handleUnifiedImport()
        }}
      >
        <label className="field">
          <span>{copy.unifiedInputLabel}</span>
          <textarea
            className="textarea-input"
            rows={4}
            value={unifiedText}
            onChange={(e) => setUnifiedText(e.target.value)}
            placeholder={copy.unifiedInputPlaceholder}
            aria-label={copy.unifiedInputLabel}
          />
        </label>

        {willFetch ? (
          <div className="capability-hint ok" role="status">
            {fetchMode === 'service'
              ? copy.unifiedWillFetchViaServiceNote
              : copy.unifiedWillFetchNote}
          </div>
        ) : null}
        {classified.kind === 'mixed' ? (
          <div className="feedback-banner error compact" role="alert">
            {copy.unifiedMixedError}
          </div>
        ) : null}
        {classified.kind === 'unrecognized' ? (
          <div className="feedback-banner error compact" role="alert">
            {copy.unifiedEmptyError}
          </div>
        ) : null}

        <div className="form-actions">
          <button
            type="submit"
            className="primary-btn"
            disabled={isImporting || classified.kind === 'empty'}
          >
            <UploadCloud size={15} aria-hidden="true" />
            {isImporting ? copy.unifiedImportingBtn : copy.unifiedImportBtn}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            <FileUp size={15} aria-hidden="true" />
            {copy.uploadFileBtn}
          </button>
          <button
            type="button"
            className="ghost-btn"
            aria-expanded={moreWaysOpen}
            onClick={() => setMoreWaysOpen((prev) => !prev)}
          >
            <ChevronDown size={14} aria-hidden="true" className={`chev ${moreWaysOpen ? 'up' : ''}`} />
            {copy.moreWaysBtn}
          </button>
        </div>

        {/* 本地上传：读取文件内容后走与统一输入相同的本地解析流程，不上传网络 */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.yaml,.yml,.json,text/plain,application/json"
          className="sr-only"
          aria-label={copy.uploadFileBtn}
          onChange={handleUploadFile}
        />
      </form>

      {moreWaysOpen ? (
        <div className="more-ways-box">
          {/* 来源命名（可选） */}
          <label className="field">
            <span>{copy.sourceNameLabel}</span>
            <input
              type="text"
              className="text-input"
              value={subName}
              onChange={(e) => setSubName(e.target.value)}
              placeholder={copy.sourceNamePlaceholder}
            />
          </label>

          {/* 手动添加 */}
          <div className="more-ways-group">
            <button
              type="button"
              className="ghost-btn sm"
              aria-expanded={manualOpen}
              onClick={() => setManualOpen((prev) => !prev)}
            >
              <Plus size={14} aria-hidden="true" />
              {copy.moreWaysManual}
            </button>
            {manualOpen ? <ManualNodeForm copy={copy} form={manualForm} setForm={setManualForm} onSubmit={handleSubmitManual} /> : null}
          </div>

          {/* 订阅拉取选项 */}
          <div className="more-ways-group">
            <button
              type="button"
              className="ghost-btn sm"
              aria-expanded={subOptionsOpen}
              onClick={() => setSubOptionsOpen((prev) => !prev)}
            >
              {copy.moreWaysSubOptions}
            </button>
            {subOptionsOpen ? (
              <div className="fetcher-config-box">
                <label className="field">
                  <span>{copy.fetchModeLabel}</span>
                  <select
                    className="select-input"
                    value={fetchMode}
                    onChange={(e) => onChangeFetchMode(e.target.value as FetchMode)}
                  >
                    <option value="auto">{copy.fetchModeAuto}</option>
                    <option value="hosted">{copy.fetchModeHosted}</option>
                    <option value="direct">{copy.fetchModeDirect}</option>
                    <option value="service">{copy.fetchModeService}</option>
                  </select>
                </label>

                <div className={`capability-hint ${capabilities.fetchSubscription ? 'ok' : 'muted'}`}>
                  {capabilities.fetchSubscription ? copy.fetcherHintHostedOk : copy.fetcherHintHostedOff}
                </div>

                {fetchMode === 'service' ? (
                  <div className="field-grid two-col">
                    <label className="field">
                      <span>{copy.fetcherEndpointLabel}</span>
                      <input
                        type="url"
                        className="text-input"
                        value={fetcherEndpoint}
                        onChange={(e) => onChangeFetcherEndpoint(e.target.value)}
                        placeholder="http://127.0.0.1:8787/fetch-subscription"
                      />
                    </label>
                    <label className="field">
                      <span>{copy.fetcherTokenLabel}</span>
                      <input
                        type="password"
                        autoComplete="off"
                        className="text-input"
                        value={fetcherToken}
                        onChange={(e) => onChangeFetcherToken(e.target.value)}
                      />
                    </label>
                  </div>
                ) : null}

                {/* 旧版独立订阅地址输入保留在选项区，供精确填地址使用 */}
                <form
                  className="inline-sub-form"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (!subUrl.trim()) {
                      return
                    }
                    setIsImporting(true)
                    try {
                      const ok = await onAddSubscription(subName, subUrl)
                      if (ok) {
                        setSubUrl('')
                        setSubName('')
                      }
                    } finally {
                      setIsImporting(false)
                    }
                  }}
                >
                  <label className="field">
                    <span>{copy.subUrlLabel}</span>
                    <input
                      type="url"
                      className="text-input"
                      value={subUrl}
                      onChange={(e) => setSubUrl(e.target.value)}
                      placeholder={copy.subUrlPlaceholder}
                      required
                    />
                  </label>
                  <button type="submit" className="ghost-btn sm" disabled={isImporting}>
                    <UploadCloud size={14} aria-hidden="true" />
                    {isImporting ? copy.unifiedImportingBtn : copy.addSubscriptionBtn}
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {formFeedback ? (
        <div
          className={`feedback-banner ${formFeedback.kind === 'error' ? 'error' : 'info'}`}
          role={formFeedback.kind === 'error' ? 'alert' : 'status'}
        >
          {formFeedback.message}
          {formFeedback.kind === 'error' && unifiedText.trim() ? (
            <button
              type="button"
              className="link-btn"
              onClick={() => void handleUnifiedImport()}
              disabled={isImporting}
            >
              {copy.refreshSource}
            </button>
          ) : null}
        </div>
      ) : null}

      {hasUndoableDeletion ? (
        <div className="undo-banner" role="status">
          <span>{copy.deletedNotice}</span>
          <button type="button" className="ghost-btn xs" onClick={onUndoDeleteSource}>
            <RotateCcw size={13} aria-hidden="true" />
            {copy.undoDelete}
          </button>
        </div>
      ) : null}

      {pendingDeleteImpact ? (
        <div className="delete-impact-modal" role="alertdialog" aria-label={copy.confirmDelete}>
          <strong>
            {language === 'zh'
              ? `确认删除来源 “${pendingDeleteImpact.sourceName}”？`
              : `Delete source "${pendingDeleteImpact.sourceName}"?`}
          </strong>
          <p>
            {language === 'zh'
              ? `将从节点库移除 ${pendingDeleteImpact.removedExclusiveNodeIds.length} 个独占节点，保留 ${pendingDeleteImpact.keptSharedNodeIds.length} 个多来源共享节点。`
              : `Removes ${pendingDeleteImpact.removedExclusiveNodeIds.length} exclusive node(s); keeps ${pendingDeleteImpact.keptSharedNodeIds.length} shared node(s).`}
          </p>
          {pendingDeleteImpact.affectedPlans.length > 0 ? (
            <ul className="impact-plan-list">
              {pendingDeleteImpact.affectedPlans.map((ap) => (
                <li key={ap.planId}>
                  {language === 'zh'
                    ? `方案 “${ap.planName}” (${ap.stageNames.join(' / ')}) 有 ${ap.brokenNodeIds.length} 个节点引用将标为缺失`
                    : `Plan "${ap.planName}" (${ap.stageNames.join(' / ')}) will have ${ap.brokenNodeIds.length} missing ref(s)`}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="impact-actions">
            <button type="button" className="danger-btn xs" onClick={onConfirmDeleteSource}>
              {copy.confirmDelete}
            </button>
            <button type="button" className="ghost-btn xs" onClick={onCancelDeleteSource}>
              {copy.cancelDelete}
            </button>
          </div>
        </div>
      ) : null}

      {/* 紧凑来源列表：名称、节点数、状态；操作与详情按需展开 */}
      {sources.length > 0 ? (
        <div className="source-list">
          <div className="source-list-summary">
            <strong>
              {language === 'zh'
                ? `${sources.length} 个来源 · 节点库 ${registrySize} 个节点`
                : `${sources.length} source(s) · ${registrySize} node(s) in registry`}
            </strong>
          </div>
          {sources.map((src) => {
            const isExpanded = expandedSourceId === src.id
            const skipped =
              (src.parseStats?.unsupportedCount ?? 0) + (src.parseStats?.invalidCount ?? 0)
            return (
              <div key={src.id} className={`source-item-card compact status-${src.status}`}>
                {/* 整行可点击展开/收起：用原生 button 保证键盘与触屏可用 */}
                <button
                  type="button"
                  className="source-item-top source-row-toggle"
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedSourceId(isExpanded ? null : src.id)}
                >
                  <div className="source-item-meta">
                    <strong>{src.name}</strong>
                    <span className="muted-meta">
                      {language === 'zh'
                        ? `${src.nodeIds.length} 节点`
                        : `${src.nodeIds.length} nodes`}
                    </span>
                    {src.status === 'loading' ? (
                      <span className="badge info">{copy.sourceStatusLoading}</span>
                    ) : src.status === 'failed' ? (
                      <span className="badge danger">{copy.sourceStatusFailed}</span>
                    ) : null}
                  </div>
                  <span className="source-row-chevron" aria-hidden="true">
                    {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </span>
                </button>

                {isExpanded ? (
                  <div className="source-item-detail">
                    <div className="source-item-actions">
                      {src.kind === 'subscription' ? (
                        src.status === 'loading' ? (
                          <button
                            type="button"
                            className="ghost-btn xs"
                            onClick={() => onCancelRefresh(src.id)}
                          >
                            <X size={13} aria-hidden="true" />
                            {copy.cancelRefresh}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="ghost-btn xs"
                            onClick={() => onRefreshSubscription(src.id)}
                          >
                            <RefreshCw size={13} aria-hidden="true" />
                            {copy.refreshSource}
                          </button>
                        )
                      ) : null}
                      <button
                        type="button"
                        className="ghost-btn xs danger-text"
                        aria-label={`${copy.deleteSource} ${src.name}`}
                        onClick={() => onRequestDeleteSource(src.id)}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                        {copy.deleteSource}
                      </button>
                    </div>

                    {src.parseStats ? (
                      <div className="source-stats-line">
                        <span>
                          {language === 'zh'
                            ? `有效 ${src.parseStats.validCount} / 不支持 ${src.parseStats.unsupportedCount} / 无效 ${src.parseStats.invalidCount}`
                            : `Valid ${src.parseStats.validCount} / Unsupported ${src.parseStats.unsupportedCount} / Invalid ${src.parseStats.invalidCount}`}
                        </span>
                      </div>
                    ) : null}

                    {src.errorMessage ? (
                      <div className="source-error-line">
                        <AlertCircle size={13} aria-hidden="true" />
                        <span>
                          {src.errorMessage} ({copy.sourceKeepOldNotice})
                        </span>
                      </div>
                    ) : null}

                    {src.parseStats && src.parseStats.issues.length > 0 ? (
                      <details className="source-issues-details">
                        <summary>
                          {language === 'zh'
                            ? `查看详情 (${src.parseStats.issues.length})`
                            : `Details (${src.parseStats.issues.length})`}
                        </summary>
                        <ul className="source-issue-list">
                          {src.parseStats.issues.slice(0, 12).map((issue, idx) => (
                            <li key={idx}>
                              <span className={`badge ${issue.kind === 'unsupported' ? 'warning' : 'danger'}`}>
                                {issue.kind}
                              </span>{' '}
                              <strong>{issue.label}</strong>: {issue.message}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                ) : skipped > 0 ? (
                  <div className="source-stats-line">
                    <span className="badge warning">
                      {language === 'zh' ? `${skipped} 项未导入` : `${skipped} skipped`}
                    </span>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
