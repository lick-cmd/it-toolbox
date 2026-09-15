import type { ErrorInfo } from '../result'

export interface JsonToken {
  kind: 'punct' | 'string' | 'number' | 'literal'
  /** 原文切片，含引号与转义，**原样保留不做规范化** */
  raw: string
  start: number
  end: number
}

export type ScanResult = { ok: true; tokens: JsonToken[] } | ({ ok: false } & ErrorInfo)

const WHITESPACE = new Set([' ', '\t', '\n', '\r'])
const VALID_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'])

/** 将字符偏移换算为 1 基的行号与列号。 */
export function positionToLineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length))
  let line = 1
  let lineStart = 0
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: clamped - lineStart + 1 }
}

interface Failure {
  error: string
  code: string
  at: number
  detail?: string
}

/**
 * 严格按 RFC 8259 扫描并校验 JSON，同时产出 token 序列。
 *
 * 之所以不用 JSON.parse：其报错信息在 V8 与 JavaScriptCore 上格式不同，
 * WKWebView 甚至不提供出错位置，无法满足「指出行号列号」的要求。
 */
export function scanJson(text: string): ScanResult {
  const tokens: JsonToken[] = []
  let pos = 0

  const fail = (f: Failure): ScanResult => ({
    ok: false,
    error: f.error,
    code: f.code,
    detail: f.detail,
    offset: f.at,
    ...positionToLineColumn(text, f.at),
  })

  const skipWhitespace = (): void => {
    while (pos < text.length && WHITESPACE.has(text.charAt(pos))) pos++
  }

  const push = (kind: JsonToken['kind'], start: number): void => {
    tokens.push({ kind, raw: text.slice(start, pos), start, end: pos })
  }

  /**
   * 容器尚未闭合时输入就结束。
   *
   * 与顶层的 `UNEXPECTED_EOF`（输入为空）区分开：此处位置是容器内真正缺东西的地方，
   * 若沿用 EXPECTED_COMMA_OR_END 之类会把「未闭合」误诊为「分隔符写错了」。
   */
  const unclosed = (at: number, expected: string): Failure => ({
    error: '输入在容器内意外结束',
    code: 'UNCLOSED',
    at,
    detail: `缺少 ${expected}`,
  })

  const parseString = (): Failure | null => {
    const start = pos
    pos++ // 开引号
    while (pos < text.length) {
      const ch = text.charAt(pos)
      if (ch === '"') {
        pos++
        push('string', start)
        return null
      }
      if (ch === '\\') {
        const escape = text.charAt(pos + 1)
        if (!VALID_ESCAPES.has(escape)) {
          // 偏移指向反斜杠之后的那个字符 —— 它才是真正不合法的东西
          return {
            error: '非法的转义序列',
            code: 'BAD_ESCAPE',
            at: pos + 1,
            detail: `"\\${escape}" 不是合法的 JSON 转义`,
          }
        }
        if (escape === 'u') {
          const hex = text.slice(pos + 2, pos + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            return {
              error: '\\u 转义必须紧跟 4 位十六进制数字',
              code: 'BAD_UNICODE_ESCAPE',
              at: pos + 1,
              detail: `实际内容为 "${hex}"`,
            }
          }
          pos += 6
        } else {
          pos += 2
        }
        continue
      }
      if (ch.charCodeAt(0) < 0x20) {
        return {
          error: '字符串中不允许出现未转义的控制字符',
          code: 'RAW_CONTROL_CHAR',
          at: pos,
          detail: '请改用 \\n、\\t 等转义写法',
        }
      }
      pos++
    }
    return { error: '字符串未闭合', code: 'UNTERMINATED_STRING', at: start }
  }

  const parseNumber = (): Failure | null => {
    const start = pos
    if (text.charAt(pos) === '-') pos++
    if (text.charAt(pos) === '0') {
      pos++
      // JSON 不允许前导零
      if (/[0-9]/.test(text.charAt(pos))) {
        return {
          error: '数字不允许前导零',
          code: 'BAD_NUMBER',
          at: pos,
          detail: '请去掉多余的前导 0',
        }
      }
    } else if (/[1-9]/.test(text.charAt(pos))) {
      while (/[0-9]/.test(text.charAt(pos))) pos++
    } else {
      return { error: '数字格式非法', code: 'BAD_NUMBER', at: start }
    }
    if (text.charAt(pos) === '.') {
      // 先记下小数点自身的位置再消费，否则报错偏移会落到它之后
      const dotPos = pos
      pos++
      if (!/[0-9]/.test(text.charAt(pos))) {
        return {
          error: '小数点后必须有数字',
          code: 'BAD_NUMBER',
          at: dotPos,
          detail: '如 1.0，而非 1.',
        }
      }
      while (/[0-9]/.test(text.charAt(pos))) pos++
    }
    if (text.charAt(pos) === 'e' || text.charAt(pos) === 'E') {
      pos++
      if (text.charAt(pos) === '+' || text.charAt(pos) === '-') pos++
      if (!/[0-9]/.test(text.charAt(pos))) {
        return {
          error: '指数部分必须有数字',
          code: 'BAD_NUMBER',
          at: pos,
          detail: '如 1e10，而非 1e',
        }
      }
      while (/[0-9]/.test(text.charAt(pos))) pos++
    }
    push('number', start)
    return null
  }

  const parseLiteral = (): Failure | null => {
    for (const literal of ['true', 'false', 'null'] as const) {
      if (text.startsWith(literal, pos)) {
        const start = pos
        pos += literal.length
        push('literal', start)
        return null
      }
    }
    return {
      error: '无法识别的字面量',
      code: 'UNEXPECTED_CHAR',
      at: pos,
      detail: `期望 true、false 或 null，实际为 "${text.slice(pos, pos + 8)}"`,
    }
  }

  const parseValue = (): Failure | null => {
    skipWhitespace()
    if (pos >= text.length) {
      // 顶层为空的情况已在 scanJson 入口拦下，故走到这里必然处于容器内部
      return unclosed(pos, '值')
    }
    const ch = text.charAt(pos)

    if (ch === '{') {
      const start = pos
      pos++
      push('punct', start)
      skipWhitespace()
      if (text.charAt(pos) === '}') {
        const end = pos
        pos++
        push('punct', end)
        return null
      }
      for (;;) {
        skipWhitespace()
        if (text.charAt(pos) !== '"') {
          if (text.charAt(pos) === '}') {
            return {
              error: '对象中出现尾随逗号',
              code: 'TRAILING_COMMA',
              at: pos,
              detail: 'JSON 不允许尾随逗号',
            }
          }
          if (pos >= text.length) return unclosed(pos, '键')
          return {
            error: '对象的键必须是双引号字符串',
            code: 'UNQUOTED_KEY',
            at: pos,
            detail: 'JSON 的键不支持单引号或无引号写法',
          }
        }
        const keyFailure = parseString()
        if (keyFailure) return keyFailure
        skipWhitespace()
        if (text.charAt(pos) !== ':') {
          if (pos >= text.length) return unclosed(pos, '冒号')
          return { error: '键之后应为冒号', code: 'EXPECTED_COLON', at: pos }
        }
        const colonStart = pos
        pos++
        push('punct', colonStart)
        const valueFailure = parseValue()
        if (valueFailure) return valueFailure
        skipWhitespace()
        const next = text.charAt(pos)
        if (next === ',') {
          const commaStart = pos
          pos++
          push('punct', commaStart)
          continue
        }
        if (next === '}') {
          const end = pos
          pos++
          push('punct', end)
          return null
        }
        if (pos >= text.length) return unclosed(pos, '逗号或 "}"')
        return {
          error: '属性之间应为逗号或对象结束',
          code: 'EXPECTED_COMMA_OR_END',
          at: pos,
          detail: `实际字符为 "${next}"`,
        }
      }
    }

    if (ch === '[') {
      const start = pos
      pos++
      push('punct', start)
      skipWhitespace()
      if (text.charAt(pos) === ']') {
        const end = pos
        pos++
        push('punct', end)
        return null
      }
      for (;;) {
        const elementFailure = parseValue()
        if (elementFailure) return elementFailure
        skipWhitespace()
        const next = text.charAt(pos)
        if (next === ',') {
          const commaStart = pos
          pos++
          push('punct', commaStart)
          skipWhitespace()
          if (text.charAt(pos) === ']') {
            return {
              error: '数组中出现尾随逗号',
              code: 'TRAILING_COMMA',
              at: pos,
              detail: 'JSON 不允许尾随逗号',
            }
          }
          continue
        }
        if (next === ']') {
          const end = pos
          pos++
          push('punct', end)
          return null
        }
        if (pos >= text.length) return unclosed(pos, '逗号或 "]"')
        return {
          error: '数组元素之间应为逗号或数组结束',
          code: 'EXPECTED_COMMA_OR_END',
          at: pos,
          detail: `实际字符为 "${next}"`,
        }
      }
    }

    if (ch === '"') return parseString()
    // 前导 '+' 也交给数字分支，以便给出 BAD_NUMBER 而非笼统的 UNEXPECTED_CHAR
    if (ch === '-' || ch === '+' || /[0-9]/.test(ch)) return parseNumber()
    if (/[a-zA-Z]/.test(ch)) return parseLiteral()

    return {
      error: '无法识别的字符',
      code: 'UNEXPECTED_CHAR',
      at: pos,
      detail: `"${ch}" 不是合法的 JSON 起始字符`,
    }
  }

  skipWhitespace()
  if (pos >= text.length) {
    // 偏移取「跳过空白后耗尽输入的位置」：空输入得 0，仅空白得其长度
    return fail({ error: '输入为空', code: 'UNEXPECTED_EOF', at: pos })
  }

  const valueFailure = parseValue()
  if (valueFailure) return fail(valueFailure)

  skipWhitespace()
  if (pos < text.length) {
    return fail({
      error: 'JSON 结束后存在多余内容',
      code: 'TRAILING_CONTENT',
      at: pos,
      detail: `多余内容为 "${text.slice(pos, pos + 16)}"`,
    })
  }

  return { ok: true, tokens }
}
