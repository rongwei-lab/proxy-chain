import { useRef, useState } from 'react'
import { Copy, Download, FolderOpen, Plus, Save, Trash2, Upload, Check, X, Edit2 } from 'lucide-react'
import type { ChainPlan } from '../lib'
import type { Language, UiCopy } from './types-i18n'

interface PlanWorkspaceBarProps {
  language: Language
  copy: UiCopy
  plans: ChainPlan[]
  activePlan: ChainPlan
  includeCredsInLocalSave: boolean
  hasLocalSavedData: boolean
  persistenceFeedback: { kind: 'info' | 'error'; message: string } | null
  /** controls: 方案切换/新建/重命名/复制/删除与模式；save: 本机保存与方案 JSON */
  variant: 'controls' | 'save'
  onSelectPlan: (planId: string) => void
  onCreatePlan: (name: string) => void
  onRenamePlan: (planId: string, name: string) => void
  onDuplicatePlan: (planId: string) => void
  onDeletePlan: (planId: string) => void
  onSwitchMode: (mode: 'simple' | 'advanced') => void
  onToggleIncludeCreds: (checked: boolean) => void
  onSaveLocal: () => void
  onRestoreLocal: () => void
  onClearLocal: () => void
  onExportPlanJson: () => void
  onImportPlanJson: (file: File) => void
}

export function PlanWorkspaceBar({
  language,
  copy,
  plans,
  activePlan,
  includeCredsInLocalSave,
  hasLocalSavedData,
  persistenceFeedback,
  variant,
  onSelectPlan,
  onCreatePlan,
  onRenamePlan,
  onDuplicatePlan,
  onDeletePlan,
  onSwitchMode,
  onToggleIncludeCreds,
  onSaveLocal,
  onRestoreLocal,
  onClearLocal,
  onExportPlanJson,
  onImportPlanJson,
}: PlanWorkspaceBarProps) {
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameDraft, setRenameDraft] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    // 直接把 File 交给上层，便于在读取内容前先检查文件大小上限。
    onImportPlanJson(file)
    event.target.value = ''
  }

  return (
    <div className={`workspace-bar variant-${variant}`}>
      {variant === 'controls' ? (
        <div className="plan-switcher-row">
          <div className="plan-select-group">
            <label className="inline-field">
              <span>{copy.currentPlanLabel}</span>
              <select
                className="select-input compact"
                value={activePlan.id}
                onChange={(e) => {
                  setIsRenaming(false)
                  onSelectPlan(e.target.value)
                }}
                aria-label={copy.activePlanLabel}
              >
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            {isRenaming ? (
              <div className="inline-rename-group">
                <input
                  type="text"
                  className="text-input compact"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  aria-label={copy.renamePlanBtn}
                />
                <button
                  type="button"
                  className="ghost-btn xs"
                  aria-label={copy.saveAliasBtn}
                  onClick={() => {
                    if (renameDraft.trim()) {
                      onRenamePlan(activePlan.id, renameDraft.trim())
                    }
                    setIsRenaming(false)
                  }}
                >
                  <Check size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ghost-btn xs"
                  aria-label={copy.cancelAliasBtn}
                  onClick={() => setIsRenaming(false)}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="plan-action-btns">
                <button
                  type="button"
                  className="ghost-btn xs"
                  onClick={() => {
                    const idx = plans.length + 1
                    onCreatePlan(language === 'zh' ? `方案 ${idx}` : `Plan ${idx}`)
                  }}
                >
                  <Plus size={13} aria-hidden="true" />
                  {copy.newPlanBtn}
                </button>
                <button
                  type="button"
                  className="ghost-btn xs"
                  onClick={() => {
                    setRenameDraft(activePlan.name)
                    setIsRenaming(true)
                  }}
                >
                  <Edit2 size={13} aria-hidden="true" />
                  {copy.renamePlanBtn}
                </button>
                <button
                  type="button"
                  className="ghost-btn xs"
                  onClick={() => onDuplicatePlan(activePlan.id)}
                >
                  <Copy size={13} aria-hidden="true" />
                  {copy.duplicatePlanBtn}
                </button>
                <button
                  type="button"
                  className="ghost-btn xs danger-text"
                  disabled={plans.length <= 1}
                  onClick={() => onDeletePlan(activePlan.id)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                  {copy.deletePlanBtn}
                </button>
              </div>
            )}
          </div>

          <div className="mode-toggle" role="group" aria-label={copy.modeLabel}>
            <button
              type="button"
              className={activePlan.mode === 'simple' ? 'active' : ''}
              onClick={() => onSwitchMode('simple')}
            >
              {copy.modeSimple}
            </button>
            <button
              type="button"
              className={activePlan.mode === 'advanced' ? 'active' : ''}
              onClick={() => onSwitchMode('advanced')}
            >
              {copy.modeAdvanced}
            </button>
          </div>
        </div>
      ) : null}

      {variant === 'controls' && activePlan.mode === 'simple' && activePlan.relays.length > 0 ? (
        <div className="inline-info-banner">
          {copy.simpleModeHiddenRelaysNotice.replace('%d', String(activePlan.relays.length))}
        </div>
      ) : null}

      {variant === 'save' ? (
        <div className="persistence-box">
          <div className="persistence-header">
            <span className="persistence-title">{copy.persistenceTitle}</span>
            <div className="persistence-actions">
              <button type="button" className="ghost-btn xs" onClick={onSaveLocal}>
                <Save size={13} aria-hidden="true" />
                {copy.saveLocalBtn}
              </button>
              <button
                type="button"
                className="ghost-btn xs"
                disabled={!hasLocalSavedData}
                onClick={onRestoreLocal}
              >
                <FolderOpen size={13} aria-hidden="true" />
                {copy.restoreLocalBtn}
              </button>
              <button
                type="button"
                className="ghost-btn xs danger-text"
                disabled={!hasLocalSavedData}
                onClick={onClearLocal}
              >
                <Trash2 size={13} aria-hidden="true" />
                {copy.clearLocalBtn}
              </button>
              <button type="button" className="ghost-btn xs" onClick={onExportPlanJson}>
                <Download size={13} aria-hidden="true" />
                {copy.exportPlanJsonBtn}
              </button>
              <button
                type="button"
                className="ghost-btn xs"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={13} aria-hidden="true" />
                {copy.importPlanJsonBtn}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                aria-label={copy.importPlanJsonBtn}
                onChange={handleFileChange}
              />
            </div>
          </div>

          <label className="switch-label creds-toggle">
            <input
              type="checkbox"
              checked={includeCredsInLocalSave}
              onChange={(e) => onToggleIncludeCreds(e.target.checked)}
            />
            <span>{copy.includeCredsToggle}</span>
          </label>

          <div className={`persistence-note ${includeCredsInLocalSave ? 'warn' : 'muted'}`}>
            {includeCredsInLocalSave ? copy.saveCredsShortNote : copy.localDefaultSafeNote}
          </div>

          {persistenceFeedback ? (
            <div
              className={`feedback-banner compact ${persistenceFeedback.kind === 'error' ? 'error' : 'info'}`}
              role={persistenceFeedback.kind === 'error' ? 'alert' : 'status'}
            >
              {persistenceFeedback.message}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
