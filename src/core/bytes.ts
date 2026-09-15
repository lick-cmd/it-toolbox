import { err, ok } from './result'
import type { Result } from './result'

const HEX_CHARS = /^[0-9a-fA-F]*$/

const B64_STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_URLSAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/**
 * 字符到 6 位值的查表。-1 表示非法字符。
 * 同时接受标准与 url-safe 两套字母表，使跨格式粘贴可直接解码。
 */
const B64_LOOKUP: number[] = (() => {
  const table = new Array<number>(128).fill(-1)
  for (let i = 0; i < B64_STANDARD.length; i++) {
    table[B64_STANDARD.charCodeAt(i)] = i
  }
  table['-'.charCodeAt(0)] = 62
  table['_'.charCodeAt(0)] = 63
  return table
})()

export interface Base64Options {
  /** 默认 'standard' */
  variant?: 'standard' | 'urlsafe'
  /** 是否输出 '=' 填充，默认 true */
  padding?: boolean
}

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function bytesToUtf8(bytes: Uint8Array): Result<string> {
  try {
    // fatal: 非法字节序列抛错而非静默替换为 U+FFFD，便于向上报告
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return err('字节序列不是合法的 UTF-8 文本', { code: 'BAD_UTF8' })
  }
}

export function bytesToHex(bytes: Uint8Array, upper = false): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return upper ? out.toUpperCase() : out
}

/**
 * 字符串的 UTF-8 字节数。
 *
 * 不能用 `String.length`：它统计的是 UTF-16 码元，中文与 emoji 会显著偏大，
 * 而 spec 要求展示的是「字节数」。
 */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

export function hexToBytes(hex: string): Result<Uint8Array> {
  const cleaned = hex.replace(/\s+/g, '')
  if (cleaned.length === 0) return ok(new Uint8Array(0))

  if (!HEX_CHARS.test(cleaned)) {
    const bad = cleaned.search(/[^0-9a-fA-F]/)
    return err('包含非十六进制字符', {
      code: 'BAD_HEX_CHAR',
      offset: bad,
      detail: `位置 ${bad} 的字符是 "${cleaned.charAt(bad)}"`,
    })
  }

  if (cleaned.length % 2 !== 0) {
    return err('十六进制字符串长度必须为偶数', {
      code: 'BAD_HEX_LENGTH',
      detail: `当前长度为 ${cleaned.length}`,
    })
  }

  const out = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  }
  return ok(out)
}

export function bytesToBase64(bytes: Uint8Array, options: Base64Options = {}): string {
  const { variant = 'standard', padding = true } = options
  const alphabet = variant === 'urlsafe' ? B64_URLSAFE : B64_STANDARD

  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0)

    out += alphabet.charAt((triple >> 18) & 63)
    out += alphabet.charAt((triple >> 12) & 63)
    out +=
      b1 === undefined ? (padding ? '=' : '') : alphabet.charAt((triple >> 6) & 63)
    out += b2 === undefined ? (padding ? '=' : '') : alphabet.charAt(triple & 63)
  }
  return out
}

/**
 * 解码 Base64。
 *
 * `_options` 有意不使用：解码侧的 `B64_LOOKUP` 同时接受标准与 url-safe 两套字母表
 * （跨格式粘贴是常态），填充亦被容忍，故 `variant` / `padding` 对解码结果没有影响。
 * 参数保留在签名里只为与 `bytesToBase64` 对称，并以 `_` 前缀表达「有意忽略」。
 */
export function base64ToBytes(input: string, _options: Base64Options = {}): Result<Uint8Array> {
  // 宽松输入：剥离空白。从日志、邮件、JWT 粘贴时几乎必然带换行。
  const cleaned = input.replace(/\s+/g, '')
  if (cleaned.length === 0) return ok(new Uint8Array(0))

  const body = cleaned.replace(/=+$/, '')
  const paddingLength = cleaned.length - body.length
  if (paddingLength > 2) {
    return err('Base64 填充字符过多', { code: 'BAD_BASE64_PADDING' })
  }

  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i)
    const value = code < 128 ? B64_LOOKUP[code] : -1
    if (value === undefined || value === -1) {
      return err('包含非 Base64 字符', {
        code: 'BAD_BASE64_CHAR',
        offset: i,
        detail: `位置 ${i} 的字符是 "${body.charAt(i)}"`,
      })
    }
  }

  if (body.length % 4 === 1) {
    return err('Base64 数据长度非法', {
      code: 'BAD_BASE64_LENGTH',
      detail: '有效字符数除以 4 余 1，不可能是合法的 Base64',
    })
  }

  const out = new Uint8Array(Math.floor((body.length * 6) / 8))
  let accumulator = 0
  let bits = 0
  let cursor = 0

  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i)
    accumulator = (accumulator << 6) | (B64_LOOKUP[code] ?? 0)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[cursor++] = (accumulator >> bits) & 0xff
    }
  }

  return ok(out)
}
