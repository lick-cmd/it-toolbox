import { ok, type Result } from '../result'
import { indentUnit, type JsonIndent } from '../json/format'
import { buildJsonNodes, type JsonNode } from '../json/nodes'

export interface JsonToJsOptions {
  /** 默认 2 */
  indent?: JsonIndent
}

/**
 * JSON → JS 对象字面量。
 *
 * 结构、数字原文与字符串字面量全部取自 token：`12345678912345678` 不会被取整，
 * `-0` / `1e2` 保持原写法，重复键各自保留一 `pair`。
 * 字符串直接复用 JSON 原文 —— JSON 的字符串字面量是 JS 字符串字面量的子集，
 * 且 `\/`、`\uXXXX` 在两边语义一致。
 *
 * 刻意不提供 `keepEscapes` / `unicode`：转换器界面不暴露这两个开关
 * （它们属于 json-format），在此只会成为无法触达的死参数。
 */
export function jsonToJs(text: string, options: JsonToJsOptions = {}): Result<string> {
  if (text.trim().length === 0) return ok('')

  const built = buildJsonNodes(text)
  if (!built.ok) return built

  const unit = indentUnit(options.indent ?? 2)
  return ok(`const data = ${emit(built.value, unit, '')};`)
}

function emit(node: JsonNode, unit: string, indent: string): string {
  if (node.kind === 'object') {
    if (node.entries.length === 0) return '{}'
    const inner = indent + unit
    const body = node.entries
      .map((entry) => `${inner}${entry.rawKey}: ${emit(entry.value, unit, inner)}`)
      .join(',\n')
    return `{\n${body}\n${indent}}`
  }

  if (node.kind === 'array') {
    if (node.items.length === 0) return '[]'
    const inner = indent + unit
    const body = node.items.map((item) => `${inner}${emit(item, unit, inner)}`).join(',\n')
    return `[\n${body}\n${indent}]`
  }

  return node.raw
}
