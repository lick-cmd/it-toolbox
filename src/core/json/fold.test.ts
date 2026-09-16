import { describe, expect, it } from 'vitest'
import { formatJson } from './format'
import {
  EMPTY_FOLD_MODEL,
  buildFoldModel,
  collapseAllFoldLines,
  foldSummary,
  hiddenLines,
} from './fold'

describe('buildFoldModel', () => {
  const NESTED = '{\n  "a": {\n    "b": 1,\n    "c": 2\n  },\n  "d": [\n    1,\n    2\n  ]\n}'

  it('逐个容器给出开括号行、闭括号行与直接子项数', () => {
    expect(buildFoldModel(NESTED).ranges).toEqual([
      { openLine: 0, closeLine: 9, kind: 'object', childCount: 2 },
      { openLine: 1, closeLine: 4, kind: 'object', childCount: 2 },
      { openLine: 5, closeLine: 8, kind: 'array', childCount: 2 },
    ])
  })

  it('元素本身是容器时只算一项（不当成两个子项）', () => {
    // 空容器在同一行闭合、不成区间，于是父层的 `expectChild` 不会被它消费 ——
    // 「入栈前落账」这条判据若有误，这里会数成 0 项
    const model = buildFoldModel('[\n  {},\n  []\n]')
    expect(model.ranges).toEqual([{ openLine: 0, closeLine: 3, kind: 'array', childCount: 2 }])
  })

  it('嵌套数组里每层的子项数各自成立', () => {
    const model = buildFoldModel('[\n  [\n    1,\n    2\n  ],\n  [\n    3\n  ]\n]')
    expect(model.ranges).toEqual([
      { openLine: 0, closeLine: 8, kind: 'array', childCount: 2 },
      { openLine: 1, closeLine: 4, kind: 'array', childCount: 2 },
      { openLine: 5, closeLine: 7, kind: 'array', childCount: 1 },
    ])
  })

  it('重复键各算一项，与树形视图同口径', () => {
    const model = buildFoldModel('{\n  "a": 1,\n  "a": {\n    "b": 1\n  }\n}')
    expect(model.byOpenLine.get(0)?.childCount).toBe(2)
  })

  it('空容器不给区间（同一行内闭合，收起与展开没有区别）', () => {
    expect(buildFoldModel('{\n  "e": {},\n  "a": []\n}').ranges).toEqual([
      { openLine: 0, closeLine: 3, kind: 'object', childCount: 2 },
    ])
  })

  it('单行 JSON 与标量没有任何可折叠处', () => {
    expect(buildFoldModel('{"a":{"b":1}}').ranges).toEqual([])
    expect(buildFoldModel('123').ranges).toEqual([])
  })

  it('非法文本降级为空模型，不抛异常', () => {
    // 预览被截断时走的正是这条路：界面照常按纯文本显示，只是没有折叠
    expect(buildFoldModel('{\n  "a": {\n    "b": 1').ranges).toEqual([])
    expect(buildFoldModel('').ranges).toEqual([])
    expect(buildFoldModel('{\n  "a": {\n    "b": 1').byOpenLine.size).toBe(0)
  })

  it('与 formatJson 的实际输出对齐（行号即美化结果的行号）', () => {
    const formatted = formatJson('{"a":{"b":1,"c":2},"d":[1,2]}')
    expect(formatted.ok).toBe(true)
    if (!formatted.ok) return

    expect(buildFoldModel(formatted.value.output).ranges).toEqual([
      { openLine: 0, closeLine: 9, kind: 'object', childCount: 2 },
      { openLine: 1, closeLine: 4, kind: 'object', childCount: 2 },
      { openLine: 5, closeLine: 8, kind: 'array', childCount: 2 },
    ])
  })

  it('4 空格与制表符缩进下区间不变（折叠只看换行，不看缩进宽度）', () => {
    for (const indent of [4, 'tab'] as const) {
      const formatted = formatJson('{"a":{"b":1,"c":2}}', { indent })
      expect(formatted.ok).toBe(true)
      if (!formatted.ok) continue
      expect(buildFoldModel(formatted.value.output).ranges).toEqual([
        { openLine: 0, closeLine: 5, kind: 'object', childCount: 1 },
        { openLine: 1, closeLine: 4, kind: 'object', childCount: 2 },
      ])
    }
  })
})

describe('foldSummary', () => {
  it('对象报键数、数组报项数，与树形视图同口径', () => {
    expect(foldSummary({ openLine: 0, closeLine: 3, kind: 'object', childCount: 3 })).toBe('… 3 键')
    expect(foldSummary({ openLine: 0, closeLine: 3, kind: 'array', childCount: 3 })).toBe('… 3 项')
  })
})

describe('collapseAllFoldLines', () => {
  it('除根以外全部收起，根留在第 0 行展开', () => {
    const text = '{\n  "a": {\n    "b": 1\n  },\n  "d": [\n    1\n  ]\n}'
    expect(collapseAllFoldLines(buildFoldModel(text))).toEqual([1, 4])
  })

  it('单行 JSON 上没有任何行可收起', () => {
    expect(collapseAllFoldLines(EMPTY_FOLD_MODEL)).toEqual([])
  })
})

describe('hiddenLines', () => {
  const NESTED = '{\n  "a": {\n    "b": 1,\n    "c": 2\n  },\n  "d": [\n    1,\n    2\n  ]\n}'
  const model = buildFoldModel(NESTED)

  it('折叠某个容器只隐藏它自己的内容行（含闭括号行）', () => {
    expect([...hiddenLines(model, new Set([1]))]).toEqual([2, 3, 4])
    expect([...hiddenLines(model, new Set([5]))]).toEqual([6, 7, 8])
  })

  it('折叠外层时内层内容一并隐藏，展开外层后内层的折叠态仍在', () => {
    expect([...hiddenLines(model, new Set([0]))]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    // 内外同时折叠与只折叠外层等价：隐藏行取并集
    expect([...hiddenLines(model, new Set([0, 1]))]).toEqual([...hiddenLines(model, new Set([0]))])
  })

  it('没有折叠时不隐藏任何行', () => {
    expect(hiddenLines(model, new Set()).size).toBe(0)
  })

  it('集合里残留的旧行号查不到区间，自然不起作用', () => {
    // 换文档后折叠态按行号不再指向同一批节点，故无需额外的清洗步骤
    expect(hiddenLines(model, new Set([99])).size).toBe(0)
  })
})
