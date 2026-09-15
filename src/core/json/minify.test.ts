import { describe, expect, it } from 'vitest'
import { minifyJson } from './minify'

const out = (text: string): string => {
  const r = minifyJson(text)
  if (!r.ok) throw new Error(`意外失败：${r.error}`)
  return r.value.output
}

describe('minifyJson', () => {
  it('移除换行与缩进', () => {
    expect(out('{\n  "a": 1,\n  "b": [1, 2]\n}')).toBe('{"a":1,"b":[1,2]}')
  })

  it('保留字符串内部的空白', () => {
    expect(out('{ "a" : " x  y \\n z " }')).toBe('{"a":" x  y \\n z "}')
  })

  it('规范：\\u0041 不被改写为 A（逐字节保真的关键）', () => {
    expect(out(String.raw`{ "s" : "\u0041" }`)).toBe(String.raw`{"s":"\u0041"}`)
  })

  it('规范：\\/ 不被改写为 /', () => {
    expect(out(String.raw`{ "s" : "\/" }`)).toBe(String.raw`{"s":"\/"}`)
  })

  it('保留 \\n \\t \\\\ 等转义写法', () => {
    const input = String.raw`{"s":"a\nb\tc\\d\"e"}`
    expect(out(`  ${input}  `)).toBe(input)
  })

  it('统计 UTF-8 字节数而非 UTF-16 码元数', () => {
    const r = minifyJson('{\n  "a": "工具箱"\n}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      // '{"a":"工具箱"}' 的 UTF-8 字节数
      expect(r.value.outputBytes).toBe(Buffer.byteLength('{"a":"工具箱"}', 'utf8'))
      expect(r.value.inputBytes).toBeGreaterThan(r.value.outputBytes)
    }
  })

  it('非法输入透传错误定位', () => {
    const r = minifyJson('{"a":1,}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('TRAILING_COMMA')
      expect(r.offset).toBe(7)
      expect(r.line).toBe(1)
      expect(r.column).toBe(8)
    }
  })
})
