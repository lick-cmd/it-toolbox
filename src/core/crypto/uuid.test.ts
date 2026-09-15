import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetUuidStateForTests,
  generateUuids,
  uuidTimestampMs,
  uuidVersionOf,
} from './uuid'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('generateUuids — 格式', () => {
  beforeEach(() => {
    __resetUuidStateForTests()
  })

  it.each([1, 4, 7] as const)('v%i 符合 UUID 格式且变体位正确', (version) => {
    const [uuid] = generateUuids({ version, count: 1 })
    expect(uuid).toMatch(UUID_PATTERN)
    expect(uuidVersionOf(uuid!)).toBe(version)
  })

  it('去掉连字符', () => {
    const [uuid] = generateUuids({ version: 4, count: 1, hyphens: false })
    expect(uuid).toMatch(/^[0-9a-f]{32}$/)
  })

  it('大写输出', () => {
    const [uuid] = generateUuids({ version: 4, count: 1, uppercase: true })
    expect(uuid).toBe(uuid!.toUpperCase())
  })

  it('按数量生成且互不相同', () => {
    const uuids = generateUuids({ version: 4, count: 50 })
    expect(uuids).toHaveLength(50)
    expect(new Set(uuids).size).toBe(50)
  })

  it('数量为 0 返回空数组', () => {
    expect(generateUuids({ version: 4, count: 0 })).toEqual([])
  })

  it('拒绝非法数量', () => {
    expect(() => generateUuids({ version: 4, count: -1 })).toThrowError(/数量/)
    expect(() => generateUuids({ version: 4, count: 1.5 })).toThrowError(/数量/)
    expect(() => generateUuids({ version: 4, count: 100_000 })).toThrowError(/数量/)
  })
})

describe('UUID v7 — 时间与单调性', () => {
  beforeEach(() => {
    __resetUuidStateForTests()
  })

  it('编码的时间戳接近当前时刻', () => {
    const [uuid] = generateUuids({ version: 7, count: 1 })
    const timestamp = uuidTimestampMs(uuid!)
    expect(timestamp).not.toBeNull()
    expect(Math.abs((timestamp ?? 0) - Date.now())).toBeLessThan(5_000)
  })

  it('同一毫秒内批量生成仍严格字典序递增', () => {
    // 立即生成一批，绝大多数会落在同一毫秒内
    const uuids = generateUuids({ version: 7, count: 200 })
    for (let i = 1; i < uuids.length; i++) {
      expect(uuids[i]! > uuids[i - 1]!).toBe(true)
    }
  })

  it('跨毫秒批量生成仍递增', async () => {
    const first = generateUuids({ version: 7, count: 1 })[0]!
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = generateUuids({ version: 7, count: 1 })[0]!
    expect(second > first).toBe(true)
  })

  it('时间戳部分为 48 位大端编码', () => {
    const [uuid] = generateUuids({ version: 7, count: 1, hyphens: false })
    const encoded = Number.parseInt(uuid!.slice(0, 12), 16)
    const timestamp = uuidTimestampMs(uuid!)
    expect(encoded).toBe(timestamp)
  })
})

describe('UUID v1 — 时间与节点', () => {
  beforeEach(() => {
    __resetUuidStateForTests()
  })

  it('解码出的时间戳接近当前时刻', () => {
    const [uuid] = generateUuids({ version: 1, count: 1 })
    const timestamp = uuidTimestampMs(uuid!)
    expect(Math.abs((timestamp ?? 0) - Date.now())).toBeLessThan(5_000)
  })

  it('节点 ID 首字节最低位为 1（随机 multicast 标志）', () => {
    const [uuid] = generateUuids({ version: 1, count: 1, hyphens: false })
    const firstNodeByte = Number.parseInt(uuid!.slice(20, 22), 16)
    expect(firstNodeByte & 0x01).toBe(1)
  })

  it('同一会话内节点 ID 与 clock_seq 保持稳定', () => {
    const [a] = generateUuids({ version: 1, count: 1, hyphens: false })
    const [b] = generateUuids({ version: 1, count: 1, hyphens: false })
    expect(a!.slice(16)).toBe(b!.slice(16))
  })
})

describe('uuidVersionOf / uuidTimestampMs 的健壮性', () => {
  it.each([
    ['空字符串', ''],
    ['非 UUID', 'hello'],
    ['长度不足', '12345678-1234-1234-1234-1234'],
    ['非十六进制', 'zzzzzzzz-zzzz-7zzz-8zzz-zzzzzzzzzzzz'],
  ])('%s 返回 null 而非抛错', (_label, value) => {
    expect(uuidVersionOf(value)).toBeNull()
    expect(uuidTimestampMs(value)).toBeNull()
  })

  it('对 v4 返回 null（无时间戳语义）', () => {
    const [uuid] = generateUuids({ version: 4, count: 1 })
    expect(uuidTimestampMs(uuid!)).toBeNull()
  })
})
