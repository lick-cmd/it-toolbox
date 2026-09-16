import { bytesToBase64 } from './bytes'

/**
 * DER 最小写入器。
 *
 * 服务 RSA 的四种导出：PKCS#1（`derInteger` / `derSequence`）、SPKI 与 PKCS#8
 * （`derInteger` / `derSequence` / `derBitString` / `derNull`——公钥要包成 BIT STRING，
 * AlgorithmIdentifier 的 parameters 是 NULL）、以及 OpenSSH 单行公钥。由 JWK 拿到全部
 * CRT 参数后**正向组装**，因此完全不需要 DER 解析器（设计文档 §3.5）。零新增依赖。
 */

/** 长度编码：< 0x80 用短形式；否则 0x80 | 字节数 + 大端长度。 */
export function derLength(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError('length 必须为非负整数')
  }
  if (length < 0x80) return new Uint8Array([length])

  const bytes: number[] = []
  let remaining = length
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining = Math.floor(remaining / 256)
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

function tlv(tag: number, content: Uint8Array): Uint8Array {
  const length = derLength(content.length)
  const out = new Uint8Array(1 + length.length + content.length)
  out[0] = tag
  out.set(length, 1)
  out.set(content, 1 + length.length)
  return out
}

/**
 * INTEGER。
 *
 * 先剥离前导 0x00（JWK 的 `n` / `e` 是有长度语义的大端字节串，可能带前导零），
 * 再在最高位为 1 时补一个 0x00 表达正数语义 —— 否则会被读成负数。零值编码为
 * `02 01 00`。
 *
 * 空输入同样按零值处理（内容为单个 0x00）：DER 要求 INTEGER 至少有一个内容字节，
 * `02 00` 是非法编码（openssl 会拒绝解析）。
 */
export function derInteger(bytes: Uint8Array): Uint8Array {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0x00) start++
  const trimmed = bytes.slice(start)

  if (trimmed.length === 0) return tlv(0x02, new Uint8Array([0x00]))

  const needsPad = ((trimmed[0] ?? 0) & 0x80) !== 0
  const content = needsPad ? new Uint8Array([0x00, ...trimmed]) : trimmed
  return tlv(0x02, content)
}

/** BIT STRING：首字节为「未使用位数」，本写入器恒为 0。 */
export function derBitString(bytes: Uint8Array): Uint8Array {
  return tlv(0x03, new Uint8Array([0x00, ...bytes]))
}

export function derNull(): Uint8Array {
  return new Uint8Array([0x05, 0x00])
}

/** SEQUENCE：子元素按序拼接为内容，再套 0x30 头。 */
export function derSequence(children: Uint8Array[]): Uint8Array {
  const total = children.reduce((sum, child) => sum + child.length, 0)
  const content = new Uint8Array(total)

  let offset = 0
  for (const child of children) {
    content.set(child, offset)
    offset += child.length
  }
  return tlv(0x30, content)
}

/** PEM：每行 64 个 Base64 字符，末尾保留换行（OpenSSL 兼容）。 */
export function bytesToPem(bytes: Uint8Array, label: string): string {
  const base64 = bytesToBase64(bytes)

  const lines: string[] = []
  for (let i = 0; i < base64.length; i += 64) lines.push(base64.slice(i, i + 64))

  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}
