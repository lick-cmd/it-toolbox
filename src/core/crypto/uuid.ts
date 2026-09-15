import { bytesToHex } from '../bytes'
import { randomBytes, randomInt } from '../random'

export type UuidVersion = 1 | 4 | 7

export interface UuidOptions {
  version: UuidVersion
  count: number
  /** 是否输出连字符，默认 true */
  hyphens?: boolean
  /** 是否大写，默认 false */
  uppercase?: boolean
}

/** 单次生成的条数上限，避免阻塞界面。 */
const MAX_COUNT = 1_000

/** 1582-10-15 00:00:00 UTC 与 Unix 纪元之间的 100ns 间隔数（0x01B21DD213814000）。 */
const GREGORIAN_OFFSET_100NS = 122_192_928_000_000_000n

const UUID_PATTERN =
  /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i

/**
 * v1 的会话级状态。
 *
 * 节点 ID 使用随机值：WebView 无法获取网卡 MAC。按 RFC 4122 要求把首字节
 * 最低位置 1（multicast 标志），以免冒充真实网卡地址。
 */
const sessionClockSeq = randomBytes(2)
const sessionNode = (() => {
  const node = randomBytes(6)
  node[0] = ((node[0] ?? 0) | 0x01) & 0xff
  return node
})()

/** v7 的单调计数器状态。 */
let lastTimestampMs = -1
let lastRandA = -1

/** 仅供测试重置模块级状态。 */
export function __resetUuidStateForTests(): void {
  lastTimestampMs = -1
  lastRandA = -1
}

function formatUuid(bytes: Uint8Array, hyphens: boolean, uppercase: boolean): string {
  const hex = bytesToHex(bytes, uppercase)
  if (!hyphens) return hex
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

function generateV1(): Uint8Array {
  const bytes = new Uint8Array(16)

  // 100ns 间隔数 = 毫秒 * 10^4
  const timestamp = BigInt(Date.now()) * 10_000n + GREGORIAN_OFFSET_100NS

  const timeLow = Number(timestamp & 0xffff_ffffn)
  const timeMid = Number((timestamp >> 32n) & 0xffffn)
  const timeHigh = Number((timestamp >> 48n) & 0x0fffn)

  bytes[0] = (timeLow >>> 24) & 0xff
  bytes[1] = (timeLow >>> 16) & 0xff
  bytes[2] = (timeLow >>> 8) & 0xff
  bytes[3] = timeLow & 0xff
  bytes[4] = (timeMid >>> 8) & 0xff
  bytes[5] = timeMid & 0xff
  // 高 4 位为版本号 1
  bytes[6] = ((timeHigh >>> 8) & 0x0f) | 0x10
  bytes[7] = timeHigh & 0xff
  // 高 2 位为变体标志 10
  bytes[8] = ((sessionClockSeq[0] ?? 0) & 0x3f) | 0x80
  bytes[9] = sessionClockSeq[1] ?? 0
  bytes.set(sessionNode, 10)

  return bytes
}

function generateV4(): Uint8Array {
  const bytes = randomBytes(16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  return bytes
}

function generateV7(): Uint8Array {
  const bytes = new Uint8Array(16)
  let timestampMs = Date.now()
  let randA: number

  if (timestampMs > lastTimestampMs) {
    randA = randomInt(0x1000)
  } else {
    // 同一毫秒，或系统时钟发生了回拨。
    // 两种情况都不能让时间戳倒退，因此保持上一次的毫秒值并递增计数器。
    timestampMs = lastTimestampMs
    randA = lastRandA + 1
    if (randA > 0x0fff) {
      timestampMs = lastTimestampMs + 1
      randA = randomInt(0x1000)
    }
  }

  lastTimestampMs = timestampMs
  lastRandA = randA

  // rand_a 严格递增即可保证字典序单调，故 rand_b 每次重新随机
  const randB = randomBytes(8)
  const timestamp = BigInt(timestampMs)

  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((timestamp >> BigInt(40 - i * 8)) & 0xffn)
  }
  bytes[6] = 0x70 | ((randA >>> 8) & 0x0f)
  bytes[7] = randA & 0xff
  bytes[8] = 0x80 | ((randB[0] ?? 0) & 0x3f)
  for (let i = 1; i < 8; i++) bytes[8 + i] = randB[i] ?? 0

  return bytes
}

export function generateUuids(options: UuidOptions): string[] {
  const { version, count, hyphens = true, uppercase = false } = options

  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
    throw new RangeError(`数量必须为 0 到 ${MAX_COUNT} 之间的整数`)
  }
  if (version !== 1 && version !== 4 && version !== 7) {
    throw new RangeError('仅支持 UUID v1 / v4 / v7')
  }

  const generate = version === 1 ? generateV1 : version === 4 ? generateV4 : generateV7

  const output: string[] = []
  for (let i = 0; i < count; i++) {
    output.push(formatUuid(generate(), hyphens, uppercase))
  }
  return output
}

function toBytes(uuid: string): Uint8Array | null {
  const match = UUID_PATTERN.exec(uuid)
  if (!match) {
    // 允许无连字符形式
    if (!/^[0-9a-f]{32}$/i.test(uuid)) return null
    const plain = uuid.toLowerCase()
    const bytes = new Uint8Array(16)
    for (let i = 0; i < 16; i++) {
      bytes[i] = Number.parseInt(plain.slice(i * 2, i * 2 + 2), 16)
    }
    return bytes
  }

  const hex = `${match[1]}${match[2]}${match[3]}${match[4]}${match[5]}`.toLowerCase()
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function uuidVersionOf(uuid: string): number | null {
  const bytes = toBytes(uuid)
  if (!bytes) return null
  return ((bytes[6] ?? 0) >> 4) & 0x0f
}

/**
 * 解析 UUID 中编码的时间戳。
 *
 * v1 与 v7 有时间语义，其余版本返回 null —— 返回 0 会让调用方误以为
 * 得到了 Unix 纪元时刻。
 */
export function uuidTimestampMs(uuid: string): number | null {
  const bytes = toBytes(uuid)
  if (!bytes) return null

  const version = ((bytes[6] ?? 0) >> 4) & 0x0f

  if (version === 7) {
    let timestamp = 0n
    for (let i = 0; i < 6; i++) {
      timestamp = (timestamp << 8n) | BigInt(bytes[i] ?? 0)
    }
    return Number(timestamp)
  }

  if (version === 1) {
    const timeLow =
      ((bytes[0] ?? 0) << 24) |
      ((bytes[1] ?? 0) << 16) |
      ((bytes[2] ?? 0) << 8) |
      (bytes[3] ?? 0)
    const timeMid = ((bytes[4] ?? 0) << 8) | (bytes[5] ?? 0)
    const timeHigh = ((bytes[6] ?? 0) & 0x0f) << 8 | (bytes[7] ?? 0)

    const timestamp100ns =
      (BigInt(timeHigh) << 48n) | (BigInt(timeMid) << 32n) | BigInt(timeLow >>> 0)

    return Number((timestamp100ns - GREGORIAN_OFFSET_100NS) / 10_000n)
  }

  return null
}
