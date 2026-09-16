import { describe, expect, it } from 'vitest'
import { compareJson, failedSide, JSON_TYPE_LABEL, type DiffEntry } from './json-diff'

function diff(left: string, right: string): DiffEntry[] {
  const result = compareJson(left, right)
  if (!result.ok) throw new Error(`期望比较成功，实际失败：${result.error}`)
  return result.value
}

/** 按路径取唯一一条变更 */
function entryAt(entries: DiffEntry[], path: string): DiffEntry {
  const found = entries.find((entry) => entry.path === path)
  if (!found) {
    throw new Error(`未找到路径 ${path}，实际路径为 ${entries.map((entry) => entry.path).join(', ')}`)
  }
  return found
}

describe('compareJson —— 基本变更', () => {
  it('值修改：给出路径、新旧值与两侧类型', () => {
    const entries = diff('{"a":1}', '{"a":2}')
    expect(entries).toHaveLength(1)
    const entry = entryAt(entries, '$.a')
    expect(entry.kind).toBe('changed')
    expect(entry.left).toBe(1)
    expect(entry.right).toBe(2)
    expect(entry.leftType).toBe('number')
    expect(entry.rightType).toBe('number')
  })

  it('新增字段：kind 为 added，左侧类型为 absent', () => {
    const entries = diff('{"a":1}', '{"a":1,"b":3}')
    expect(entries).toHaveLength(1)
    const entry = entryAt(entries, '$.b')
    expect(entry.kind).toBe('added')
    expect(entry.right).toBe(3)
    expect(entry.rightType).toBe('number')
    expect(entry.leftType).toBe('absent')
  })

  it('删除字段：kind 为 removed，值取原值', () => {
    const entries = diff('{"a":1,"c":4}', '{"a":1}')
    expect(entries).toHaveLength(1)
    const entry = entryAt(entries, '$.c')
    expect(entry.kind).toBe('removed')
    expect(entry.left).toBe(4)
    expect(entry.leftType).toBe('number')
    expect(entry.rightType).toBe('absent')
  })

  it('删除整个子树时只产出一条，值取子树本身', () => {
    const entries = diff('{"a":1,"c":{"x":1,"y":2}}', '{"a":1}')
    expect(entries).toHaveLength(1)
    expect(entryAt(entries, '$.c').kind).toBe('removed')
    expect(entryAt(entries, '$.c').left).toEqual({ x: 1, y: 2 })
  })

  it('null 与布尔值的变化也能识别', () => {
    const entries = diff('{"a":null,"b":true}', '{"a":1,"b":false}')
    expect(entries).toHaveLength(2)
    expect(entryAt(entries, '$.a').leftType).toBe('null')
    expect(entryAt(entries, '$.b').leftType).toBe('boolean')
  })
})

describe('compareJson —— 数组', () => {
  it('按索引定位元素修改', () => {
    const entries = diff('{"list":[1,2,3]}', '{"list":[1,9,3]}')
    expect(entries).toHaveLength(1)
    const entry = entryAt(entries, '$.list[1]')
    expect(entry.kind).toBe('changed')
    expect(entry.left).toBe(2)
    expect(entry.right).toBe(9)
  })

  it('区分元素删除与元素新增', () => {
    const removed = diff('{"list":[1,2,3]}', '{"list":[1,2]}')
    expect(entryAt(removed, '$.list[2]').kind).toBe('removed')

    const added = diff('{"list":[1,2]}', '{"list":[1,2,3]}')
    expect(entryAt(added, '$.list[2]').kind).toBe('added')
    expect(entryAt(added, '$.list[2]').right).toBe(3)
  })

  it('同时存在修改与增删时三类都产出', () => {
    const entries = diff('{"list":[1,2,3]}', '{"list":[1,5,3,4]}')
    expect(entryAt(entries, '$.list[1]').kind).toBe('changed')
    expect(entryAt(entries, '$.list[3]').kind).toBe('added')
  })

  it('顶层数组的元素路径为 $[i]', () => {
    const entries = diff('[1,2]', '[1,3]')
    expect(entryAt(entries, '$[1]').kind).toBe('changed')
  })
})

describe('compareJson —— 嵌套与类型', () => {
  it('深层差异的路径完整反映层级', () => {
    const entries = diff('{"a":{"b":{"c":1}}}', '{"a":{"b":{"c":2}}}')
    expect(entries).toHaveLength(1)
    expect(entryAt(entries, '$.a.b.c').kind).toBe('changed')
  })

  it('类型变化标记为修改并同时给出两侧类型', () => {
    const entries = diff('{"a":1}', '{"a":"1"}')
    const entry = entryAt(entries, '$.a')
    expect(entry.kind).toBe('changed')
    expect(entry.leftType).toBe('number')
    expect(entry.rightType).toBe('string')
    expect(JSON_TYPE_LABEL.number).toBe('数字')
    expect(JSON_TYPE_LABEL.string).toBe('字符串')
  })

  it('数组与对象互换视为修改而非深层展开', () => {
    const entries = diff('{"a":[1]}', '{"a":{"0":1}}')
    expect(entries).toHaveLength(1)
    const entry = entryAt(entries, '$.a')
    expect(entry.kind).toBe('changed')
    expect(entry.leftType).toBe('array')
    expect(entry.rightType).toBe('object')
  })

  it('含特殊字符的键用方括号加引号的形式表达', () => {
    const entries = diff('{"a.b":1}', '{"a.b":2}')
    expect(entryAt(entries, '$["a.b"]').kind).toBe('changed')
  })
})

describe('compareJson —— 无差异与非法输入', () => {
  it('仅键序或空白不同时判定为无差异', () => {
    expect(diff('{"a":1,"b":2}', '{"b":2,"a":1}')).toEqual([])
    expect(diff('{\n  "a": 1\n}', '{"a":1}')).toEqual([])
  })

  it('深层键序不同同样无差异', () => {
    expect(diff('{"o":{"x":1,"y":2}}', '{"o":{"y":2,"x":1}}')).toEqual([])
  })

  it('数值写法不同但语义相同时无差异', () => {
    expect(diff('{"n":1.0}', '{"n":1}')).toEqual([])
  })

  it('左侧非法时错误码为 LEFT_BAD_JSON，且带定位', () => {
    const result = compareJson('{', '{}')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('LEFT_BAD_JSON')
    expect(result.error).toContain('左侧')
    expect(result.line).toBe(1)
    expect(failedSide(result)).toBe('left')
  })

  it('右侧非法时错误码为 RIGHT_BAD_JSON', () => {
    const result = compareJson('{}', '{')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('RIGHT_BAD_JSON')
    expect(result.error).toContain('右侧')
    expect(failedSide(result)).toBe('right')
  })

  it('两侧都非法时先报告左侧', () => {
    const result = compareJson('{', '[')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('LEFT_BAD_JSON')
  })

  it('空输入按该侧解析失败处理', () => {
    const result = compareJson('   ', '{}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('LEFT_BAD_JSON')
  })

  it('交换两侧后新增与删除互换', () => {
    const forward = diff('{"a":1}', '{"a":1,"b":2}')
    expect(entryAt(forward, '$.b').kind).toBe('added')

    const backward = diff('{"a":1,"b":2}', '{"a":1}')
    expect(entryAt(backward, '$.b').kind).toBe('removed')
  })

  it('成功的比较不产生失败的 side', () => {
    expect(failedSide({ ok: true, value: [] })).toBeNull()
    expect(failedSide({ ok: false, error: 'x', code: 'OTHER' })).toBeNull()
  })
})
