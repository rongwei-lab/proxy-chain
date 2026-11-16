import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type {
  ChainPlan,
  CustomRoutingMatchType,
  CustomRoutingRule,
  CustomRoutingTarget,
  RoutingPreset,
} from '../lib'
import type { Language, UiCopy } from './types-i18n'

interface RoutingConfigCardProps {
  language: Language
  copy: UiCopy
  plan: ChainPlan
  allPlans: ChainPlan[]
  onChangePreset: (preset: RoutingPreset) => void
  onAddRule: () => void
  onUpdateRule: (ruleId: string, updater: (prev: CustomRoutingRule) => CustomRoutingRule) => void
  onMoveRule: (ruleId: string, direction: -1 | 1) => void
  onRemoveRule: (ruleId: string) => void
  onChangeFallbackTarget: (target: CustomRoutingTarget) => void
}

function encodeTargetValue(target: CustomRoutingTarget): string {
  if (target.kind === 'direct') {
    return 'direct'
  }
  if (target.kind === 'reject') {
    return 'reject'
  }
  return `plan:${target.planId}`
}

function decodeTargetValue(value: string, fallbackPlanId: string): CustomRoutingTarget {
  if (value === 'direct') {
    return { kind: 'direct' }
  }
  if (value === 'reject') {
    return { kind: 'reject' }
  }
  if (value.startsWith('plan:')) {
    return { kind: 'plan', planId: value.slice(5) || fallbackPlanId }
  }
  return { kind: 'plan', planId: fallbackPlanId }
}

export function RoutingConfigCard({
  language,
  copy,
  plan,
  allPlans,
  onChangePreset,
  onAddRule,
  onUpdateRule,
  onMoveRule,
  onRemoveRule,
  onChangeFallbackTarget,
}: RoutingConfigCardProps) {
  return (
    <section className="panel card">
      <div className="panel-header-row">
        <div>
          <h2>{copy.routingTitle}</h2>
        </div>
      </div>

      <label className="field">
        <span>{copy.routingPresetLabel}</span>
        <select
          className="select-input"
          value={plan.routingPreset}
          onChange={(e) => onChangePreset(e.target.value as RoutingPreset)}
          aria-label={copy.routingPresetLabel}
        >
          <option value="cn-direct">{copy.routingCnDirect}</option>
          <option value="all-proxy">{copy.routingAllProxy}</option>
          <option value="custom">{copy.routingCustom}</option>
        </select>
      </label>

      {plan.routingPreset === 'custom' ? (
        <div className="custom-routing-editor">
          <div className="custom-rules-header">
            <span className="muted-meta">
              {language === 'zh'
                ? '规则按从上到下顺序匹配；若指向其他方案，导出时将自动合并对应方案的独立策略组。'
                : 'Rules match top-to-bottom; targeting another plan automatically merges isolated proxy groups on export.'}
            </span>
            <button type="button" className="ghost-btn xs" onClick={onAddRule}>
              <Plus size={13} aria-hidden="true" />
              {copy.addRuleBtn}
            </button>
          </div>

          {plan.customRules.map((rule, index) => (
            <div key={rule.id} className="custom-rule-row">
              <select
                className="select-input compact"
                value={rule.matchType}
                onChange={(e) =>
                  onUpdateRule(rule.id, (prev) => ({
                    ...prev,
                    matchType: e.target.value as CustomRoutingMatchType,
                  }))
                }
                aria-label={`Rule ${index + 1} match type`}
              >
                <option value="DOMAIN-SUFFIX">DOMAIN-SUFFIX</option>
                <option value="DOMAIN">DOMAIN</option>
                <option value="DOMAIN-KEYWORD">DOMAIN-KEYWORD</option>
              </select>

              <input
                type="text"
                className="text-input compact"
                value={rule.pattern}
                placeholder={
                  rule.matchType === 'DOMAIN-KEYWORD' ? 'google' : 'example.com'
                }
                onChange={(e) =>
                  onUpdateRule(rule.id, (prev) => ({
                    ...prev,
                    pattern: e.target.value,
                  }))
                }
                aria-label={`Rule ${index + 1} pattern`}
              />

              <select
                className="select-input compact"
                value={encodeTargetValue(rule.target)}
                onChange={(e) =>
                  onUpdateRule(rule.id, (prev) => ({
                    ...prev,
                    target: decodeTargetValue(e.target.value, plan.id),
                  }))
                }
                aria-label={`Rule ${index + 1} target`}
              >
                {allPlans.map((targetPlan) => (
                  <option key={targetPlan.id} value={`plan:${targetPlan.id}`}>
                    {copy.targetPlanPrefix}
                    {targetPlan.name}
                  </option>
                ))}
                <option value="direct">{copy.targetDirect}</option>
                <option value="reject">{copy.targetReject}</option>
              </select>

              <div className="rule-row-actions">
                <button
                  type="button"
                  className="icon-btn"
                  disabled={index === 0}
                  aria-label={`${copy.moveUp} rule ${index + 1}`}
                  onClick={() => onMoveRule(rule.id, -1)}
                >
                  <ArrowUp size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={index === plan.customRules.length - 1}
                  aria-label={`${copy.moveDown} rule ${index + 1}`}
                  onClick={() => onMoveRule(rule.id, 1)}
                >
                  <ArrowDown size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="icon-btn danger-text"
                  aria-label={`Delete rule ${index + 1}`}
                  onClick={() => onRemoveRule(rule.id)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}

          <label className="field">
            <span>{copy.fallbackTargetLabel}</span>
            <select
              className="select-input compact"
              value={encodeTargetValue(plan.customFallbackTarget)}
              onChange={(e) =>
                onChangeFallbackTarget(decodeTargetValue(e.target.value, plan.id))
              }
            >
              {allPlans.map((targetPlan) => (
                <option key={targetPlan.id} value={`plan:${targetPlan.id}`}>
                  {copy.targetPlanPrefix}
                  {targetPlan.name}
                </option>
              ))}
              <option value="direct">{copy.targetDirect}</option>
              <option value="reject">{copy.targetReject}</option>
            </select>
          </label>
        </div>
      ) : null}
    </section>
  )
}
