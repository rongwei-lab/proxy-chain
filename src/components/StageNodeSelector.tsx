import { useMemo, useState } from 'react'
import { Edit2, Search, Trash2, AlertTriangle, Check, X } from 'lucide-react'
import { readNodeHint, readRegistryEntry } from '../lib'
import type {
  ChainPlan,
  ChainStage,
  ManagedNodeEntry,
  NodeSource,
  ProxyNodeType,
} from '../lib'
import type { Language, UiCopy } from './types-i18n'

interface StageNodeSelectorProps {
  language: Language
  copy: UiCopy
  stage: ChainStage
  plan: ChainPlan
  registry: Record<string, ManagedNodeEntry>
  sources: NodeSource[]
  emptyMessage?: string
  onToggleNode: (nodeId: string) => void
  onSelectFiltered: (nodeIds: string[]) => void
  onClearFiltered: (nodeIds: string[]) => void
  onClearStage: () => void
  onRenameNode: (nodeId: string, newDisplayName: string) => void
  onRemoveMissingRef: (nodeId: string) => void
}

function formatNodeTypeBadge(type: ProxyNodeType): string {
  switch (type) {
    case 'vless':
      return 'VLESS'
    case 'socks5':
      return 'SOCKS5'
    case 'hysteria2':
      return 'HY2'
    case 'ss':
      return 'SS'
  }
}

export function StageNodeSelector({
  language,
  copy,
  stage,
  plan,
  registry,
  sources,
  emptyMessage,
  onToggleNode,
  onSelectFiltered,
  onClearFiltered,
  onClearStage,
  onRenameNode,
  onRemoveMissingRef,
}: StageNodeSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [protocolFilter, setProtocolFilter] = useState<string>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [aliasDraft, setAliasDraft] = useState('')

  const sourcesById = useMemo(() => {
    const map = new Map<string, NodeSource>()
    for (const s of sources) {
      map.set(s.id, s)
    }
    return map
  }, [sources])

  const selectedSet = useMemo(() => new Set(stage.candidateNodeIds), [stage.candidateNodeIds])
  const allEntries = useMemo(() => Object.values(registry), [registry])

  const missingRefs = useMemo(
    () => stage.candidateNodeIds.filter((nodeId) => !readRegistryEntry(registry, nodeId)),
    [stage.candidateNodeIds, registry],
  )

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allEntries.filter((entry) => {
      if (protocolFilter !== 'all' && entry.node.type !== protocolFilter) {
        return false
      }
      if (sourceFilter !== 'all' && !entry.sourceIds.includes(sourceFilter)) {
        return false
      }
      if (!q) {
        return true
      }
      const sourceNames = entry.sourceIds
        .map((id) => sourcesById.get(id)?.name ?? id)
        .join(' ')
        .toLowerCase()
      return (
        entry.displayName.toLowerCase().includes(q) ||
        entry.node.type.toLowerCase().includes(q) ||
        entry.node.server.toLowerCase().includes(q) ||
        String(entry.node.port).includes(q) ||
        sourceNames.includes(q)
      )
    })
  }, [allEntries, protocolFilter, sourceFilter, searchQuery, sourcesById])

  const filteredIds = useMemo(
    () => filteredEntries.map((entry) => entry.node.id),
    [filteredEntries],
  )

  return (
    <div className="stage-node-selector">
      <div className="selector-toolbar">
        <div className="search-input-wrap">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            className="text-input compact"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={copy.searchNodesPlaceholder}
            aria-label={`${stage.name} ${copy.searchNodesPlaceholder}`}
          />
        </div>

        <select
          className="select-input compact"
          value={protocolFilter}
          onChange={(event) => setProtocolFilter(event.target.value)}
          aria-label={`${stage.name} protocol filter`}
        >
          <option value="all">{copy.filterAllProtocols}</option>
          <option value="vless">VLESS</option>
          <option value="socks5">SOCKS5</option>
          <option value="hysteria2">Hysteria2</option>
          <option value="ss">Shadowsocks</option>
        </select>

        <select
          className="select-input compact"
          value={sourceFilter}
          onChange={(event) => setSourceFilter(event.target.value)}
          aria-label={`${stage.name} source filter`}
        >
          <option value="all">{copy.filterAllSources}</option>
          {sources.map((src) => (
            <option key={src.id} value={src.id}>
              {src.name}
            </option>
          ))}
        </select>
      </div>

      <div className="selector-stats-bar">
        <div className="selector-counts">
          <span>
            {language === 'zh'
              ? `总计 ${allEntries.length} / 匹配 ${filteredEntries.length} / 本层已选 ${stage.candidateNodeIds.length}`
              : `Total ${allEntries.length} / Match ${filteredEntries.length} / Selected ${stage.candidateNodeIds.length}`}
          </span>
        </div>
        <div className="selector-bulk-actions">
          <button
            type="button"
            className="ghost-btn xs"
            disabled={filteredIds.length === 0}
            onClick={() => onSelectFiltered(filteredIds)}
          >
            {copy.selectFilteredBtn}
          </button>
          <button
            type="button"
            className="ghost-btn xs"
            disabled={filteredIds.length === 0}
            onClick={() => onClearFiltered(filteredIds)}
          >
            {copy.clearFilteredBtn}
          </button>
          <button
            type="button"
            className="ghost-btn xs danger-text"
            disabled={stage.candidateNodeIds.length === 0}
            onClick={onClearStage}
          >
            {copy.clearStageBtn}
          </button>
        </div>
      </div>

      {missingRefs.length > 0 ? (
        <div className="missing-refs-box" role="alert">
          {missingRefs.map((nodeId) => {
            const hint = readNodeHint(plan.nodeHints, nodeId)
            return (
              <div key={nodeId} className="missing-ref-row">
                <div className="missing-ref-info">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span className="badge danger">{copy.missingRefBadge}</span>
                  <strong>{hint?.name ?? nodeId}</strong>
                  {hint ? (
                    <span className="muted-meta">
                      ({formatNodeTypeBadge(hint.type)} · {hint.server}:{hint.port})
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="ghost-btn xs"
                  onClick={() => onRemoveMissingRef(nodeId)}
                >
                  <Trash2 size={12} aria-hidden="true" />
                  {copy.removeBrokenRefBtn}
                </button>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="selector-node-list" role="group" aria-label={`${stage.name} candidates`}>
        {allEntries.length === 0 ? (
          <div className="empty-list-hint">
            {emptyMessage ?? (language === 'zh'
              ? '节点库为空，请在左侧“节点来源”中导入或加载示例节点。'
              : 'Registry is empty. Import a source or load demo nodes first.')}
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="empty-list-hint">
            {language === 'zh'
              ? '当前筛选条件下没有匹配节点。'
              : 'No nodes match the current search/filter criteria.'}
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const checked = selectedSet.has(entry.node.id)
            const isEditing = editingNodeId === entry.node.id
            const transportSummary =
              entry.node.type === 'vless'
                ? `${entry.node.security}/${entry.node.packetType ?? 'tcp'}`
                : entry.node.type === 'ss' && entry.node.plugin
                  ? `${entry.node.cipher}+${entry.node.plugin}`
                  : entry.node.type === 'hysteria2' && entry.node.obfs
                    ? `obfs:${entry.node.obfs}`
                    : ''

            return (
              <div
                key={entry.node.id}
                className={`selector-node-item ${checked ? 'is-selected' : ''}`}
              >
                <label className="selector-node-main">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleNode(entry.node.id)}
                  />
                  <div className="selector-node-details">
                    <div className="selector-node-title-row">
                      <span className="protocol-pill">{formatNodeTypeBadge(entry.node.type)}</span>
                      {!isEditing ? (
                        <strong className="node-alias">{entry.displayName}</strong>
                      ) : null}
                      {transportSummary ? (
                        <span className="transport-pill">{transportSummary}</span>
                      ) : null}
                    </div>
                    <div className="selector-node-meta">
                      <code>
                        {entry.node.server}:{entry.node.port}
                      </code>
                      <span className="source-tags">
                        {entry.sourceIds.map((sid) => (
                          <span key={sid} className="source-chip">
                            {sourcesById.get(sid)?.name ?? sid}
                          </span>
                        ))}
                      </span>
                    </div>
                  </div>
                </label>

                {isEditing ? (
                  <div className="alias-edit-row">
                    <input
                      type="text"
                      className="text-input compact"
                      value={aliasDraft}
                      placeholder={copy.renameNodePlaceholder}
                      onChange={(e) => setAliasDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && aliasDraft.trim()) {
                          onRenameNode(entry.node.id, aliasDraft)
                          setEditingNodeId(null)
                        } else if (e.key === 'Escape') {
                          setEditingNodeId(null)
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="ghost-btn xs"
                      aria-label={copy.saveAliasBtn}
                      onClick={() => {
                        if (aliasDraft.trim()) {
                          onRenameNode(entry.node.id, aliasDraft)
                        }
                        setEditingNodeId(null)
                      }}
                    >
                      <Check size={12} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="ghost-btn xs"
                      aria-label={copy.cancelAliasBtn}
                      onClick={() => setEditingNodeId(null)}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="icon-btn"
                    title={language === 'zh' ? '修改节点别名' : 'Rename node alias'}
                    aria-label={`${language === 'zh' ? '重命名' : 'Rename'} ${entry.displayName}`}
                    onClick={() => {
                      setEditingNodeId(entry.node.id)
                      setAliasDraft(entry.displayName)
                    }}
                  >
                    <Edit2 size={13} aria-hidden="true" />
                  </button>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
