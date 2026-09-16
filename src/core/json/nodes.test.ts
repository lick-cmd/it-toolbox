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

  it('500 层嵌套下钻到最内层仍存在（无深度上限）', () => {
    const DEPTH = 500
    const deep = '['.repeat(DEPTH) + ']'.repeat(DEPTH)
    const result = buildJsonNodes(deep)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(`期望解析成功，实际失败：${result.error}`)

    // 沿 items[0] 一路下钻。若把 tree.ts 的 TREE_MAX_DEPTH 门搬进来，
    // 256 层之后只会消费 token 不建节点，下钻会提前停在一个空数组上，
    // 下面的 levels 断言随即变红 —— 深度上限回归无法再静默通过。
    let node: JsonNode = result.value
    let levels = 0
    while (node.kind === 'array' && node.items.length > 0) {
      const inner = node.items[0]
      if (inner === undefined) break
      node = inner
      levels++
    }

    expect(levels).toBe(DEPTH - 1)
    // `node` 在循环体内被赋为 JsonNode，窄化在此处已失效，需重新收窄才能读 items
    if (node.kind !== 'array') throw new Error(`期望停在内层数组，实际是 ${node.kind}`)
    expect(node.items).toHaveLength(0)
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
