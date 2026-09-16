import { describe, expect, it } from 'vitest'
import { buildJsonNodes, hasUnsafeInteger, type JsonNode } from './nodes'

function nodesOf(text: string): JsonNode {
  const result = buildJsonNodes(text)
  if (!result.ok) throw new Error(`期望解析成功，实际失败：${result.error}`)
  return result.value
}

describe('buildJsonNodes', () => {
  it('对象：键解码、键原文与值结构都对上', () => {
    const node = nodesOf('{"a":1,"b":"x"}')
    expect(node.kind).toBe('object')
    if (node.kind !== 'object') return
    expect(node.entries.map((entry) => entry.key)).toEqual(['a', 'b'])
    expect(node.entries[0]?.rawKey).toBe('"a"')
    expect(node.entries[0]?.value).toEqual({ kind: 'number', raw: '1' })
    expect(node.entries[1]?.value).toEqual({ kind: 'string', raw: '"x"' })
  })

  it('数字与字符串保留原文', () => {
    const node = nodesOf('{"big":12345678912345678,"neg":-0,"exp":1e2,"u":"\\u0041"}')
    if (node.kind !== 'object') throw new Error('期望对象')
    expect(node.entries.map((entry) => (entry.value as { raw: string }).raw)).toEqual([
      '12345678912345678',
      '-0',
      '1e2',
      '"\\u0041"',
    ])
  })

  it('重复键各自成节点，不折叠', () => {
    const node = nodesOf('{"dup":1,"dup":2}')
    if (node.kind !== 'object') throw new Error('期望对象')
    expect(node.entries).toHaveLength(2)
    expect(node.entries.map((entry) => entry.key)).toEqual(['dup', 'dup'])
  })

  it('数组保序，元素按下标', () => {
    const node = nodesOf('[1,"a",true,null,[],{}]')
    if (node.kind !== 'array') throw new Error('期望数组')
    expect(node.items.map((item) => item.kind)).toEqual([
      'number',
      'string',
      'boolean',
      'null',
      'array',
      'object',
    ])
  })

  it('空容器', () => {
    const node = nodesOf('{"o":{},"a":[]}')
    if (node.kind !== 'object') throw new Error('期望对象')
    expect(node.entries[0]?.value).toEqual({ kind: 'object', entries: [] })
    expect(node.entries[1]?.value).toEqual({ kind: 'array', items: [] })
  })

  it('顶层标量', () => {
    expect(nodesOf('1')).toEqual({ kind: 'number', raw: '1' })
    expect(nodesOf('"x"')).toEqual({ kind: 'string', raw: '"x"' })
    expect(nodesOf('null')).toEqual({ kind: 'null', raw: 'null' })
  })

  it('中文键解码正确（元素名净化要用它）', () => {
    const node = nodesOf('{"中文":"x"}')
    if (node.kind !== 'object') throw new Error('期望对象')
    expect(node.entries[0]?.key).toBe('中文')
  })

  it('非法输入按 Result 报错并给出行列', () => {
    const result = buildJsonNodes('{\n  "a": 1\n')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.line).toBeGreaterThan(0)
      expect(result.column).toBeGreaterThan(0)
    }
  })

  it('500 层嵌套不抛异常（与 scanJson 同阶深度）', () => {
    const deep = '['.repeat(500) + ']'.repeat(500)
    expect(() => buildJsonNodes(deep)).not.toThrow()
    expect(buildJsonNodes(deep).ok).toBe(true)
  })
})

describe('hasUnsafeInteger', () => {
  it('超出安全整数范围的整数为 true', () => {
    expect(hasUnsafeInteger('{"id":12345678912345678}')).toBe(true)
    expect(hasUnsafeInteger('{"id":9007199254740993}')).toBe(true)
  })

  it('安全范围内为 false', () => {
    expect(hasUnsafeInteger('{"id":9007199254740991}')).toBe(false)
    expect(hasUnsafeInteger('{"id":-0,"e":1e2,"f":1.5}')).toBe(false)
  })

  it('无法解析时为 false（不误报）', () => {
    expect(hasUnsafeInteger('{"id":')).toBe(false)
    expect(hasUnsafeInteger('')).toBe(false)
  })
})
