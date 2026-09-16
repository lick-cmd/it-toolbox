import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from '../bytes'
import type { Result } from '../result'

export type Base64Variant = 'standard' | 'urlsafe'

export interface Base64Options {
  /** 默认 'standard' */
  variant?: Base64Variant
  /** 是否输出 '=' 填充，默认 true */
  padding?: boolean
}

/**
 * 这层薄封装的意义在于「默认值收敛 + 语义命名」：
 *
 * - `core/bytes.ts` 是通用字节工具，`padding` / `variant` 无默认值，调用方每次都要写全；
 * - 本模块把「标准字母表 + 带填充」定为默认（与 `btoa` / `Base64` 的直觉一致），
 *   并提供 UTF-8 文本与字节两套入口，使工具层只关心「要文本还是字节」。
 *
 * 解码侧有意不接收 `variant`：`base64ToBytes` 的查表同时覆盖标准与 url-safe
 * 两套字母表，跨格式粘贴（日志、JWT、邮件）是常态。
 */
export function encodeBytes(bytes: Uint8Array, options: Base64Options = {}): string {
  return bytesToBase64(bytes, {
    variant: options.variant ?? 'standard',
    padding: options.padding ?? true,
  })
}

export function encodeText(text: string, options: Base64Options = {}): string {
  return encodeBytes(utf8ToBytes(text), options)
}

export function decodeToBytes(text: string): Result<Uint8Array> {
  return base64ToBytes(text)
}

/** 解码为 UTF-8 文本。非 UTF-8 字节序列（例如一张 PNG）会返回 BAD_UTF8。 */
export function decodeToText(text: string, options: Base64Options = {}): Result<string> {
  const bytes = base64ToBytes(text, options)
  if (!bytes.ok) return bytes
  return bytesToUtf8(bytes.value)
}
