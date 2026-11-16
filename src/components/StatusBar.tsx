import type { ChainExportResult, ChainPlan } from '../lib'
import type { Language, UiCopy } from './types-i18n'

interface StatusBarProps {
  language: Language
  copy: UiCopy
  activePlan: ChainPlan
  mihomoResult: ChainExportResult
  currentStep: 1 | 2 | 3
}

export function StatusBar({
  copy,
  activePlan,
  mihomoResult,
  currentStep,
}: StatusBarProps) {
  const hasAnySelection =
    activePlan.entry.candidateNodeIds.length > 0 ||
    activePlan.exit.candidateNodeIds.length > 0 ||
    activePlan.relays.some((r) => r.candidateNodeIds.length > 0)

  // 步骤 1 空节点不显示红色错误墙；仅在步骤 2/3 有选择但未就绪时提示
  const showBlocked = currentStep !== 1 && hasAnySelection && !mihomoResult.valid

  const stateLabel = mihomoResult.valid
    ? copy.statusReady
    : showBlocked
      ? copy.statusBlocked
      : copy.statusIdle

  return (
    <footer className={`status-bar ${mihomoResult.valid ? 'is-ready' : showBlocked ? 'is-error' : 'is-idle'}`} role="status" aria-live="polite">
      <div className="status-left">
        <span className="status-dot" aria-hidden="true" />
        <strong>{stateLabel}</strong>
      </div>
    </footer>
  )
}
