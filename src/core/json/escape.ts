import { scanJson } from './scanner'

export type UnicodeMode = 'keep' | 'escape' | 'unescape'

export interface RewriteOptions {
  /** true = 规范化最小转义；false = 原样保留（默认行为） */
  normalizeEscapes: boolean
  unicode: UnicodeMode
}

/** 码点 → JSON 短转义。只有这些控制字符有短写法 */
const SHORT_ESCAPES: Record<number, string> = {
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
}

/** 四位小写十六进制。十六进制一律小写是 spec 的硬约定 */
function hex4(code: number): string {
  return code.toString(16).padStart(4, '0').toLowerCase()
}

/**
 * 规范化 ASCII 可打印区的转义写法。
 *
 * 作用域**只到 0x7f**：码点 ≥ 0x80 的 `\uXXXX` 一律不动，交给 `convertUnicodeInString`。
 * 两者作用域不相交，因此可以任意组合、顺序无关（实现上固定先跑本函数）。
 *
 * `\u0022` 与 `\u005c` 必须转成 `\"` / `\\` 而**不能**直出裸引号或裸反斜杠 ——
 * 直出会产出非法 JSON。
 */
export function normalizeEscapesInString(content: string): string {
  let out = ''
  let i = 0

  while (i < content.length) {
    const ch = content.charAt(i)
    if (ch !== '\\') {
      out += ch
      i++
      continue
    }

    const next = content.charAt(i + 1)

    if (next === '/') {
      out += '/'
      i += 2
      continue
    }

    if (next === 'u') {
      const hex = content.slice(i + 2, i + 6)
      const code = parseInt(hex, 16)

      if (code === 0x22) {
        out += '\\"'
        i += 6
        continue
      }
      if (code === 0x5c) {
        out += '\\\\'
        i += 6
        continue
      }
      if (code < 0x20) {
        out += SHORT_ESCAPES[code] ?? `\\u${hex4(code)}`
        i += 6
        continue
      }
      if (code < 0x7f) {
        out += String.fromCharCode(code)
        i += 6
        continue
      }
      // 0x7f（DEL）与 ≥ 0x80：不动
      out += content.slice(i, i + 6)
      i += 6
      continue
    }

    // 其余转义（\" \\ \b \f \n \r \t）已是最小写法，连同后一个字符原样跳过。
    // 这一步同时保证 `\\u0041` 里的 u 不会被误当成转义起点
    out += ch + next
    i += 2
  }

  return out
}

/** 非 ASCII 码点 → \uXXXX（BMP 外拆成一对代理）。按码点遍历，`for...of` 正好 */
function escapeNonAscii(content: string): string {
  let out = ''
  for (const ch of content) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x80) {
      out += ch
      continue
    }
    if (code <= 0xffff) {
      out += `\\u${hex4(code)}`
      continue
    }
    const offset = code - 0x10000
    out += `\\u${hex4(0xd800 + (offset >> 10))}\\u${hex4(0xdc00 + (offset & 0x3ff))}`
  }
  return out
}

/** \uXXXX（非 ASCII）→ 真实字符。成对代理合并，孤立代理保持原样 */
function unescapeNonAscii(content: string): string {
  let out = ''
  let i = 0

  while (i < content.length) {
    const ch = content.charAt(i)
    const next = content.charAt(i + 1)

    if (ch !== '\\') {
      out += ch
      i++
      continue
    }

    if (next !== 'u') {
      // 其它转义（含 `\\`）连同其后一个字符原样跳过：这一步保证 `\\u4e2d` 里的
      // u 不会被误判为转义起点。注意不能把「ch 不是反斜杠」和「next 不是 u」
      // 并成一个条件 —— 那样 `a\u4e2d` 里的 a 会把反斜杠一起吞掉
      out += next === '' ? ch : ch + next
      i += next === '' ? 1 : 2
      continue
    }

    const hex = content.slice(i + 2, i + 6)
    const code = parseInt(hex, 16)

    if (code < 0x80) {
      // 归规范化那一支管；在这里还原 \u0022 会产出非法 JSON
      out += content.slice(i, i + 6)
      i += 6
      continue
    }

    if (code >= 0xd800 && code <= 0xdbff) {
      const following = content.slice(i + 6, i + 12)
      if (/^\\u[0-9a-fA-F]{4}$/.test(following)) {
        const low = parseInt(following.slice(2), 16)
        if (low >= 0xdc00 && low <= 0xdfff) {
          out += String.fromCodePoint(0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00))
          i += 12
          continue
        }
      }
      out += content.slice(i, i + 6)
      i += 6
      continue
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      // 孤立低代理
      out += content.slice(i, i + 6)
      i += 6
      continue
    }

    out += String.fromCharCode(code)
    i += 6
  }

  return out
}

export function convertUnicodeInString(content: string, mode: UnicodeMode): string {
  if (mode === 'escape') return escapeNonAscii(content)
  if (mode === 'unescape') return unescapeNonAscii(content)
  return content
}

/**
 * 重写一个字符串 token。
 *
 * 入参与出参都是**含引号的 raw**（与 `JsonToken.raw` 同口径），引号本身不加不改。
 */
export function rewriteStringToken(raw: string, options: RewriteOptions): string {
  const { normalizeEscapes, unicode } = options
  if (!normalizeEscapes && unicode === 'keep') return raw

  let content = raw.slice(1, -1)
  if (normalizeEscapes) content = normalizeEscapesInString(content)
  if (unicode !== 'keep') content = convertUnicodeInString(content, unicode)
  return `"${content}"`
}

/**
 * 对整段 JSON 文本里的所有字符串 token 做重写，其余字符原样保留。
 *
 * 键排序路径（`format.ts` 的 `parse + JSON.stringify`）靠它把转义风格拉回与
 * 逐 token 路径一致；文本无法解析时原样返回，不抛异常。
 */
export function rewriteAllStringTokens(text: string, options: RewriteOptions): string {
  if (!options.normalizeEscapes && options.unicode === 'keep') return text

  const scanned = scanJson(text)
  if (!scanned.ok) return text

  let out = ''
  let cursor = 0
  for (const token of scanned.tokens) {
    if (token.kind !== 'string') continue
    out += text.slice(cursor, token.start)
    out += rewriteStringToken(token.raw, options)
    cursor = token.end
  }
  return out + text.slice(cursor)
}
