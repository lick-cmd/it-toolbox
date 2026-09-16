import { describe, expect, it } from 'vitest'
import { jsonToXml, sanitizeXmlName } from './json-to-xml'

function xmlOf(text: string, wrapArrayItems?: boolean): string {
  const result =
    wrapArrayItems === undefined ? jsonToXml(text) : jsonToXml(text, { wrapArrayItems })
  if (!result.ok) throw new Error(`期望成功，实际失败：${result.error}`)
  return result.value
}

describe('sanitizeXmlName', () => {
  it('合法名保持', () => {
    expect(sanitizeXmlName('name')).toBe('name')
    expect(sanitizeXmlName('中文键')).toBe('中文键')
    expect(sanitizeXmlName('a.b-c_d')).toBe('a.b-c_d')
  })

  it('非法字符换成下划线', () => {
    expect(sanitizeXmlName('a b')).toBe('a_b')
    expect(sanitizeXmlName('a:b')).toBe('a_b')
    expect(sanitizeXmlName('a/b')).toBe('a_b')
  })

  it('数字 / - / . 开头时前缀下划线', () => {
    expect(sanitizeXmlName('1bad')).toBe('_1bad')
    expect(sanitizeXmlName('-x')).toBe('_-x')
    expect(sanitizeXmlName('.x')).toBe('_.x')
  })

  it('空键变成下划线', () => {
    expect(sanitizeXmlName('')).toBe('_')
  })

  it('组合附标 #x0300–#x036F 保留（与 brief 的字面区间语义一致）', () => {
    expect(sanitizeXmlName('e\u0301')).toBe('e\u0301')
    expect(sanitizeXmlName('a\u0300')).toBe('a\u0300')
    expect(sanitizeXmlName('z\u036f')).toBe('z\u036f')
  })

  it('不在 #x0300–#x036F 内的标记仍净化（不放宽成任意 Unicode 标记）', () => {
    // U+0903 是通用 Unicode 组合标记，但不属 XML NameChar 允许的 #x0300–#x036F
    expect(sanitizeXmlName('a\u0903')).toBe('a_')
  })
})

describe('jsonToXml', () => {
  const DOC = '<?xml version="1.0" encoding="UTF-8"?>'

  it('基本形态：声明 + root 包住对象', () => {
    expect(xmlOf('{"a":1,"b":"x"}')).toBe(
      [DOC, '<root>', '  <a>1</a>', '  <b>x</b>', '</root>'].join('\n'),
    )
  })

  it('数组默认用同名元素重复', () => {
    expect(xmlOf('{"tags":["a","b"]}')).toContain('  <tags>a</tags>\n  <tags>b</tags>')
  })

  it('wrapArrayItems 时改成 <item> 包裹', () => {
    expect(xmlOf('{"tags":["a","b"]}', true)).toBe(
      [DOC, '<root>', '  <tags>', '    <item>a</item>', '    <item>b</item>', '  </tags>', '</root>'].join(
        '\n',
      ),
    )
  })

  it('顶层数组必须包成单个根元素（否则不是合法 XML）', () => {
    expect(xmlOf('[1,2]')).toBe(
      [DOC, '<root>', '  <item>1</item>', '  <item>2</item>', '</root>'].join('\n'),
    )
  })

  it('顶层数组内部的嵌套数组沿用用户 wrap 语义（同名元素重复），不因根是数组被传染', () => {
    expect(xmlOf('[{"tags":["a","b"]}]')).toBe(
      [
        DOC,
        '<root>',
        '  <item>',
        '    <tags>a</tags>',
        '    <tags>b</tags>',
        '  </item>',
        '</root>',
      ].join('\n'),
    )
  })

  it('顶层空数组仍是单个自闭合根元素', () => {
    expect(xmlOf('[]')).toBe(`${DOC}\n<root/>`)
  })

  it('null 写成自闭合，空字符串写成成对空元素（刻意区分）', () => {
    expect(xmlOf('{"none":null,"empty":""}')).toContain('  <none/>\n  <empty></empty>')
  })

  it('文本转义 & < >，回车转成字符引用', () => {
    expect(xmlOf('{"a":"x&y<z>w\\r"}')).toContain('<a>x&amp;y&lt;z&gt;w&#13;</a>')
  })

  it('XML 1.0 不可表示的字符替换为 U+FFFD（不丢弃、不报错）', () => {
    expect(xmlOf('{"a":"\\u0001"}')).toContain('<a>\uFFFD</a>')
    expect(xmlOf('{"a":"\\u001f"}')).toContain('<a>\uFFFD</a>')
    expect(xmlOf('{"a":"\\ud800"}')).toContain('<a>\uFFFD</a>')
    expect(xmlOf('{"a":"\\ufffe"}')).toContain('<a>\uFFFD</a>')
  })

  it('配对的代理对是合法星平面字符，不被误伤', () => {
    expect(xmlOf('{"a":"\\ud83d\\ude00"}')).toContain('<a>\u{1F600}</a>')
  })

  it('XML 1.0 合法的 TAB / LF 原样保留，CR 仍写成字符引用', () => {
    expect(xmlOf('{"a":"\\t\\n"}')).toContain('<a>\t\n</a>')
    expect(xmlOf('{"a":"\\r"}')).toContain('<a>&#13;</a>')
  })

  it('元素名净化', () => {
    expect(xmlOf('{"1bad":"x","a b":"y"}')).toContain('  <_1bad>x</_1bad>\n  <a_b>y</a_b>')
  })

  it('数字用原文（大整数保真）', () => {
    expect(xmlOf('{"id":12345678912345678,"e":1e2,"n":-0}')).toContain(
      '<id>12345678912345678</id>',
    )
    expect(xmlOf('{"id":12345678912345678,"e":1e2,"n":-0}')).toContain('<e>1e2</e>')
    expect(xmlOf('{"id":12345678912345678,"e":1e2,"n":-0}')).toContain('<n>-0</n>')
  })

  it('布尔与嵌套', () => {
    expect(xmlOf('{"ok":true,"m":{"deep":[1]}}')).toBe(
      [
        DOC,
        '<root>',
        '  <ok>true</ok>',
        '  <m>',
        '    <deep>1</deep>',
        '  </m>',
        '</root>',
      ].join('\n'),
    )
  })

  it('空对象写成自闭合根元素', () => {
    expect(xmlOf('{}')).toBe(`${DOC}\n<root/>`)
  })

  it('缩进 4', () => {
    const result = jsonToXml('{"a":{"b":1}}', { indent: 4 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toContain('    <a>')
  })

  it('空输入返回空串', () => {
    expect(xmlOf('')).toBe('')
  })

  it('非法输入按 Result 报错', () => {
    const result = jsonToXml('{"a":}')
    expect(result.ok).toBe(false)
  })
})
