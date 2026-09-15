/** 安全随机原语。浏览器与 Node 均提供 crypto.getRandomValues。 */

/** getRandomValues 的规范上限：单次调用不得超过 65536 字节。 */
const MAX_CHUNK = 65_536

export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError('length 必须为非负整数')
  }
  const out = new Uint8Array(length)
  for (let offset = 0; offset < length; offset += MAX_CHUNK) {
    const size = Math.min(MAX_CHUNK, length - offset)
    globalThis.crypto.getRandomValues(out.subarray(offset, offset + size))
  }
  return out
}

/**
 * 返回 [0, maxExclusive) 上的均匀随机整数。
 *
 * 刻意使用拒绝采样而非取模：`value % maxExclusive` 在 maxExclusive 不能整除
 * 2^32 时会使偏小的取值概率更高（例如 maxExclusive=3 时，0 与 1 各多出一次
 * 机会）。密码学场景下这种偏差不可接受。
 */
export function randomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError('maxExclusive 必须为正整数')
  }
  if (maxExclusive === 1) return 0

  const range = 0x1_0000_0000 // 2^32
  const limit = Math.floor(range / maxExclusive) * maxExclusive
  const buffer = new Uint32Array(1)

  for (;;) {
    globalThis.crypto.getRandomValues(buffer)
    const value = buffer[0] ?? 0
    if (value < limit) return value % maxExclusive
  }
}

/** 从字符集中等概率取 count 个字符。 */
export function pickChars(alphabet: string, count: number): string {
  const chars = [...alphabet]
  if (chars.length < 2) throw new RangeError('字符集至少需要 2 个不同字符')
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError('count 必须为非负整数')
  }
  let out = ''
  for (let i = 0; i < count; i++) {
    out += chars[randomInt(chars.length)] ?? ''
  }
  return out
}
