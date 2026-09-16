import { describe, expect, it } from 'vitest'
import { jsonToYaml, yamlToJson } from './yaml'

function mustYamlToJson(text: string, indent?: 2 | 4): string {
  const result = yamlToJson(text, indent === undefined ? {} : { indent })
  if (!result.ok) throw new Error(`期望转换成功，实际失败：${result.error}`)
  return result.value
}

function mustJsonToYaml(text: string): string {
  const result = jsonToYaml(text)
  if (!result.ok) throw new Error(`期望转换成功，实际失败：${result.error}`)
  return result.value
}

describe('yamlToJson', () => {
  it('嵌套映射与数组转换为语义等价的 JSON', () => {
    const source = [
      'name: toolbox',
      'tags:',
      '  - crypto',
      '  - converter',
      'owner:',
      '  name: cankaili',
      '  admin: true',
      'nested:',
      '  list:',
      '    - 1',
      '    - 2',
      '',
    ].join('\n')
    const json = mustYamlToJson(source)
    const value: unknown = JSON.parse(json)
    expect(value).toEqual({
      name: 'toolbox',
      tags: ['crypto', 'converter'],
      owner: { name: 'cankaili', admin: true },
      nested: { list: [1, 2] },
    })
  })

  it('布尔值 / 数字 / null 保持原生类型而非字符串', () => {
    const json = mustYamlToJson('a: true\nb: 3\nc: null\nd: 1.5\n')
    const value = JSON.parse(json) as Record<string, unknown>
    expect(value['a']).toBe(true)
    expect(value['b']).toBe(3)
    expect(value['c']).toBeNull()
    expect(value['d']).toBe(1.5)
  })

  it('缩进配置生效：默认 2 空格，可选 4 空格', () => {
    const source = 'a: 1\nb: 2\n'
    expect(mustYamlToJson(source)).toContain('\n  "a": 1')
    expect(mustYamlToJson(source, 4)).toContain('\n    "a": 1')
  })

  it('多行字符串被保留为含换行的 JSON 字符串', () => {
    const json = mustYamlToJson('text: |\n  line 1\n  line 2\n')
    const value = JSON.parse(json) as Record<string, unknown>
    expect(value['text']).toBe('line 1\nline 2\n')
  })

  it('缩进错误的 YAML 给出错误行号（1 基）', () => {
    const result = yamlToJson('a: 1\n  b: 2\n')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_YAML')
      expect(result.line).toBe(2)
      expect(result.column).toBeGreaterThan(0)
      expect(result.offset).toBeTypeOf('number')
    }
  })

  it('空输入不报错且不输出内容', () => {
    const result = yamlToJson('   \n')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('')
  })

  it('仅含注释的文档按空输入处理', () => {
    const result = yamlToJson('# 只有注释\n')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('')
  })
})

describe('jsonToYaml', () => {
  it('对象转换为合法 YAML，且能被 yamlToJson 还原为原 JSON', () => {
    const source = '{"name":"toolbox","tags":["crypto","converter"],"meta":{"ok":true,"n":null}}'
    const yaml = mustJsonToYaml(source)
    expect(yaml).not.toContain('{')
    const back = yamlToJson(yaml)
    expect(back.ok).toBe(true)
    if (back.ok) expect(JSON.parse(back.value)).toEqual(JSON.parse(source))
  })

  it('数组使用列表语法且顺序保持', () => {
    const yaml = mustJsonToYaml('["b","a","c"]')
    expect(yaml).toBe('- b\n- a\n- c\n')
    const back = yamlToJson(yaml)
    if (back.ok) expect(JSON.parse(back.value)).toEqual(['b', 'a', 'c'])
  })

  it('缺少闭合括号时报错并指出位置', () => {
    const result = jsonToYaml('{\n  "a": 1\n')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('UNCLOSED')
      expect(result.line).toBe(3)
      expect(result.offset).toBeTypeOf('number')
    }
  })

  it('空输入不报错且不输出内容', () => {
    const result = jsonToYaml('')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('')
  })

  it('重复对象不产出锚点 / 别名（保证往返语义不变）', () => {
    const shared = { a: 1 }
    const source = JSON.stringify({ x: shared, y: shared })
    const yaml = mustJsonToYaml(source)
    expect(yaml).not.toContain('&')
    expect(yaml).not.toContain('*')
    const back = yamlToJson(yaml)
    if (back.ok) expect(JSON.parse(back.value)).toEqual(JSON.parse(source))
  })
})

describe('jsonToYaml 的缩进选项', () => {
  const NESTED = '{"a":{"b":{"c":1}}}'

  it('缺省与 indent: 2 等价', () => {
    const plain = jsonToYaml(NESTED)
    const two = jsonToYaml(NESTED, { indent: 2 })
    expect(plain.ok && two.ok).toBe(true)
    if (plain.ok && two.ok) expect(two.value).toBe(plain.value)
  })

  it('indent: 4 时嵌套更深', () => {
    const result = jsonToYaml(NESTED, { indent: 4 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toContain('    b:')
  })

  it('空输入仍返回空串', () => {
    const result = jsonToYaml('   ', { indent: 4 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('')
  })
})
