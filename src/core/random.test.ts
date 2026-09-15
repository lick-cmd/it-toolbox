import { describe, expect, it } from 'vitest'
import { pickChars, randomBytes, randomInt } from './random'

describe('randomBytes', () => {
  it('返回指定长度', () => {
    expect(randomBytes(16).length).toBe(16)
    expect(randomBytes(0).length).toBe(0)
  })

  it('跨越 65536 分块边界仍返回正确长度', () => {
    // getRandomValues 单次调用上限为 65536 字节，实现必须分块
    expect(randomBytes(65_536).length).toBe(65_536)
    expect(randomBytes(70_000).length).toBe(70_000)
  })

  it('两次调用结果不同（极低概率碰撞）', () => {
    expect(Buffer.from(randomBytes(32)).toString('hex')).not.toBe(
      Buffer.from(randomBytes(32)).toString('hex'),
    )
  })

  it('拒绝非法长度', () => {
    expect(() => randomBytes(-1)).toThrowError(/非负整数/)
    expect(() => randomBytes(1.5)).toThrowError(/非负整数/)
  })
})

describe('randomInt', () => {
  it('取值落在 [0, maxExclusive)', () => {
    for (let i = 0; i < 2_000; i++) {
      const v = randomInt(7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
    }
  })

  it('maxExclusive 为 1 时恒为 0', () => {
    expect(randomInt(1)).toBe(0)
  })

  it('覆盖全部取值（无遗漏）', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 2_000; i++) seen.add(randomInt(5))
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4])
  })

  it('大范围取值不溢出', () => {
    const v = randomInt(0xffff_ffff)
    expect(Number.isInteger(v)).toBe(true)
    expect(v).toBeGreaterThanOrEqual(0)
  })

  it('拒绝非法参数', () => {
    expect(() => randomInt(0)).toThrowError(/正整数/)
    expect(() => randomInt(-3)).toThrowError(/正整数/)
    expect(() => randomInt(2.5)).toThrowError(/正整数/)
  })
})

describe('pickChars', () => {
  it('返回指定长度且所有字符来自字符集', () => {
    const out = pickChars('abc', 40)
    expect(out).toHaveLength(40)
    expect([...out].every((c) => 'abc'.includes(c))).toBe(true)
  })

  it('拒绝少于 2 个字符的字符集', () => {
    expect(() => pickChars('a', 4)).toThrowError(/至少需要 2 个/)
    expect(() => pickChars('', 4)).toThrowError(/至少需要 2 个/)
  })
})
