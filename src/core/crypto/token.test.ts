import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALPHANUMERIC,
  BASE64_CHARSET,
  BASE64URL_CHARSET,
  HEX_CHARSET,
  MAX_LENGTH,
  generateTokens,
  resolveCharset,
} from './token'

afterEach(() => {
  vi.restoreAllMocks()
})

const DEFAULT_OPTIONS = { length: 32, count: 1, charset: 'alphanumeric' } as const

describe('resolveCharset', () => {
  it('返回四个内置字符集', () => {
    expect(resolveCharset('alphanumeric')).toBe(ALPHANUMERIC)
    expect(resolveCharset('hex')).toBe(HEX_CHARSET)
    expect(resolveCharset('base64')).toBe(BASE64_CHARSET)
    expect(resolveCharset('base64url')).toBe(BASE64URL_CHARSET)
  })

  it('自定义字符集去除重复字符', () => {
    expect(resolveCharset('custom', 'aabbc')).toBe('abc')
  })

  it('自定义字符集为空（含全空白）时抛 RangeError', () => {
    expect(() => resolveCharset('custom', '')).toThrow(RangeError)
    expect(() => resolveCharset('custom', '   ')).toThrow(RangeError)
  })

  it('自定义字符集去重后不足 2 个字符时抛 RangeError', () => {
    expect(() => resolveCharset('custom', 'aaa')).toThrow(RangeError)
  })
})

describe('generateTokens', () => {
  it('按默认参数生成一个 Token，长度与字符集均符合预期', () => {
    const tokens = generateTokens(DEFAULT_OPTIONS)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toHaveLength(32)
    for (const char of tokens[0]!) expect(ALPHANUMERIC).toContain(char)
  })

  it('自定义长度与字符集：长度 64、十六进制', () => {
    const [token] = generateTokens({ length: 64, count: 1, charset: 'hex' })

    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('批量生成 5 个且互不相同', () => {
    const tokens = generateTokens({ length: 16, count: 5, charset: 'alphanumeric' })

    expect(tokens).toHaveLength(5)
    expect(new Set(tokens).size).toBe(5)
  })

  it('前缀加在随机段之前，且不计入 length', () => {
    const tokens = generateTokens({ length: 8, count: 3, charset: 'hex', prefix: 'sk_' })

    for (const token of tokens) {
      expect(token.startsWith('sk_')).toBe(true)
      expect(token.slice(3)).toMatch(/^[0-9a-f]{8}$/)
    }
  })

  it('base64 / base64url 的每个字符都来自各自字母表', () => {
    const b64 = generateTokens({ length: 200, count: 1, charset: 'base64' })[0]!
    for (const char of b64) expect(BASE64_CHARSET).toContain(char)

    const b64url = generateTokens({ length: 200, count: 1, charset: 'base64url' })[0]!
    for (const char of b64url) expect(BASE64URL_CHARSET).toContain(char)
    expect(b64url).not.toMatch(/[+/]/)
  })

  it('随机值来自 crypto.getRandomValues，不使用 Math.random', () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const mathRandom = vi.spyOn(Math, 'random')

    generateTokens(DEFAULT_OPTIONS)

    expect(getRandomValues).toHaveBeenCalled()
    expect(mathRandom).not.toHaveBeenCalled()
  })

  it('length 为 0、非整数或超上限时抛 RangeError', () => {
    expect(() => generateTokens({ length: 0, count: 1, charset: 'hex' })).toThrow(RangeError)
    expect(() => generateTokens({ length: 1.5, count: 1, charset: 'hex' })).toThrow(RangeError)
    expect(() =>
      generateTokens({ length: MAX_LENGTH + 1, count: 1, charset: 'hex' }),
    ).toThrow(RangeError)
  })

  it('count 为 0 时返回空数组，超上限或非整数时抛 RangeError', () => {
    expect(generateTokens({ length: 8, count: 0, charset: 'hex' })).toEqual([])
    expect(() => generateTokens({ length: 8, count: 1001, charset: 'hex' })).toThrow(RangeError)
    expect(() => generateTokens({ length: 8, count: 2.5, charset: 'hex' })).toThrow(RangeError)
  })

  it('单次生成的字符总数超上限时抛 RangeError', () => {
    // 4096 × 25 = 102400 > 100000
    expect(() => generateTokens({ length: MAX_LENGTH, count: 25, charset: 'hex' })).toThrow(
      RangeError,
    )
  })

  it('自定义字符集为空时抛 RangeError（供工具层捕获后提示）', () => {
    expect(() => generateTokens({ length: 8, count: 1, charset: 'custom', custom: '' })).toThrow(
      RangeError,
    )
  })
})
