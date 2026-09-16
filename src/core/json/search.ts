import { scanJson, positionToLineColumn } from './scanner'

export interface JsonSearchMatch {
  /** 命中片段在文本中的起始偏移（含） */
  start: number
  /** 命中片段在文本中的结束偏移（不含） */
  end: number
  /** 命中所在行（1 基） */
  line: number
  /** 命中所在列（1 基） */
  column: number
  /** 命中来自键还是值；降级为纯文本搜索时统一记为 'value' */
  field: 'key' | 'value'
}

export interface JsonSearchOptions {
  /** 是否区分大小写，默认 false */
  caseSensitive?: boolean
}

/**
 * 搜索范围只覆盖「键与值」。
 *
 * string / number / literal 三类 token 才是键或值；标点（`{}[],:`）与空白直接跳过，
 * 于是搜索 `{`、`,` 不会命中结构符号 —— 这正是需求里「搜索键和值」的语义。
 * 字符串 token 后面紧跟 `:` 的视为键（JSON 里只有键后面会是冒号），其余是值。
 */
const SEARCHABLE_KINDS = new Set(['string', 'number', 'literal'])

function buildPattern(query: string, caseSensitive: boolean): RegExp {
  // 关键词按字面量匹配：把正则元字符转义掉，`$`、`[` 这类键名才不会被当成语法
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped, caseSensitive ? 'g' : 'gi')
}

/**
 * 行 / 列换算器。
 *
 * 命中区间按顺序产生，故用「只向前扫描」的游标累计换行，整体只扫一遍文本；
 * 若调用方给出乱序偏移（降级分支以外不该发生）则退回精确计算兜底。
 */
function makeLocator(text: string): (offset: number) => { line: number; column: number } {
  let line = 1
  let lineStart = 0
  let scanned = 0

  return (offset: number) => {
    if (offset < scanned) return positionToLineColumn(text, offset)
    for (let index = scanned; index < offset; index++) {
      if (text.charCodeAt(index) === 10) {
        line++
        lineStart = index + 1
      }
    }
    scanned = offset
    return { line, column: offset - lineStart + 1 }
  }
}

function collect(
  text: string,
  pattern: RegExp,
  locate: (offset: number) => { line: number; column: number },
  from: number,
  to: number,
  field: 'key' | 'value',
): JsonSearchMatch[] {
  const matches: JsonSearchMatch[] = []
  const haystack = text.slice(from, to)
  pattern.lastIndex = 0

  let found: RegExpExecArray | null
  while ((found = pattern.exec(haystack)) !== null) {
    const start = from + found.index
    const end = start + found[0].length
    matches.push({ start, end, field, ...locate(start) })
  }

  return matches
}

/**
 * 在（美化后的）JSON 文本里按「键与值」搜索。
 *
 * 文本无法解析时降级为整段纯文本搜索：JSON 美化的预览超过上限会被截断，
 * 那份文本本就不是合法 JSON —— 此时若直接返回空结果，用户会以为「搜不到」，
 * 而降级至少还能在已显示的内容里定位。
 */
export function searchJson(
  text: string,
  query: string,
  options: JsonSearchOptions = {},
): JsonSearchMatch[] {
  if (query.length === 0) return []

  const caseSensitive = options.caseSensitive ?? false
  const pattern = buildPattern(query, caseSensitive)
  const locate = makeLocator(text)
  const scanned = scanJson(text)
  const matches: JsonSearchMatch[] = []

  if (!scanned.ok) return collect(text, pattern, locate, 0, text.length, 'value')

  const tokens = scanned.tokens
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token === undefined || !SEARCHABLE_KINDS.has(token.kind)) continue

    // 字符串 token 的引号本身不是内容，只在引号之间找；键与值的判定看后面是不是冒号
    const isKey = token.kind === 'string' && tokens[index + 1]?.raw === ':'
    const from = token.kind === 'string' ? token.start + 1 : token.start
    const to = token.kind === 'string' ? token.end - 1 : token.end

    // 引号相贴的空字符串（`""`）没有内容，from 会越过 to
    if (from >= to) continue

    matches.push(...collect(text, pattern, locate, from, to, isKey ? 'key' : 'value'))
  }

  return matches
}
