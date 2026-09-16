import { describe, expect, it } from 'vitest'
import { parseJson, parseJsonValue } from './parse'

describe('parseJson', () => {
  it('解析成功时同时给出值与原样 token', () => {
    const result = parseJson('{"a":[1,true,null],"b":"x"}')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.value).toEqual({ a: [1, true, null], b: 'x' })
    expect(result.value.tokens.length).toBeGreaterThan(0)
    // token 的 raw 是原文切片，不做规范化
    expect(result.value.tokens.some((token) => token.raw === '"a"')).toBe(true)
  })

  it('保留数字字面量的原始写法', () => {
    const result = parseJson('{"n":1.50e2}')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.tokens.some((token) => token.raw === '1.50e2')).toBe(true)
    expect(result.value.value).toEqual({ n: 150 })
  })

  it('把 scanner 的定位信息原样透传（1 基行号列号 + 0 基偏移）', () => {
    const result = parseJson('{\n  "a": 1\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('UNCLOSED')
    expect(result.line).toBe(3)
    expect(result.column).toBe(1)
    expect(result.offset).toBe(11)
  })

  it('空输入返回 UNEXPECTED_EOF', () => {
    const result = parseJson('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('UNEXPECTED_EOF')
  })

  it('尾随内容被拒绝', () => {
    const result = parseJson('{} {}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('TRAILING_CONTENT')
  })

  it('深层语法错误仍能定位到行', () => {
    const result = parseJson('{\n  "a": [1, 2,]\n}')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('TRAILING_COMMA')
      expect(result.line).toBe(2)
    }
  })
})

describe('parseJsonValue', () => {
  it('只返回值的形态与 parseJson 的值一致', () => {
    const value = parseJsonValue('[1,2,3]')
    expect(value.ok).toBe(true)
    if (value.ok) expect(value.value).toEqual([1, 2, 3])
  })

  it('失败时错误信息与 parseJson 一致', () => {
    const value = parseJsonValue('{')
    expect(value.ok).toBe(false)
    if (!value.ok) {
      expect(value.code).toBe('UNCLOSED')
      expect(value.line).toBe(1)
    }
  })

  it('顶层标量（JSON 允许）可解析', () => {
    const value = parseJsonValue('"just a string"')
    expect(value.ok).toBe(true)
    if (value.ok) expect(value.value).toBe('just a string')
  })

  it('超大整数不因 JSON.parse 而失真报错', () => {
    // 9007199254740993 超出安全整数，JSON.parse 会取最近的浮点值；这里只要求不抛错
    const value = parseJsonValue('9007199254740993')
    expect(value.ok).toBe(true)
  })
})
