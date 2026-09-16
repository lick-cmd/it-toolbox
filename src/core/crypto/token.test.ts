import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALPHANUMERIC,
  BASE64_CHARSET,
  BASE64URL_CHARSET,
  HEX_CHARSET,
  MAX_COUNT,
  MAX_LENGTH,
  generateTokens,
  resolveCharset,
} from './token'
import type { CharsetId } from './token'

afterEach(() => {
  vi.restoreAllMocks()
})

const DEFAULT_OPTIONS = { length: 32, count: 1, charset: 'alphanumeric' } as const

describe('resolveCharset', () => {
  it('返回四个内置字符集，类型之外的未知值抛 RangeError 而非 TypeError', () => {
    expect(resolveCharset('alphanumeric')).toBe(ALPHANUMERIC)
    expect(resolveCharset('hex')).toBe(HEX_CHARSET)
    expect(resolveCharset('base64')).toBe(BASE64_CHARSET)
    expect(resolveCharset('base64url')).toBe(BASE64URL_CHARSET)

    // 否则 BUILTIN_CHARSETS['foo'] 为 undefined，会一路漂到 random.ts 才以 TypeError 爆掉
    expect(() => resolveCharset('foo' as CharsetId)).toThrow(RangeError)
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
    // 长度断言不能省：逐字符断言在空串上会直接通过
    expect(b64).toHaveLength(200)
    for (const char of b64) expect(BASE64_CHARSET).toContain(char)

    const b64url = generateTokens({ length: 200, count: 1, charset: 'base64url' })[0]!
    expect(b64url).toHaveLength(200)
    for (const char of b64url) expect(BASE64URL_CHARSET).toContain(char)
    expect(b64url).not.toMatch(/[+/]/)
  })

  it('随机值来自 crypto.getRandomValues，不使用 Math.random，且随机字节决定输出', () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const mathRandom = vi.spyOn(Math, 'random')

    generateTokens(DEFAULT_OPTIONS)

    expect(getRandomValues).toHaveBeenCalled()
    expect(mathRandom).not.toHaveBeenCalled()

    // 反证：只断言「被调用过」是不够的 —— 先空调一次 getRandomValues 再返回常量的实现
    // 同样能通过。固定底层字节后，输出必须随之确定，常量输出的实现会在这里失败。
    //
    // 必须固定 getRandomValues 而不是 mock '../random' 的导出：pickChars 内部调用的是
    // 同模块内的 randomInt，模块内部引用不受导出 mock 影响。
    const fillWith = (byte: number) => {
      getRandomValues.mockImplementation(((array: Uint8Array) => {
        array.fill(byte)
        return array
      }) as typeof globalThis.crypto.getRandomValues)
    }

    // hex 字符集 16 个字符 ⇒ randomInt 的 limit = 2^32，全 0x00 与全 0x01 都不会被拒绝采样丢弃
    fillWith(0x00)
    expect(generateTokens({ length: 32, count: 1, charset: 'hex' })[0]).toBe('0'.repeat(32))

    fillWith(0x01)
    expect(generateTokens({ length: 32, count: 1, charset: 'hex' })[0]).toBe('1'.repeat(32))
  })

  it('length 为 0、非整数或超上限时抛 RangeError，边界值本身合法', () => {
    expect(() => generateTokens({ length: 0, count: 1, charset: 'hex' })).toThrow(RangeError)
    expect(() => generateTokens({ length: 1.5, count: 1, charset: 'hex' })).toThrow(RangeError)
    expect(() =>
      generateTokens({ length: MAX_LENGTH + 1, count: 1, charset: 'hex' }),
    ).toThrow(RangeError)

    // 把 `>` 写成 `>=` 会让上限本身不可用，故上界取值必须被接受
    expect(generateTokens({ length: MAX_LENGTH, count: 1, charset: 'hex' })[0]).toHaveLength(
      MAX_LENGTH,
    )
  })

  it('count 为 0 时返回空数组，超上限或非整数时抛 RangeError，上限值本身合法', () => {
    expect(generateTokens({ length: 8, count: 0, charset: 'hex' })).toEqual([])
    expect(() => generateTokens({ length: 8, count: 1001, charset: 'hex' })).toThrow(RangeError)
    expect(() => generateTokens({ length: 8, count: 2.5, charset: 'hex' })).toThrow(RangeError)

    expect(generateTokens({ length: 1, count: MAX_COUNT, charset: 'hex' })).toHaveLength(MAX_COUNT)
  })

  it('单次生成的字符总数超上限时抛 RangeError，前缀同样计入总数', () => {
    // 4096 × 25 = 102400 > 100000
    expect(() => generateTokens({ length: MAX_LENGTH, count: 25, charset: 'hex' })).toThrow(
      RangeError,
    )
    // 恰好等于上限应放行：把 `>` 写成 `>=` 会让上限本身不可用
    expect(generateTokens({ length: 4_000, count: 25, charset: 'hex' })).toHaveLength(25)
    // 前缀是自由文本，不设上限就会绕过整条护栏
    expect(() =>
      generateTokens({ length: 1, count: 1_000, charset: 'hex', prefix: 'x'.repeat(200) }),
    ).toThrow(RangeError)
    expect(
      generateTokens({ length: 1, count: 1_000, charset: 'hex', prefix: 'x'.repeat(9) }),
    ).toHaveLength(1_000)
  })

  it('自定义字符集为空时抛 RangeError（供工具层捕获后提示）', () => {
    expect(() => generateTokens({ length: 8, count: 1, charset: 'custom', custom: '' })).toThrow(
      RangeError,
    )
  })
})
