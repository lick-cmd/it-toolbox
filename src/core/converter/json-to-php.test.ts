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

describe('jsonToPhp —— Unicode 转义开关', () => {
  type Rewrite = { keepEscapes?: boolean; unicode?: 'keep' | 'escape' | 'unescape' }

  const phpWith = (text: string, options: Rewrite) => {
    const result = jsonToPhp(text, options)
    if (!result.ok) throw new Error(`期望成功，实际失败：${result.error}`)
    return result.value
  }

  it("'keep' 与 'unescape' 等价：值已解码，中文保持真实字符", () => {
    expect(phpWith('{"s":"中"}', {})).toContain('"s" => "中"')
    expect(phpWith('{"s":"中"}', { unicode: 'keep' })).toBe(phpWith('{"s":"中"}', {}))
    expect(phpWith('{"s":"\\u4e2d"}', { unicode: 'unescape' })).toBe(phpWith('{"s":"\\u4e2d"}', {}))
  })

  it("unicode='escape' 非 ASCII 写成 \\u{码点}（键与值一视同仁）", () => {
    expect(phpWith('{"c":"中"}', { unicode: 'escape' })).toContain('"c" => "\\u{4e2d}"')
    expect(phpWith('{"中":1}', { unicode: 'escape' })).toContain('"\\u{4e2d}" => 1')
  })

  it('BMP 外用码点而非 UTF-16 代理对', () => {
    expect(phpWith('{"e":"😀"}', { unicode: 'escape' })).toContain('"e" => "\\u{1f600}"')
  })

  it('escape 不改变既有转义分支的写法与优先级', () => {
    expect(phpWith('{"s":"a\\"b"}', { unicode: 'escape' })).toContain('"a\\"b"')
    expect(phpWith('{"s":"a\\\\b"}', { unicode: 'escape' })).toContain('"a\\\\b"')
    expect(phpWith('{"s":"$x"}', { unicode: 'escape' })).toContain('"\\$x"')
    expect(phpWith('{"s":"a\\nb"}', { unicode: 'escape' })).toContain('"a\\nb"')
    expect(phpWith('{"s":"\\u0001"}', { unicode: 'escape' })).toContain('"\\x01"')
  })

  it('孤立代理码元在 escape 下按原样输出（PHP \\u{} 只接受码点）', () => {
    const raw = '{"s":"\\ud800"}'
    expect(phpWith(raw, { unicode: 'escape' })).toBe(phpWith(raw, {}))
  })

  it('keepEscapes 对 PHP 是 moot：两种取值输出相同', () => {
    expect(phpWith('{"s":"a\\/b"}', { keepEscapes: false })).toBe(
      phpWith('{"s":"a\\/b"}', { keepEscapes: true }),
    )
  })
})
