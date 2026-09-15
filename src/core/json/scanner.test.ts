import { describe, expect, it } from 'vitest'
import { positionToLineColumn, scanJson } from './scanner'

describe('scanJson — 合法输入', () => {
  it.each([
    ['对象', '{"a":1}'],
    ['数组', '[1,2,3]'],
    ['嵌套', '{"a":[{"b":null}],"c":true}'],
    ['空对象与空数组', '{"a":{},"b":[]}'],
    ['负数与指数', '[-0, 1.5e-3, 2E+10, 1e10]'],
    ['转义', String.raw`{"s":"a\"b\\c\/d\n\t\u0041"}`],
    ['顶层标量', '42'],
    ['顶层字符串', '"hello"'],
    ['首尾空白', '  \n\t {"a":1} \r\n '],
  ])('%s', (_label, text) => {
    const result = scanJson(text)
    expect(result.ok).toBe(true)
  })

  it('保留原文切片，不改写转义字面量', () => {
    const result = scanJson(String.raw`{"s":"\u0041\/\n"}`)
    expect(result.ok).toBe(true)
    if (result.ok) {
      // 键与值都是引号开头的 string token，必须取**值**那一个。
      // 计划原文写的是 `find`，它取到的是键 `"s"`，导致该用例在任何忠实实现下都不可能通过
      // （失败详情为 `expected '"s"' to be ...`）。此处只修选择器，断言一字未改。
      const stringToken = result.tokens.findLast((t) => t.raw.startsWith('"'))
      expect(stringToken?.raw).toBe(String.raw`"\u0041\/\n"`)
    }
  })

  it('token 切片可拼回原文（去空白后）', () => {
    const text = '{"a": [1, 2]}'
    const result = scanJson(text)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tokens.map((t) => t.raw).join('')).toBe('{"a":[1,2]}')
    }
  })
})

describe('scanJson — 非法输入与精确定位', () => {
  it.each([
    ['尾随逗号', '{"a":1,}', 'TRAILING_COMMA', 7],
    ['数组尾随逗号', '[1,]', 'TRAILING_COMMA', 3],
    ['单引号字符串', "{'a':1}", 'UNQUOTED_KEY', 1],
    ['未加引号的键', '{a:1}', 'UNQUOTED_KEY', 1],
    ['前导加号', '+1', 'BAD_NUMBER', 0],
    ['前导零', '01', 'BAD_NUMBER', 1],
    ['小数点前无数字', '.5', 'UNEXPECTED_CHAR', 0],
    ['小数点后无数字', '5.', 'BAD_NUMBER', 1],
    ['NaN', 'NaN', 'UNEXPECTED_CHAR', 0],
    ['Infinity', 'Infinity', 'UNEXPECTED_CHAR', 0],
    ['单引号', "'x'", 'UNEXPECTED_CHAR', 0],
    ['未闭合字符串', '{"a":"x', 'UNTERMINATED_STRING', 5],
    ['非法转义', String.raw`{"a":"\q"}`, 'BAD_ESCAPE', 7],
    ['不完整 unicode 转义', String.raw`{"a":"\u12"}`, 'BAD_UNICODE_ESCAPE', 7],
    ['未闭合对象', '{"a":1', 'UNCLOSED', 6],
    ['未闭合数组', '[1,2', 'UNCLOSED', 4],
    ['多余内容', '{"a":1} x', 'TRAILING_CONTENT', 8],
    ['缺少冒号', '{"a" 1}', 'EXPECTED_COLON', 5],
    ['缺少逗号', '{"a":1 "b":2}', 'EXPECTED_COMMA_OR_END', 7],
    ['空输入', '', 'UNEXPECTED_EOF', 0],
    ['仅空白', '   ', 'UNEXPECTED_EOF', 3],
    ['字符串中的裸换行', '{"a":"x\ny"}', 'RAW_CONTROL_CHAR', 7],
  ])('%s → %s @ %i', (_label, text, code, offset) => {
    const result = scanJson(text)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(code)
      expect(result.offset).toBe(offset)
    }
  })

  it('错误同时给出 1 基的行号与列号', () => {
    const text = '{\n  "a": 1,\n  "b": 2,\n}'
    const result = scanJson(text)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.offset).toBe(text.indexOf('}'))
      expect(result.line).toBe(4)
      expect(result.column).toBe(1)
    }
  })

  it('错误信息包含可读的原因', () => {
    const result = scanJson('{"a":1,}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })
})

describe('positionToLineColumn', () => {
  it.each([
    [0, 1, 1],
    [4, 1, 5],
    [5, 2, 1],
    [6, 2, 2],
  ])('偏移 %i → 第 %i 行第 %i 列', (offset, line, column) => {
    // 文本为 'abcd\nef'，偏移 4 是 '\n' 本身，偏移 5 是第二行首
    expect(positionToLineColumn('abcd\nef', offset)).toEqual({ line, column })
  })

  it('偏移超界时钳制到末尾', () => {
    expect(positionToLineColumn('ab', 99)).toEqual({ line: 1, column: 3 })
  })
})
