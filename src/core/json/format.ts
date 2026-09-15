import { utf8ByteLength } from '../bytes'
import { ok, type Result } from '../result'
import { scanJson } from './scanner'

export type JsonIndent = 2 | 4 | 'tab'

export interface FormatJsonOptions {
  indent?: JsonIndent
  sortKeys?: boolean
}

export interface FormatJsonResult {
  output: string
  inputBytes: number
  outputBytes: number
  /** 键排序模式下转义可能被规范化，界面须据此提示用户 */
  normalizedEscapes: boolean
}

const CLOSERS = new Set(['}', ']'])

function indentUnit(indent: JsonIndent): string {
  return indent === 'tab' ? '\t' : ' '.repeat(indent)
}

/**
 * 逐 token 重排缩进：字符串 token 原样输出，因此转义字面量不被规范化。
 *
 * 例外：开启键排序时必须在值对象层重建，无法在 token 层完成，
 * 此时退化为 parse + stringify 并置 normalizedEscapes。
 */
export function formatJson(
  text: string,
  options: FormatJsonOptions = {},
): Result<FormatJsonResult> {
  const { indent = 2, sortKeys = false } = options

  const scanned = scanJson(text)
  if (!scanned.ok) return scanned

  const inputBytes = utf8ByteLength(text)

  if (sortKeys) {
    // 已由 scanJson 严格校验，故此处的 JSON.parse 不会抛错
    const parsed: unknown = JSON.parse(text)
    const output = JSON.stringify(sortDeep(parsed), null, indentUnit(indent))
    return ok({
      output,
      inputBytes,
      outputBytes: utf8ByteLength(output),
      normalizedEscapes: true,
    })
  }

  const unit = indentUnit(indent)
  const tokens = scanned.tokens
  let output = ''
  let depth = 0

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    const previous = tokens[i - 1]
    const next = tokens[i + 1]

    if (token.kind === 'punct') {
      if (CLOSERS.has(token.raw)) {
        depth = Math.max(0, depth - 1)
        // 空容器写成 {} / []，不展开换行
        const isTightEmpty =
          previous !== undefined && (previous.raw === '{' || previous.raw === '[')
        output += isTightEmpty ? '' : '\n' + unit.repeat(depth)
        output += token.raw
        continue
      }

      if (token.raw === '{' || token.raw === '[') {
        output += token.raw
        depth++
        const isTightEmpty = next !== undefined && CLOSERS.has(next.raw)
        if (!isTightEmpty) output += '\n' + unit.repeat(depth)
        continue
      }

      if (token.raw === ',') {
        output += ',\n' + unit.repeat(depth)
        continue
      }

      if (token.raw === ':') {
        output += ': '
        continue
      }
    }

    output += token.raw
  }

  return ok({
    output,
    inputBytes,
    outputBytes: utf8ByteLength(output),
    normalizedEscapes: false,
  })
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortDeep(source[key])
    }
    return sorted
  }
  return value
}
