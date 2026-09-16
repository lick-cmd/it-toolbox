import { describe, expect, it } from 'vitest'
import { jsonToJs } from './json-to-js'

function jsOf(text: string, indent?: 2 | 4 | 'tab'): string {
  const result = indent === undefined ? jsonToJs(text) : jsonToJs(text, { indent })
  if (!result.ok) throw new Error(`期望成功，实际失败：${result.error}`)
  return result.value
}

describe('jsonToJs', () => {
  it('对象转成 const data 字面量（缩进 2）', () => {
    expect(jsOf('{"a":1,"b":true,"c":null}')).toBe(
      'const data = {\n  "a": 1,\n  "b": true,\n  "c": null\n};',
    )
  })

  it('嵌套与数组', () => {
    expect(jsOf('{"tags":["a","b"],"meta":{"ok":1}}')).toBe(
      [
        'const data = {',
        '  "tags": [',
        '    "a",',
        '    "b"',
        '  ],',
        '  "meta": {',
        '    "ok": 1',
        '  }',
        '};',
      ].join('\n'),
    )
  })

  it('大整数保真（不经过 JSON.parse 的值对象）', () => {
    expect(jsOf('{"id":12345678912345678}')).toContain('12345678912345678')
  })

  it('保留重复键与原始数字写法', () => {
    const out = jsOf('{"dup":1,"dup":2,"neg":-0,"exp":1e2}')
    expect(out).toContain('"dup": 1')
    expect(out).toContain('"dup": 2')
    expect(out).toContain('"neg": -0')
    expect(out).toContain('"exp": 1e2')
  })

  it('转义写法原样保留（JSON 字符串字面量在 JS 中合法且语义相同）', () => {
    expect(jsOf('{"u":"\\u0041","s":"a\\/b"}')).toContain('"u": "\\u0041"')
    expect(jsOf('{"u":"\\u0041","s":"a\\/b"}')).toContain('"s": "a\\/b"')
  })

  it('中文键与值原样', () => {
    expect(jsOf('{"中文":"值"}')).toBe('const data = {\n  "中文": "值"\n};')
  })

  it('空容器写成一行', () => {
    expect(jsOf('{"o":{},"a":[]}')).toBe('const data = {\n  "o": {},\n  "a": []\n};')
  })

  it('顶层数组与顶层标量', () => {
    expect(jsOf('[1,2]')).toBe('const data = [\n  1,\n  2\n];')
    expect(jsOf('1')).toBe('const data = 1;')
    expect(jsOf('"x"')).toBe('const data = "x";')
  })

  it('缩进 4 与制表符', () => {
    expect(jsOf('{"a":{"b":1}}', 4)).toContain('    "a": {')
    expect(jsOf('{"a":{"b":1}}', 'tab')).toContain('\t"a": {')
  })

  it('空输入返回空串', () => {
    expect(jsOf('   ')).toBe('')
  })

  it('非法输入按 Result 报错并给出行列', () => {
    const result = jsonToJs('{\n  "a": 1\n')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('输入在容器内意外结束')
      expect(result.line).toBeGreaterThan(0)
    }
  })
})
