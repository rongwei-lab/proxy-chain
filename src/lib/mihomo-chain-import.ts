import type { ImportedMihomoChain, ImportedMihomoStage } from './types'

interface YamlProxyReference {
  name: unknown
  dialer: unknown
  nodeId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasDialer(value: unknown): boolean {
  return value !== undefined && value !== ''
}

function readGroup(group: Record<string, unknown>, name: string): Omit<ImportedMihomoStage, 'candidateNodeIds'> | undefined {
  if (group.type === 'select') {
    return { name, strategy: 'select' }
  }
  if (group.type !== 'url-test' && group.type !== 'fallback') {
    return undefined
  }
  const { url, interval, tolerance } = group
  if (typeof url !== 'string' || typeof interval !== 'number') {
    return undefined
  }
  if (group.type === 'url-test' && tolerance !== undefined && typeof tolerance !== 'number') {
    return undefined
  }
  return {
    name,
    strategy: group.type,
    probe: {
      url,
      intervalSeconds: interval,
      ...(group.type === 'url-test' && typeof tolerance === 'number' ? { toleranceMs: tolerance } : {}),
    },
  }
}

/**
 * 从 MATCH 目标往上游追踪。每层代理必须共用同一个上游，且组成员必须是
 * 文件中可解析的具体节点，才能用编辑器的分层选择完整表示。
 */
export function readMihomoChain(
  document: Record<string, unknown>,
  proxies: YamlProxyReference[],
): ImportedMihomoChain | null | undefined {
  const rawGroups = document['proxy-groups']
  const groups = Array.isArray(rawGroups) ? rawGroups.filter(isRecord) : []
  if (!proxies.some((proxy) => hasDialer(proxy.dialer)) && !groups.some((group) => group.type === 'relay')) {
    return undefined
  }

  const rules = document.rules
  if (
    (document.mode !== undefined && document.mode !== 'rule') ||
    !Array.isArray(rules) || !rules.every((rule): rule is string => typeof rule === 'string')
  ) {
    return null
  }
  const ruleParts = rules.map((rule) => rule.split(',').map((part) => part.trim()))
  const match = ruleParts.at(-1)
  if (match?.length !== 2 || match[0] !== 'MATCH' || !match[1]) {
    return null
  }
  const cnRule = ruleParts[0]
  const cnDirect = ruleParts.length === 2 && cnRule.join(',') === 'GEOIP,CN,DIRECT'
  if (ruleParts.length !== 1 && !cnDirect) {
    return null
  }

  const proxiesByName = new Map<string, YamlProxyReference>()
  const groupsByName = new Map<string, Record<string, unknown>>()
  for (const proxy of proxies) {
    if (typeof proxy.name === 'string') {
      if (proxiesByName.has(proxy.name)) return null
      proxiesByName.set(proxy.name, proxy)
    }
  }
  for (const group of groups) {
    if (typeof group.name === 'string') {
      if (proxiesByName.has(group.name) || groupsByName.has(group.name)) return null
      groupsByName.set(group.name, group)
    }
  }

  const stages: ImportedMihomoStage[] = []
  const usedNodeIds = new Set<string>()
  let target: string | undefined = match[1]
  while (target !== undefined) {
    const group = groupsByName.get(target)
    const strategy = group ? readGroup(group, target) : { strategy: 'select' as const }
    const members = group ? group.proxies : [target]
    if (
      !strategy || !Array.isArray(members) || members.length === 0 ||
      group?.['include-all'] || group?.['include-all-proxies'] || group?.['include-all-providers'] ||
      (group?.use !== undefined && (!Array.isArray(group.use) || group.use.length > 0))
    ) {
      return null
    }

    const candidateNodeIds: string[] = []
    let upstream: unknown
    for (const member of members) {
      const proxy = typeof member === 'string' ? proxiesByName.get(member) : undefined
      if (!proxy?.nodeId || usedNodeIds.has(proxy.nodeId)) return null
      const dialer = hasDialer(proxy.dialer) ? proxy.dialer : undefined
      if (candidateNodeIds.length > 0 && dialer !== upstream) return null
      upstream = dialer
      candidateNodeIds.push(proxy.nodeId)
      usedNodeIds.add(proxy.nodeId)
    }
    if (upstream !== undefined && (typeof upstream !== 'string' || !upstream.trim())) {
      return null
    }
    stages.push({ ...strategy, candidateNodeIds })
    target = upstream
  }

  return stages.length >= 2
    ? { stages: stages.reverse(), routingPreset: cnDirect ? 'cn-direct' : 'all-proxy' }
    : null
}
