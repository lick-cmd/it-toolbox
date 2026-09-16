import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// 用 import type 引入模块命名空间再取 typeof：`importOriginal<typeof import('../random')>()`
// 会触发 @typescript-eslint/consistent-type-imports 的「禁止 import() 类型注解」。
// 仓内既有写法见 src/core/crypto/uuid.test.ts。
import type * as RandomModule from '../random'
import {
  MAX_COUNT,
  ULID_ALPHABET,
  __resetUlidStateForTests,
  decodeUlidTimestamp,
  generateUlids,
  incrementRandom,
} from './ulid'

/**
 * 只替换 randomBytes：默认转发真实实现，需要时按标记返回全 0xff。
 * 溢出分支（80 位随机段全满）在真实随机下需要 2^80 次生成才可能触发，
 * 不引入这个可控入口就只能是一条永远不被执行的死代码。
 */
// vi.mock 的工厂函数会被提升到文件顶部，引用普通顶层变量会抛「Cannot access before
// initialization」—— 用 vi.hoisted 显式提升这份状态。
const mockRandom = vi.hoisted(() => ({ allBytesFull: false }))

vi.mock('../random', async (importOriginal) => {
  const actual = await importOriginal<typeof RandomModule>()
  return {
    ...actual,
    randomBytes: (length: number) => {
      if (mockRandom.allBytesFull) return new Uint8Array(length).fill(0xff)
      return actual.randomBytes(length)
    },
  }
})

beforeEach(() => {
  mockRandom.allBytesFull = false
  __resetUlidStateForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ULID_ALPHABET', () => {
  it('是 32 个 Crockford 字符且不含易混的 I / L / O / U', () => {
    expect(ULID_ALPHABET).toHaveLength(32)
    expect(new Set(ULID_ALPHABET).size).toBe(32)
    for (const char of 'ILOU') expect(ULID_ALPHABET).not.toContain(char)
  })
})

describe('incrementRandom', () => {
  it('按大端加一', () => {
    const bytes = new Uint8Array([0x00, 0x00, 0xff])
    expect(incrementRandom(bytes)).toBe(true)
    expect([...bytes]).toEqual([0x00, 0x01, 0x00])
  })

  it('进位到最高字节', () => {
    const bytes = new Uint8Array([0xff, 0xff, 0xfe])
    expect(incrementRandom(bytes)).toBe(true)
    expect([...bytes]).toEqual([0xff, 0xff, 0xff])
  })

  it('全满时返回 false 且不回绕', () => {
    const bytes = new Uint8Array([0xff, 0xff, 0xff])
    expect(incrementRandom(bytes)).toBe(false)
    expect([...bytes]).toEqual([0x00, 0x00, 0x00])
  })
})

describe('generateUlids', () => {
  it('生成 26 个字符且全部属于 Crockford 字符集', () => {
    const [ulid] = generateUlids({ count: 1 })

    expect(ulid).toHaveLength(26)
    for (const char of ulid!) expect(ULID_ALPHABET).toContain(char)
  })

  it('默认输出大写，可切换为小写', () => {
    const [upper] = generateUlids({ count: 1 })
    expect(upper).toBe(upper!.toUpperCase())

    __resetUlidStateForTests()
    const [lower] = generateUlids({ count: 1, uppercase: false })
    expect(lower).toBe(lower!.toLowerCase())
  })

  it('内嵌时间戳与当前时间偏差在 2 秒以内', () => {
    const [ulid] = generateUlids({ count: 1 })
    const decoded = decodeUlidTimestamp(ulid!)

    expect(decoded).not.toBeNull()
    expect(Math.abs(decoded! - Date.now())).toBeLessThan(2_000)
  })

  it('批量 20 个互不相同', () => {
    const ulids = generateUlids({ count: 20 })

    expect(ulids).toHaveLength(20)
    expect(new Set(ulids).size).toBe(20)
  })

  it('同一毫秒内连续生成 200 个，字典序严格递增', () => {
    // 冻结时钟：让全部生成都落在同一毫秒，迫使单调计数器承担递增责任
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const ulids = generateUlids({ count: 200 })

    for (let i = 1; i < ulids.length; i++) {
      expect(ulids[i]! > ulids[i - 1]!).toBe(true)
    }
    expect(new Set(ulids).size).toBe(200)
  })

  it('系统时钟回拨时不产生倒退的时间戳，且仍然严格递增', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const [first] = generateUlids({ count: 1 })

    vi.spyOn(Date, 'now').mockReturnValue(1_699_999_990_000) // 倒退 10 秒
    const [second] = generateUlids({ count: 1 })

    expect(decodeUlidTimestamp(second!)).toBe(decodeUlidTimestamp(first!))
    expect(second! > first!).toBe(true)
  })

  it('随机段溢出时把时间戳 +1ms，不产生重复或倒退', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    mockRandom.allBytesFull = true
    const [first] = generateUlids({ count: 1 })

    mockRandom.allBytesFull = false
    const [second] = generateUlids({ count: 1 })

    expect(decodeUlidTimestamp(first!)).toBe(1_700_000_000_000)
    expect(decodeUlidTimestamp(second!)).toBe(1_700_000_000_001)
    expect(second! > first!).toBe(true)
  })

  it('count 为 0 时返回空数组，非整数或超上限时抛 RangeError', () => {
    expect(generateUlids({ count: 0 })).toEqual([])
    expect(() => generateUlids({ count: MAX_COUNT + 1 })).toThrow(RangeError)
    expect(() => generateUlids({ count: 1.5 })).toThrow(RangeError)
    expect(() => generateUlids({ count: -1 })).toThrow(RangeError)
  })
})

describe('decodeUlidTimestamp', () => {
  it('长度或字符非法时返回 null', () => {
    expect(decodeUlidTimestamp('')).toBeNull()
    expect(decodeUlidTimestamp('01ARZ3NDEKTSV4RRFFQ69G5FA')).toBeNull() // 25 字符
    // I / L / O / U 不在 Crockford 字符集内
    expect(decodeUlidTimestamp('I1ARZ3NDEKTSV4RRFFQ69G5FAV')).toBeNull()
  })

  it('时间部分超出 48 位时返回 null（10 个字符承载 50 位）', () => {
    expect(decodeUlidTimestamp('ZZZZZZZZZZ0000000000000000')).toBeNull()
  })

  it('大小写都能解码', () => {
    const [ulid] = generateUlids({ count: 1 })

    expect(decodeUlidTimestamp(ulid!.toLowerCase())).toBe(decodeUlidTimestamp(ulid!))
  })
})
