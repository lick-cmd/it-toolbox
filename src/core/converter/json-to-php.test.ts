import { describe, expect, it } from 'vitest'
import { jsonToPhp } from './json-to-php'

function phpOf(text: string, indent?: 2 | 4 | 'tab'): string {
  const result = indent === undefined ? jsonToPhp(text) : jsonToPhp(text, { indent })
  if (!result.ok) throw new Error(`期望成功，实际失败：${result.error}`)
  return result.value
}

describe('jsonToPhp', () => {
  it('对象转成短数组语法（默认缩进 4）', () => {
    expect(phpOf('{"a":1,"b":true,"c":null}')).toBe(
      ['$data = [', '    "a" => 1,', '    "b" => true,', '    "c" => null', '];'].join('\n'),
    )
  })

  it('嵌套对象与数组', () => {
    expect(phpOf('{"tags":["a"],"meta":{"ok":1}}')).toBe(
      [
        '$data = [',
        '    "tags" => [',
        '        "a"',
        '    ],',
        '    "meta" => [',
        '        "ok" => 1',
        '    ]',
        '];',
      ].join('\n'),
    )
  })

  it('大整数保真', () => {
    expect(phpOf('{"id":12345678912345678}')).toContain('12345678912345678')
  })

  it('重复键与原始数字写法保留', () => {
    const out = phpOf('{"dup":1,"dup":2,"neg":-0,"exp":1e2}')
    expect(out).toContain('"dup" => 1')
    expect(out).toContain('"dup" => 2')
    expect(out).toContain('"neg" => -0')
    expect(out).toContain('"exp" => 1e2')
  })

  it('字符串重新编码：\\/ 不能原样贴进 PHP', () => {
    expect(phpOf('{"s":"a\\/b"}')).toContain('"s" => "a/b"')
  })

  it('转义 " \\ $', () => {
    expect(phpOf('{"s":"a\\"b"}')).toContain('"a\\"b"')
    expect(phpOf('{"s":"a\\\\b"}')).toContain('"a\\\\b"')
    expect(phpOf('{"s":"$x"}')).toContain('"\\$x"')
  })

  it('控制字符用短转义', () => {
    expect(phpOf('{"s":"a\\nb"}')).toContain('"a\\nb"')
    expect(phpOf('{"s":"a\\tb"}')).toContain('"a\\tb"')
    expect(phpOf('{"s":"a\\rb"}')).toContain('"a\\rb"')
  })

  it('其它控制字符用 \\xXX', () => {
    expect(phpOf('{"s":"\\u0001"}')).toContain('"\\x01"')
    expect(phpOf('{"s":"\\u000b"}')).toContain('"\\x0b"')
  })

  it('中文保持真实字符（② 转义不在转换器里暴露）', () => {
    expect(phpOf('{"s":"中"}')).toContain('"s" => "中"')
    expect(phpOf('{"s":"\\u4e2d"}')).toContain('"s" => "中"')
  })

  it('\\uXXXX 非 ASCII 被解码为真实字符', () => {
    expect(phpOf('{"s":"\\ud83d\\ude00"}')).toContain('"s" => "😀"')
  })

  it('空容器都写成 []', () => {
    expect(phpOf('{"o":{},"a":[]}')).toBe('$data = [\n    "o" => [],\n    "a" => []\n];')
  })

  it('顶层数组与顶层标量', () => {
    expect(phpOf('[1,2]', 2)).toBe('$data = [\n  1,\n  2\n];')
    expect(phpOf('1')).toBe('$data = 1;')
  })

  it('缩进 2 与制表符', () => {
    expect(phpOf('{"a":{"b":1}}', 2)).toContain('  "a" => [')
    expect(phpOf('{"a":{"b":1}}', 'tab')).toContain('\t"a" => [')
  })

  it('空输入返回空串', () => {
    expect(phpOf('')).toBe('')
  })

  it('非法输入按 Result 报错', () => {
    const result = jsonToPhp('{"a":}')
    expect(result.ok).toBe(false)
  })
})
