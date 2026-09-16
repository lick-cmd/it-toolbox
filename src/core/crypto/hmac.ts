import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, utf8ToBytes } from '../bytes'
import { err, ok } from '../result'
import type { Result } from '../result'

export type HmacAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'
export type InputEncoding = 'utf8' | 'hex' | 'base64'
export type OutputEncoding = 'hex' | 'base64' | 'base64url'

export interface HmacOptions {
  message: string
  key: string
  algorithm: HmacAlgorithm
  messageEncoding: InputEncoding
  keyEncoding: InputEncoding
  outputEncoding: OutputEncoding
}

/**
 * 按给定编码把文本还原为字节。
 *
 * 密钥与消息都是**自由文本输入**，非法 hex / base64 是常规路径，故返回 Result
 * 而不是抛错 —— 与 `bytes.ts` 的 `hexToBytes` / `base64ToBytes` 保持一致。
 */
export function decodeInput(text: string, encoding: InputEncoding): Result<Uint8Array> {
  switch (encoding) {
    case 'utf8':
      return ok(utf8ToBytes(text))
    case 'hex':
      return hexToBytes(text)
    case 'base64':
      return base64ToBytes(text)
  }
}

function encodeOutput(bytes: Uint8Array, encoding: OutputEncoding): string {
  switch (encoding) {
    case 'hex':
      return bytesToHex(bytes)
    case 'base64':
      return bytesToBase64(bytes)
    case 'base64url':
      // Base64URL 的规范形式不带 '=' 填充（与 JWT 的既有惯例一致）
      return bytesToBase64(bytes, { variant: 'urlsafe', padding: false })
  }
}

export async function computeHmac(options: HmacOptions): Promise<Result<string>> {
  const { message, key, algorithm, messageEncoding, keyEncoding, outputEncoding } = options

  // 空密钥必须在解码之前拦住：hex 编码下 '' 会被解码成合法的空字节序列
  if (key.length === 0) {
    return err('密钥不可为空', {
      code: 'EMPTY_KEY',
      suggestion: '填入任意长度的密钥文本，或切换为十六进制 / Base64 编码后填入字节',
    })
  }

  const keyBytes = decodeInput(key, keyEncoding)
  if (!keyBytes.ok) {
    return err(`密钥格式非法：${keyBytes.error}`, {
      code: 'BAD_KEY',
      detail: keyBytes.detail,
      offset: keyBytes.offset,
    })
  }

  const messageBytes = decodeInput(message, messageEncoding)
  if (!messageBytes.ok) {
    return err(`消息格式非法：${messageBytes.error}`, {
      code: 'BAD_MESSAGE',
      detail: messageBytes.detail,
      offset: messageBytes.offset,
    })
  }

  // new Uint8Array(...) 只是为过 TS 的类型：bytes.ts 的解码器返回 Uint8Array<ArrayBufferLike>，
  // 而 WebCrypto 的 BufferSource 在 TS 5.7+ 要求 Uint8Array<ArrayBuffer>。运行期两者本可互传
  // （解码器返回的都是新建数组，不是 SharedArrayBuffer 支撑的视图），故这次复制是语义上的空操作。
  // 按计划要求用显式复制，而不是 as any / @ts-expect-error 绕过类型。
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    new Uint8Array(keyBytes.value),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  )
  const digest = await globalThis.crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    new Uint8Array(messageBytes.value),
  )

  return ok(encodeOutput(new Uint8Array(digest), outputEncoding))
}
