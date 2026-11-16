/**
 * 统一输入框的内容分派：在点击“导入”前只做本地识别，不发起任何网络请求。
 *
 * 规则（对应 UI 简化任务书 3.1）：
 * - 去除首尾空白后恰好为一个合法 http(s) 地址 → 走订阅拉取；
 * - 其余内容（节点 URI / 多行节点 / Clash YAML）→ 走本地解析；
 * - 多个订阅地址、或订阅地址与节点内容混贴 → 要求拆分，不尝试批量抓取；
 * - 空白或无法识别 → 保留输入并提示。
 *
 * 识别必须避免把 YAML 内的 url/server 字段值当成订阅地址，也不能把节点链接
 * 当成待抓取网页：因此 URI 与 YAML 的判定都基于行首协议特征与整体结构，
 * 而不是在文本中搜索 URL 子串。
 */

const HTTP_URL_RE = /^https?:\/\/[^\s]+$/i

/** 该行整体是一个受支持的节点协议链接。 */
function isNodeUriLine(line: string): boolean {
  return /^(vless|socks5?|ss|hysteria2|hy2):\/\//i.test(line)
}

/** 该行像是 YAML 结构行（键值、列表项或缩进内容）。 */
function looksLikeYamlLine(line: string): boolean {
  if (/^[-#]/.test(line)) {
    return true
  }
  // 含 "key: " 或行尾冒号的缩进/顶层键
  return /^\s*[\w."'-]+\s*:(\s|$)/.test(line)
}

export type UnifiedInputKind =
  | { kind: 'subscription-url'; url: string }
  | { kind: 'local-content'; text: string }
  | { kind: 'mixed' }
  | { kind: 'empty' }
  | { kind: 'unrecognized'; text: string }

export function classifyUnifiedInput(raw: string): UnifiedInputKind {
  const text = raw.trim()
  if (!text) {
    return { kind: 'empty' }
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  // 1. 整体恰好一个 http(s) 地址 → 订阅
  if (HTTP_URL_RE.test(text) && lines.length === 1) {
    return { kind: 'subscription-url', url: lines[0] }
  }

  // 2. 逐行拆分：统计订阅地址行 / 节点 URI 行 / YAML 结构行
  let urlLines = 0
  let uriLines = 0
  let yamlLines = 0
  for (const line of lines) {
    if (HTTP_URL_RE.test(line)) {
      urlLines += 1
    } else if (isNodeUriLine(line)) {
      uriLines += 1
    } else if (looksLikeYamlLine(line)) {
      yamlLines += 1
    }
  }

  // 节点内容（URI 或 YAML）：交给本地解析
  if (uriLines > 0 || yamlLines > 0) {
    if (urlLines > 0) {
      // 节点内容与订阅地址混贴
      return { kind: 'mixed' }
    }
    return { kind: 'local-content', text }
  }

  // 只剩“纯 URL 行”的情况：多于一个订阅地址，或唯一一行带上下文无法确定为完整地址
  if (urlLines > 0) {
    return { kind: 'mixed' }
  }

  return { kind: 'unrecognized', text }
}
