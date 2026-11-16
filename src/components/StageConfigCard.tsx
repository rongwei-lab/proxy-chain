import { useId, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, FileUp, GripVertical, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { DEFAULT_PROBE_CONFIG } from '../lib'
import type {
  ChainPlan,
  ChainStage,
  ManagedNodeEntry,
  NodeSource,
  SelectionStrategy,
} from '../lib'
import { StageNodeSelector } from './StageNodeSelector'
import {
  StageNodeImportPanel,
  type StageNodeFormMode,
  type StageNodeImportActions,
} from './StageNodeImportPanel'
import type { Language, UiCopy } from './types-i18n'

interface StageConfigCardProps {
  language: Language
  copy: UiCopy
  role: 'entry' | 'relay' | 'exit'
  stage: ChainStage
  plan: ChainPlan
  registry: Record<string, ManagedNodeEntry>
  sources: NodeSource[]
  isFinalExit: boolean
  canMoveUp?: boolean
  canMoveDown?: boolean
  draggable?: boolean
  onDragStart?: () => void
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void
  onDrop?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  onRemoveRelay?: () => void
  onToggleEnabled?: (enabled: boolean) => void
  onRenameStage?: (name: string) => void
  onChangeStrategy: (strategy: SelectionStrategy) => void
  onChangeProbe: (field: 'url' | 'intervalSeconds' | 'toleranceMs', value: string) => void
  onToggleNode: (nodeId: string) => void
  onSelectFiltered: (nodeIds: string[]) => void
  onClearFiltered: (nodeIds: string[]) => void
  onClearStage: () => void
  onRenameNode: (nodeId: string, newDisplayName: string) => void
  onRemoveMissingRef: (nodeId: string) => void
  /** false 时默认收起选路策略行；非默认策略仍以短标签显示在标题旁 */
  showStrategyDefault?: boolean
  nodeImport?: StageNodeImportActions
}

export function StageConfigCard({
  language,
  copy,
  role,
  stage,
  plan,
  registry,
  sources,
  isFinalExit,
  canMoveUp,
  canMoveDown,
  draggable,
  onDragStart,
  onDragOver,
  onDrop,
  onMoveUp,
  onMoveDown,
  onRemoveRelay,
  onToggleEnabled,
  onRenameStage,
  onChangeStrategy,
  onChangeProbe,
  onToggleNode,
  onSelectFiltered,
  onClearFiltered,
  onClearStage,
  onRenameNode,
  onRemoveMissingRef,
  showStrategyDefault = true,
  nodeImport,
}: StageConfigCardProps) {
  const [expanded, setExpanded] = useState(true)
  const [nodeFormMode, setNodeFormMode] = useState<StageNodeFormMode | null>(null)
  const [importRevision, setImportRevision] = useState(0)
  const addButtonRef = useRef<HTMLButtonElement | null>(null)
  const importButtonRef = useRef<HTMLButtonElement | null>(null)
  const nodeFormId = useId()
  const probe = stage.probe ?? DEFAULT_PROBE_CONFIG

  const roleBadgeLabel =
    role === 'entry'
      ? language === 'zh'
        ? '入口层'
        : 'Entry'
      : role === 'exit'
        ? language === 'zh'
          ? '出口节点'
          : 'Exit'
        : language === 'zh'
          ? '中转层'
          : 'Relay'

  return (
    <div
      className={`stage-card ${!stage.enabled ? 'is-disabled' : ''} ${isFinalExit ? 'is-final-exit' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* 整行点击可展开/收起；行内交互控件（重命名、开关、排序、删除）阻止冒泡。
          键盘路径保留右侧 chevron 按钮（aria-expanded 所在触发器）。 */}
      <div
        className={`stage-card-header ${stage.enabled ? 'is-toggleable' : ''}`}
        onClick={stage.enabled ? () => setExpanded((prev) => !prev) : undefined}
      >
        <div className="stage-header-left">
          {role === 'relay' ? (
            <span
              className="drag-handle"
              title={language === 'zh' ? '拖拽调整中转顺序' : 'Drag to reorder'}
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical size={15} aria-hidden="true" />
            </span>
          ) : null}

          <span className="badge neutral">{roleBadgeLabel}</span>

          {role === 'relay' && onRenameStage ? (
            <input
              type="text"
              className="text-input compact stage-title-input"
              value={stage.name}
              onChange={(e) => onRenameStage(e.target.value)}
              aria-label={language === 'zh' ? '中转层名称' : 'Relay stage name'}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <h3 className="stage-title">{stage.name}</h3>
          )}

          {isFinalExit && stage.enabled ? (
            <span className="badge success">{copy.finalExitBadge}</span>
          ) : null}

          {stage.enabled && stage.strategy !== 'select' ? (
            <span className="badge info">
              {stage.strategy === 'url-test'
                ? copy.strategyShortUrlTest
                : stage.strategy === 'fallback'
                  ? copy.strategyShortFallback
                  : copy.strategyShortSelect}
            </span>
          ) : null}

          <span className="muted-meta">
            {copy.stageSelectedCount.replace('%d', String(stage.candidateNodeIds.length))}
          </span>
        </div>

        <div className="stage-header-actions">
          {nodeImport ? (
            <>
              <button
                ref={addButtonRef}
                type="button"
                className="ghost-btn sm stage-node-action"
                aria-expanded={nodeFormMode === 'manual'}
                aria-controls={nodeFormMode === 'manual' ? nodeFormId : undefined}
                onClick={(event) => {
                  event.stopPropagation()
                  setExpanded(true)
                  setNodeFormMode((prev) => prev === 'manual' ? null : 'manual')
                }}
              >
                <Plus size={14} aria-hidden="true" />
                {copy.stageAddNode}
              </button>
              <button
                ref={importButtonRef}
                type="button"
                className="ghost-btn sm stage-node-action"
                aria-expanded={nodeFormMode === 'import'}
                aria-controls={nodeFormMode === 'import' ? nodeFormId : undefined}
                onClick={(event) => {
                  event.stopPropagation()
                  setExpanded(true)
                  setNodeFormMode((prev) => prev === 'import' ? null : 'import')
                }}
              >
                <FileUp size={14} aria-hidden="true" />
                {copy.stageImportNodes}
              </button>
            </>
          ) : null}
          {role === 'relay' && onToggleEnabled ? (
            <label
              className="switch-label"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={stage.enabled}
                onChange={(e) => onToggleEnabled(e.target.checked)}
              />
              <span>{stage.enabled ? copy.enableStage : copy.disableStage}</span>
            </label>
          ) : null}

          {role === 'relay' && onMoveUp ? (
            <button
              type="button"
              className="icon-btn"
              disabled={!canMoveUp}
              aria-label={`${copy.moveUp} ${stage.name}`}
              title={copy.moveUp}
              onClick={(e) => {
                e.stopPropagation()
                onMoveUp()
              }}
            >
              <ArrowUp size={14} aria-hidden="true" />
            </button>
          ) : null}

          {role === 'relay' && onMoveDown ? (
            <button
              type="button"
              className="icon-btn"
              disabled={!canMoveDown}
              aria-label={`${copy.moveDown} ${stage.name}`}
              title={copy.moveDown}
              onClick={(e) => {
                e.stopPropagation()
                onMoveDown()
              }}
            >
              <ArrowDown size={14} aria-hidden="true" />
            </button>
          ) : null}

          {role === 'relay' && onRemoveRelay ? (
            <button
              type="button"
              className="icon-btn danger-text"
              aria-label={`${copy.removeStage} ${stage.name}`}
              title={copy.removeStage}
              onClick={(e) => {
                e.stopPropagation()
                onRemoveRelay()
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
            </button>
          ) : null}

          {stage.enabled ? (
            <button
              type="button"
              className="icon-btn"
              aria-label={expanded ? 'Collapse stage' : 'Expand stage'}
              aria-expanded={expanded}
              onClick={(e) => {
                e.stopPropagation()
                setExpanded((prev) => !prev)
              }}
            >
              {expanded ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
            </button>
          ) : null}
        </div>
      </div>

      {nodeFormMode && nodeImport ? (
        <StageNodeImportPanel
          {...nodeImport}
          id={nodeFormId}
          copy={copy}
          stageName={stage.name}
          mode={nodeFormMode}
          onClose={() => {
            setNodeFormMode(null)
            const trigger = nodeFormMode === 'manual' ? addButtonRef : importButtonRef
            trigger.current?.focus()
          }}
          onComplete={() => {
            setExpanded(true)
            setImportRevision((prev) => prev + 1)
          }}
        />
      ) : null}

      {!stage.enabled ? (
        <div className="stage-disabled-notice">
          {role === 'exit' ? copy.exitOffShortNote : language === 'zh'
            ? `该中转层已停用（保留 ${stage.candidateNodeIds.length} 个候选）`
            : `Relay disabled (${stage.candidateNodeIds.length} candidate(s) preserved)`}
        </div>
      ) : expanded ? (
        <div className="stage-card-body">
          {showStrategyDefault || stage.strategy !== 'select' ? (
          <div className="strategy-row">
            <label className="inline-field">
              <span>{copy.strategyLabel}</span>
              <select
                className="select-input compact"
                value={stage.strategy}
                onChange={(e) => onChangeStrategy(e.target.value as SelectionStrategy)}
                aria-label={`${stage.name} ${copy.strategyLabel}`}
              >
                <option value="select">{copy.strategySelect}</option>
                <option value="url-test">{copy.strategyUrlTest}</option>
                <option value="fallback">{copy.strategyFallback}</option>
              </select>
            </label>

            {stage.strategy !== 'select' ? (
              <>
                <label className="inline-field probe-url-field">
                  <span>{copy.probeUrlLabel}</span>
                  <input
                    type="url"
                    className="text-input compact"
                    value={probe.url}
                    onChange={(e) => onChangeProbe('url', e.target.value)}
                  />
                </label>

                <label className="inline-field small-num-field">
                  <span>{copy.probeIntervalLabel}</span>
                  <input
                    type="number"
                    min={10}
                    max={86400}
                    className="text-input compact"
                    value={probe.intervalSeconds}
                    onChange={(e) => onChangeProbe('intervalSeconds', e.target.value)}
                  />
                </label>

                {stage.strategy === 'url-test' ? (
                  <label className="inline-field small-num-field">
                    <span>{copy.probeToleranceLabel}</span>
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      className="text-input compact"
                      value={probe.toleranceMs ?? 50}
                      onChange={(e) => onChangeProbe('toleranceMs', e.target.value)}
                    />
                  </label>
                ) : null}
              </>
            ) : null}
          </div>
          ) : null}

          {isFinalExit && stage.strategy !== 'select' ? (
            <div className="inline-warning-banner">
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{copy.exitAutoStrategyNote}</span>
            </div>
          ) : null}

          <StageNodeSelector
            key={importRevision}
            language={language}
            copy={copy}
            stage={stage}
            plan={plan}
            registry={registry}
            sources={sources}
            emptyMessage={nodeImport ? copy.stageEmptyNodes : undefined}
            onToggleNode={onToggleNode}
            onSelectFiltered={onSelectFiltered}
            onClearFiltered={onClearFiltered}
            onClearStage={onClearStage}
            onRenameNode={onRenameNode}
            onRemoveMissingRef={onRemoveMissingRef}
          />
        </div>
      ) : null}
    </div>
  )
}
