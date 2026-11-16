import { ArrowRight, AlertTriangle } from 'lucide-react'
import type { ChainPreviewModel } from '../lib'
import type { Language, UiCopy } from './types-i18n'

interface ChainPreviewCardProps {
  language: Language
  copy: UiCopy
  preview: ChainPreviewModel
}

/**
 * 紧凑链路示意：常驻步骤导航下方，只显示层名称与已选数量、最终出口标记，
 * 不展开具体候选节点（节点明细在步骤 2 的层卡片中查看）。
 */
export function ChainPreviewCard({ language, copy, preview }: ChainPreviewCardProps) {
  return (
    <section className="panel card preview-panel compact-preview" aria-label={copy.previewTitle}>
      <div className="panel-header-row">
        <div>
          <h2>{copy.previewTitle}</h2>
        </div>
        <span className="badge neutral">
          {language === 'zh'
            ? preview.routingPreset === 'cn-direct'
              ? '国内直连'
              : preview.routingPreset === 'all-proxy'
                ? '全部走代理'
                : '自定义分流'
            : preview.routingPreset}
        </span>
      </div>

      <div className="chain-flow-diagram compact" aria-hidden={false}>
        <div className="flow-endpoint">
          <span className="flow-endpoint-tag">{copy.localDevice}</span>
        </div>

        {preview.stages.map((stage) => {
          const missingCount = stage.candidates.filter((c) => c.missing).length
          return (
            <div key={stage.stageId} className="flow-segment">
              <ArrowRight className="flow-arrow" size={16} aria-hidden="true" />
              <div className={`flow-stage-box ${stage.isFinalExit ? 'is-final' : ''}`}>
                <div className="flow-stage-head">
                  <strong>{stage.name}</strong>
                  <span className="muted-meta">
                    {copy.stageSelectedCount.replace('%d', String(stage.candidates.length))}
                  </span>
                  {stage.isFinalExit ? (
                    <span className="badge success">{copy.finalExitBadge}</span>
                  ) : null}
                  {missingCount > 0 ? (
                    <span className="badge danger">
                      <AlertTriangle size={11} aria-hidden="true" />
                      {copy.stageMissingCount.replace('%d', String(missingCount))}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}

        <div className="flow-segment">
          <ArrowRight className="flow-arrow" size={16} aria-hidden="true" />
          <div className="flow-endpoint target">
            <span className="flow-endpoint-tag">{copy.targetWebsite}</span>
          </div>
        </div>
      </div>

      {preview.disabledStageNames.length > 0 || preview.hiddenRelayCount > 0 ? (
        <div className="preview-footnotes">
          {preview.disabledStageNames.length > 0 ? (
            <span>
              {language === 'zh'
                ? `已停用（不参与串联）：${preview.disabledStageNames.join('、')}`
                : `Disabled (omitted): ${preview.disabledStageNames.join(', ')}`}
            </span>
          ) : null}
          {preview.hiddenRelayCount > 0 ? (
            <span>
              {copy.simpleModeHiddenRelaysNotice.replace('%d', String(preview.hiddenRelayCount))}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
