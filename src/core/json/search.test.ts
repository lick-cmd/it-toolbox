import { describe, expect, it } from 'vitest'
import { searchJson, type JsonSearchMatch } from './search'

const DOC = '{\n  "name": "alice",\n  "age": 30,\n  "ok": true\n}'

const first = (matches: readonly JsonSearchMatch[]): JsonSearchMatch => {
  const [match] = matches
  if (match === undefined) throw new Error('期望至少有一条命中')
  return match
}

const slice = (text: string, match: JsonSearchMatch) => text.slice(match.start, match.end)

describe('searchJson —— 只搜键与值', () => {
  it('命中对象键并标记 field 为 key', () => {
    const matches = searchJson(DOC, 'name')
    expect(matches).toHaveLength(1)
    const match = first(matches)
    expect(match.field).toBe('key')
    expect(slice(DOC, match)).toBe('name')
    expect(match.line).toBe(2)
    expect(match.column).toBe(4)
  })

  it('命中有引号的字符串值并标记 field 为 value', () => {
    const matches = searchJson(DOC, 'alice')
    expect(matches).toHaveLength(1)
    const match = first(matches)
    expect(match.field).toBe('value')
    expect(slice(DOC, match)).toBe('alice')
    // 命中位置只覆盖内容，不含两侧引号
    expect(DOC[match.start - 1]).toBe('"')
    expect(DOC[match.end]).toBe('"')
  })

  it('数字与字面量同样可搜', () => {
    const number = first(searchJson(DOC, '30'))
    expect(number.field).toBe('value')
    expect(slice(DOC, number)).toBe('30')
    expect(slice(DOC, first(searchJson(DOC, 'true')))).toBe('true')
  })

  it('不命中标点：结构符号既不是键也不是值', () => {
    expect(searchJson(DOC, '{')).toEqual([])
    expect(searchJson(DOC, '}')).toEqual([])
    expect(searchJson(DOC, ':')).toEqual([])
    expect(searchJson(DOC, ',')).toEqual([])
  })

  it('同一值内出现多次时逐个命中且互不重叠', () => {
    const text = '{"k": "aaaa"}'
    const base = text.indexOf('aaaa')
    expect(searchJson(text, 'aa').map((item) => item.start - base)).toEqual([0, 2])
  })

  it('空字符串值不会命中引号自身', () => {
    const matches = searchJson('{"a": ""}', 'a')
    expect(matches).toHaveLength(1)
    expect(first(matches).field).toBe('key')
  })

  it('默认忽略大小写，开启区分后大小写必须一致', () => {
    const text = '{\n  "Name": "Alice"\n}'
    expect(searchJson(text, 'alice')).toHaveLength(1)
    expect(searchJson(text, 'alice', { caseSensitive: true })).toEqual([])
    expect(searchJson(text, 'name', { caseSensitive: true })).toEqual([])
    expect(searchJson(text, 'Name', { caseSensitive: true })).toHaveLength(1)
  })

  it('转义字面量按原文匹配，不做解码', () => {
    const text = '{\n  "x": "\\u0041"\n}'
    expect(slice(text, first(searchJson(text, 'u0041')))).toBe('u0041')
    // 源码里写的是 \u0041，解码后的 A 在原文中并不存在，故搜不到
    expect(searchJson(text, 'A')).toEqual([])
  })

  it('空关键词返回空结果', () => {
    expect(searchJson(DOC, '')).toEqual([])
  })

  it('无法解析的文本降级为整段纯文本搜索', () => {
    const truncated = '{\n  "a": {\n    "b": 1'
    const matches = searchJson(truncated, 'b')
    expect(matches).toHaveLength(1)
    const match = first(matches)
    expect(match.field).toBe('value')
    expect(match.line).toBe(3)
  })
})
