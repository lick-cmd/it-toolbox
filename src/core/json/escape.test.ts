import { describe, expect, it } from 'vitest'
import {
  convertUnicodeInString,
  normalizeEscapesInString,
  rewriteAllStringTokens,
  rewriteStringToken,
} from './escape'

describe('normalizeEscapesInString', () => {
  it('去掉斜杠的多余转义', () => {
    expect(normalizeEscapesInString('a\\/b')).toBe('a/b')
  })

  it('ASCII 区的 \\uXXXX 直出', () => {
    expect(normalizeEscapesInString('\\u0041')).toBe('A')
  })

  it('\\u0022 转成 \\" 而不是裸引号（否则输出不再是合法 JSON）', () => {
    expect(normalizeEscapesInString('\\u0022')).toBe('\\"')
  })

  it('\\u005c 转成 \\\\', () => {
    expect(normalizeEscapesInString('\\u005c')).toBe('\\\\')
  })

  it('控制字符统一为短转义', () => {
    expect(normalizeEscapesInString('\\u000a')).toBe('\\n')
    expect(normalizeEscapesInString('\\u0009')).toBe('\\t')
    expect(normalizeEscapesInString('\\u0008')).toBe('\\b')
    expect(normalizeEscapesInString('\\u000c')).toBe('\\f')
    expect(normalizeEscapesInString('\\u000d')).toBe('\\r')
  })

  it('没有短写形式的控制字符保留 \\uXXXX（小写）', () => {
    expect(normalizeEscapesInString('\\u0001')).toBe('\\u0001')
    expect(normalizeEscapesInString('\\u001F')).toBe('\\u001f')
  })

  it('非 ASCII 的 \\uXXXX 不动（留给 Unicode 转码）', () => {
    expect(normalizeEscapesInString('\\u4E2D')).toBe('\\u4E2D')
  })

  it('DEL(0x7f) 不直出', () => {
    expect(normalizeEscapesInString('\\u007f')).toBe('\\u007f')
  })

  it('已有短转义与 \\\\ 保持', () => {
    expect(normalizeEscapesInString('\\n\\t\\"\\\\')).toBe('\\n\\t\\"\\\\')
  })

  it('\\\\ 之后的 u 不是转义起点', () => {
    expect(normalizeEscapesInString('\\\\u0041')).toBe('\\\\u0041')
  })

  it('裸字符逐字保留（含中文与 emoji）', () => {
    expect(normalizeEscapesInString('中🚀abc')).toBe('中🚀abc')
  })
})

describe('convertUnicodeInString', () => {
  it('keep 原样返回', () => {
    expect(convertUnicodeInString('中\\u4e2d', 'keep')).toBe('中\\u4e2d')
  })

  it('escape：中文转 \\uXXXX（小写）', () => {
    expect(convertUnicodeInString('中', 'escape')).toBe('\\u4e2d')
  })

  it('escape：BMP 外字符拆成一对代理', () => {
    expect(convertUnicodeInString('😀', 'escape')).toBe('\\ud83d\\ude00')
  })

  it('escape 不动 ASCII 及其转义序列', () => {
    expect(convertUnicodeInString('a\\nb\\\\c', 'escape')).toBe('a\\nb\\\\c')
  })

  it('unescape：\\uXXXX 还原为真实字符', () => {
    expect(convertUnicodeInString('\\u4e2d', 'unescape')).toBe('中')
  })

  it('unescape：成对代理合并成一个字符', () => {
    expect(convertUnicodeInString('\\ud83d\\ude00', 'unescape')).toBe('😀')
  })

  it('unescape 不动 ASCII 区的 \\uXXXX（否则 \\u0022 会产出非法 JSON）', () => {
    expect(convertUnicodeInString('\\u0041', 'unescape')).toBe('\\u0041')
    expect(convertUnicodeInString('\\u0022', 'unescape')).toBe('\\u0022')
  })

  it('unescape 遇孤立代理码元保持原样', () => {
    expect(convertUnicodeInString('\\ud83d', 'unescape')).toBe('\\ud83d')
    expect(convertUnicodeInString('\\ude00', 'unescape')).toBe('\\ude00')
    expect(convertUnicodeInString('\\ud83d\\u0041', 'unescape')).toBe('\\ud83d\\u0041')
  })

  it('unescape 不把 \\\\ 里的 u 当转义起点', () => {
    expect(convertUnicodeInString('\\\\u4e2d', 'unescape')).toBe('\\\\u4e2d')
  })
})

describe('rewriteStringToken', () => {
  const SRC = '"a\\/b\\u0041\\u4e2d"'

  it('两者都关时逐字不变', () => {
    expect(rewriteStringToken(SRC, { normalizeEscapes: false, unicode: 'keep' })).toBe(SRC)
  })

  it('只开规范化', () => {
    expect(rewriteStringToken(SRC, { normalizeEscapes: true, unicode: 'keep' })).toBe(
      '"a/bA\\u4e2d"',
    )
  })

  it('只开 Unicode 转义', () => {
    expect(rewriteStringToken('"中"', { normalizeEscapes: false, unicode: 'escape' })).toBe(
      '"\\u4e2d"',
    )
  })

  it('两者同开：先规范化再转码', () => {
    expect(rewriteStringToken('"\\u0041中"', { normalizeEscapes: true, unicode: 'escape' })).toBe(
      '"A\\u4e2d"',
    )
  })

  it('结果永远是合法 JSON 字符串字面量', () => {
    const out = rewriteStringToken('"\\u0022"', { normalizeEscapes: true, unicode: 'unescape' })
    expect(out).toBe('"\\""')
    expect(() => JSON.parse(out)).not.toThrow()
    expect(JSON.parse(out)).toBe('"')
  })

  it('中文键同样处理', () => {
    expect(rewriteStringToken('"中文"', { normalizeEscapes: false, unicode: 'escape' })).toBe(
      '"\\u4e2d\\u6587"',
    )
  })
})

describe('rewriteAllStringTokens', () => {
  it('两者都关时原样返回', () => {
    const text = '{"a":"\\/","b":"中"}'
    expect(rewriteAllStringTokens(text, { normalizeEscapes: false, unicode: 'keep' })).toBe(text)
  })

  it('只改字符串 token，标点与数字的原文不动', () => {
    const text = '{"a":"\\u0041","n":1e2}'
    expect(rewriteAllStringTokens(text, { normalizeEscapes: true, unicode: 'keep' })).toBe(
      '{"a":"A","n":1e2}',
    )
  })

  it('文本无法解析时原样返回，不抛异常', () => {
    const broken = '{"a":'
    expect(rewriteAllStringTokens(broken, { normalizeEscapes: true, unicode: 'escape' })).toBe(
      broken,
    )
  })
})
