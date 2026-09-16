import { randomBytes } from '../random'

export interface UlidOptions {
  count: number
  /** 默认 true：ULID 的规范写法是大写 */
  uppercase?: boolean
}

/** Crockford Base32：去掉易混的 I / L / O / U，共 32 个字符。 */
export const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export const MAX_COUNT = 1_000

/** 时间部分 10 字符 = 50 位，其中高位只承载 48 位真实时间戳。 */
const TIME_CHARS = 10
/** 随机部分 16 字符 = 80 位。 */
const RANDOM_CHARS = 16
const RANDOM_BYTES = 10
const ULID_LENGTH = 26

let lastTimestampMs = -1
// 必须显式标注：`new Uint8Array(n)` 推出的是 Uint8Array<ArrayBuffer>，而 randomBytes
// 返回 Uint8Array<ArrayBufferLike>，不标注会让赋值处报 TS2322。
let lastRandom: Uint8Array = new Uint8Array(RANDOM_BYTES)

/** 仅供测试重置模块级状态。 */
export function __resetUlidStateForTests(): void {
  lastTimestampMs = -1
  lastRandom = new Uint8Array(RANDOM_BYTES)
}

/**
 * 把 80 位随机段按大端加一。
 *
 * 全满时返回 false 且把字节清零（**不回绕成 0 再返回 true**）—— 调用方据此把时间戳
 * +1ms，否则会产出与前一个重复或更小的 ULID，破坏 spec 的单调性要求。
 */
export function incrementRandom(bytes: Uint8Array): boolean {
  for (let i = bytes.length - 1; i >= 0; i--) {
    const next = (bytes[i] ?? 0) + 1
    if (next <= 0xff) {
      bytes[i] = next
      return true
    }
    bytes[i] = 0
  }
  return false
}

function encodeTimestamp(timestampMs: number): string {
  const out: string[] = new Array<string>(TIME_CHARS)
  let value = BigInt(timestampMs)
  for (let i = TIME_CHARS - 1; i >= 0; i--) {
    out[i] = ULID_ALPHABET.charAt(Number(value & 31n))
    value >>= 5n
  }
  return out.join('')
}

function encodeRandom(bytes: Uint8Array): string {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)

  let out = ''
  for (let i = 0; i < RANDOM_CHARS; i++) {
    out = ULID_ALPHABET.charAt(Number(value & 31n)) + out
    value >>= 5n
  }
  return out
}

/** 解码时间部分为毫秒级 Unix 时间戳；长度、字符或取值非法时返回 null。 */
export function decodeUlidTimestamp(ulid: string): number | null {
  if (typeof ulid !== 'string' || ulid.length !== ULID_LENGTH) return null

  let value = 0n
  for (let i = 0; i < TIME_CHARS; i++) {
    const index = ULID_ALPHABET.indexOf(ulid.charAt(i).toUpperCase())
    if (index === -1) return null
    value = (value << 5n) | BigInt(index)
  }

  // 50 位中只有低 48 位是时间信息，进位到高位的取值不可信
  if (value > 0xffff_ffff_ffffn) return null
  return Number(value)
}

export function generateUlids(options: UlidOptions): string[] {
  const { count, uppercase = true } = options

  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
    throw new RangeError(`数量必须为 0 到 ${MAX_COUNT} 之间的整数`)
  }

  const output: string[] = []
  for (let i = 0; i < count; i++) {
    let timestampMs = Date.now()

    if (timestampMs > lastTimestampMs) {
      lastRandom = randomBytes(RANDOM_BYTES)
    } else {
      // 同一毫秒，或系统时钟发生了回拨。两种情况都不能让时间戳倒退，
      // 因此保持上一个毫秒值并递增计数器；溢出才推进到下一毫秒。
      timestampMs = lastTimestampMs
      if (!incrementRandom(lastRandom)) {
        timestampMs = lastTimestampMs + 1
        lastRandom = randomBytes(RANDOM_BYTES)
      }
    }

    lastTimestampMs = timestampMs
    const ulid = encodeTimestamp(timestampMs) + encodeRandom(lastRandom)
    output.push(uppercase ? ulid : ulid.toLowerCase())
  }
  return output
}
