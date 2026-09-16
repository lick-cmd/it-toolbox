import { bytesToBase64 } from './bytes'

/**
 * OpenSSH 单行公钥的组装（RFC 4253 §6.6）。
 *
 * 只做公钥：OpenSSH 私钥涉及 `openssh-key-v1` 容器与 bcrypt-pbkdf，本 change 明确不含。
 */

/** `string` 与 `mpint` 共用的长度前缀：uint32 大端。 */
export function sshString(bytes: Uint8Array): Uint8Array {
  const length = bytes.length
  const out = new Uint8Array(4 + length)
  out[0] = (length >>> 24) & 0xff
  out[1] = (length >>> 16) & 0xff
  out[2] = (length >>> 8) & 0xff
  out[3] = length & 0xff
  out.set(bytes, 4)
  return out
}

/**
 * `mpint`（RFC 4251 §5）：有符号的大端补码整数。
 *
 * 与 DER INTEGER 的正数处理一致：先剥前导 0x00，再在最高位为 1 时补一个 0x00。
 * 少了这一步，高位为 1 的模数会被对端读成负数。零值按 RFC 编码为空内容。
 */
export function sshMpint(bytes: Uint8Array): Uint8Array {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0x00) start++
  const trimmed = bytes.slice(start)

  const needsPad = trimmed.length > 0 && ((trimmed[0] ?? 0) & 0x80) !== 0
  return sshString(needsPad ? new Uint8Array([0x00, ...trimmed]) : trimmed)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)

  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** RSA 公钥 → 单行 `ssh-rsa AAAA…`（含结尾换行，整行不折行）。 */
export function sshRsaPublicKey(modulus: Uint8Array, exponent: Uint8Array): string {
  const blob = concat([
    sshString(new TextEncoder().encode('ssh-rsa')),
    sshMpint(exponent),
    sshMpint(modulus),
  ])

  return `ssh-rsa ${bytesToBase64(blob)}\n`
}
