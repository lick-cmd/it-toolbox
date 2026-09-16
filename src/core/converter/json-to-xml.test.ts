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

  it('null 写成自闭合，空字符串写成成对空元素（刻意区分）', () => {
    expect(xmlOf('{"none":null,"empty":""}')).toContain('  <none/>\n  <empty></empty>')
  })

  it('文本转义 & < >，回车转成字符引用', () => {
    expect(xmlOf('{"a":"x&y<z>w\\r"}')).toContain('<a>x&amp;y&lt;z&gt;w&#13;</a>')
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
