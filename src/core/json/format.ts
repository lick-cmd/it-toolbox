import { utf8ByteLength } from '../bytes'
import { ok, type Result } from '../result'
import { rewriteAllStringTokens, rewriteStringToken, type UnicodeMode } from './escape'
import { scanJson } from './scanner'

export type JsonIndent = 2 | 4 | 'tab'

export interface FormatJsonOptions {
  indent?: JsonIndent
  sortKeys?: boolean
  /** true（默认）= 保留输入中的转义写法；false = 规范化最小转义 */
  keepEscapes?: boolean
  /** 默认 'keep'。作用域仅非 ASCII，与 keepEscapes 正交 */
  unicode?: UnicodeMode
}

export interface FormatJsonResult {
  output: string
  inputBytes: number
  outputBytes: number
  /** 实际发生了转义改写（键排序路径，或关闭 keepEscapes / 开启 unicode），界面须据此提示用户 */
  normalizedEscapes: boolean
}

const CLOSERS = new Set(['}', ']'])

/** 缩进单元。对外导出是因为 js / php / xml 生成器要用同一套换算 */
export function indentUnit(indent: JsonIndent): string {
  return indent === 'tab' ? '\t' : ' '.repeat(indent)
}

/**
 * 逐 token 重排缩进：字符串 token 默认原样输出，因此转义字面量不被规范化。
 *
 * 例外：开启键排序时必须在值对象层重建，无法在 token 层完成，
 * 此时退化为 parse + stringify，再对结果文本补跑一遍 token 重写以统一转义风格。
 */
export function formatJson(
  text: string,
  options: FormatJsonOptions = {},
): Result<FormatJsonResult> {
  const { indent = 2, sortKeys = false, keepEscapes = true, unicode = 'keep' } = options

  const scanned = scanJson(text)
  if (!scanned.ok) return scanned

  const inputBytes = utf8ByteLength(text)

  // 对外的 keepEscapes 与 escape.ts 内部的 normalizeEscapes **极性相反**，
  // 转换只在此处发生一次，不要把 keepEscapes 直接传进 rewriteStringToken
  const rewrite = { normalizeEscapes: !keepEscapes, unicode }
  const rewritten = !keepEscapes || unicode !== 'keep'

  if (sortKeys) {
    // 已由 scanJson 严格校验，故此处的 JSON.parse 不会抛错
    const parsed: unknown = JSON.parse(text)
    const rebuilt = JSON.stringify(sortDeep(parsed), null, indentUnit(indent))
    // 重建会把转义统一成 JSON.stringify 的风格；再跑一遍 token 重写，
    // 使这条路径与逐 token 路径在开启选项后给出同一种写法
    const output = rewritten ? rewriteAllStringTokens(rebuilt, rewrite) : rebuilt
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

    output += token.kind === 'string' ? rewriteStringToken(token.raw, rewrite) : token.raw
  }

  return ok({
    output,
    inputBytes,
    outputBytes: utf8ByteLength(output),
    normalizedEscapes: rewritten,
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
