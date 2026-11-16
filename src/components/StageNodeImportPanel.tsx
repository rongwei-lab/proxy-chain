import { useEffect, useMemo, useRef, useState } from 'react'
import { FileUp, UploadCloud, X } from 'lucide-react'
import { classifyUnifiedInput, MAX_PLAN_FILE_BYTES, PLAN_FILE_TOO_LARGE_MESSAGE } from '../lib'
import { ManualNodeForm } from './ManualNodeForm'
import { INITIAL_MANUAL_FORM, type ManualNodeFormState } from './manual-node-form-state'
import type { UiCopy } from './types-i18n'

export type StageNodeFormMode = 'manual' | 'import'
export interface NodeImportFeedback {
  kind: 'info' | 'error'
  message: string
}
type FeedbackHandler = (feedback: NodeImportFeedback) => void

export interface StageNodeImportActions {
  fetchViaService: boolean
  onAddPaste: (text: string, feedback: FeedbackHandler) => boolean
  onAddManual: (form: ManualNodeFormState, feedback: FeedbackHandler) => boolean
  onAddSubscription: (
    url: string,
    feedback: FeedbackHandler,
    signal: AbortSignal,
  ) => Promise<boolean>
}

interface StageNodeImportPanelProps extends StageNodeImportActions {
  id: string
  copy: UiCopy
  stageName: string
  mode: StageNodeFormMode
  onClose: () => void
  onComplete: () => void
}

export function StageNodeImportPanel({
  id,
  copy,
  stageName,
  mode,
  fetchViaService,
  onClose,
  onComplete,
  onAddPaste,
  onAddManual,
  onAddSubscription,
}: StageNodeImportPanelProps) {
  const [text, setText] = useState('')
  const [manualForm, setManualForm] = useState(() => ({ ...INITIAL_MANUAL_FORM }))
  const [formFeedback, setFormFeedback] = useState<(NodeImportFeedback & { mode: StageNodeFormMode }) | null>(null)
  const [pending, setPending] = useState<AbortController | null>(null)
  const pendingRef = useRef<AbortController | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const classified = useMemo(() => classifyUnifiedInput(text), [text])
  const importing = pending !== null && !pending.signal.aborted
  const feedback = formFeedback?.mode === mode ? formFeedback : null
  const title = `${mode === 'manual' ? copy.stageAddNode : copy.stageImportNodes} · ${stageName}`

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('textarea, select')?.focus()
    return () => pendingRef.current?.abort()
  }, [mode])

  const reportFeedback: FeedbackHandler = (next) => {
    const message = next.kind === 'info'
      ? `${next.message} ${copy.stageNodesSelected.replace('%s', stageName)}`
      : next.message
    setFormFeedback({ ...next, mode, message })
  }

  const runImport = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (pendingRef.current && !pendingRef.current.signal.aborted) {
      return
    }
    const controller = new AbortController()
    pendingRef.current = controller
    setPending(controller)
    setFormFeedback(null)
    try {
      await action(controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) {
        reportFeedback({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      if (pendingRef.current === controller) {
        pendingRef.current = null
        if (!controller.signal.aborted) setPending(null)
      }
    }
  }

  const reportInvalidInput = (kind: string) => reportFeedback({
    kind: 'error',
    message: kind === 'mixed' ? copy.unifiedMixedError : copy.stageUnsupportedInput,
  })

  const importLocalContent = (content: string) => {
    if (onAddPaste(content, reportFeedback)) {
      setText('')
      onComplete()
    }
  }

  const importText = async () => {
    if (importing || classified.kind === 'empty') return
    if (classified.kind === 'local-content') {
      importLocalContent(classified.text)
      return
    }
    if (classified.kind !== 'subscription-url') {
      reportInvalidInput(classified.kind)
      return
    }

    await runImport(async (signal) => {
      const ok = await onAddSubscription(classified.url, reportFeedback, signal)
      if (ok && !signal.aborted) {
        setText('')
        onComplete()
      }
    })
  }

  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || importing) return
    if (file.size > MAX_PLAN_FILE_BYTES) {
      reportFeedback({ kind: 'error', message: PLAN_FILE_TOO_LARGE_MESSAGE })
      return
    }
    await runImport(async (signal) => {
      const content = await file.text()
      if (signal.aborted) return

      const result = classifyUnifiedInput(content)
      setText(content)
      if (result.kind === 'local-content') {
        importLocalContent(result.text)
      } else if (result.kind !== 'subscription-url') {
        reportInvalidInput(result.kind)
      }
      // 文件里的订阅地址先显示在输入框；用户看到联网提示并点击导入后才拉取。
    })
  }

  return (
    <section
      id={id}
      ref={panelRef}
      className="stage-node-import-panel"
      role="region"
      aria-labelledby={`${id}-title`}
    >
      <div className="stage-node-import-header">
        <h4 id={`${id}-title`}>{title}</h4>
        <button
          type="button"
          className="icon-btn"
          aria-label={copy.stageCloseForm}
          onClick={() => {
            pendingRef.current?.abort()
            onClose()
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {mode === 'manual' ? (
        <ManualNodeForm
          copy={copy}
          form={manualForm}
          setForm={setManualForm}
          submitLabel={copy.stageAddAndSelect}
          onSubmit={(event) => {
            event.preventDefault()
            if (onAddManual(manualForm, reportFeedback)) {
              setManualForm({ ...INITIAL_MANUAL_FORM, protocol: manualForm.protocol })
              onComplete()
            }
          }}
        />
      ) : (
        <form
          className="source-form"
          onSubmit={(event) => {
            event.preventDefault()
            void importText()
          }}
        >
          <label className="field">
            <span>{copy.unifiedInputLabel}</span>
            <textarea
              className="textarea-input"
              rows={4}
              value={text}
              readOnly={importing}
              onChange={(event) => {
                setText(event.target.value)
                setFormFeedback(null)
              }}
              placeholder={copy.unifiedInputPlaceholder}
            />
          </label>
          {classified.kind === 'subscription-url' ? (
            <div className="capability-hint" role="status">
              {fetchViaService ? copy.unifiedWillFetchViaServiceNote : copy.unifiedWillFetchNote}
            </div>
          ) : null}
          <div className="form-actions">
            <button type="submit" className="primary-btn sm" disabled={importing || !text.trim()}>
              <UploadCloud size={15} aria-hidden="true" />
              {importing ? copy.unifiedImportingBtn : copy.stageImportAndSelect}
            </button>
            <button type="button" className="ghost-btn sm" disabled={importing} onClick={() => fileRef.current?.click()}>
              <FileUp size={15} aria-hidden="true" />
              {copy.uploadFileBtn}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.yaml,.yml,.json,text/plain,application/json"
            className="sr-only"
            aria-label={copy.uploadFileBtn}
            onChange={(event) => void importFile(event)}
          />
        </form>
      )}

      {feedback ? (
        <div className={`feedback-banner ${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'}>
          {feedback.message}
        </div>
      ) : null}
    </section>
  )
}
