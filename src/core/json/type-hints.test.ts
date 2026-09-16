import { describe, expect, it } from 'vitest'
import {
  collectTypeHints,
  JSON_TYPE_LABEL,
  jsonChildPath,
  jsonIndexPath,
  isPlainObject,
  TYPE_HINT_MAX_DEPTH,
  typeOf,
} from './type-hints'

describe('typeOf', () => {
  it('覆盖七种取值', () => {
    expect(typeOf({})).toBe('object')
    expect(typeOf([])).toBe('array')
    expect(typeOf('s')).toBe('string')
    expect(typeOf(1)).toBe('number')
    expect(typeOf(true)).toBe('boolean')
    expect(typeOf(null)).toBe('null')
    expect(typeOf(undefined)).toBe('absent')
  })

  it('null 不落进 object 分支', () => {
    // typeof null === 'object'，这是最容易写错的一处
    expect(typeOf(null)).not.toBe('object')
  })

  it('数组不落进 object 分支', () => {
    expect(typeOf([1])).not.toBe('object')
  })

  it('每种类型都有中文标签', () => {
    expect(JSON_TYPE_LABEL.string).toBe('字符串')
    expect(JSON_TYPE_LABEL.absent).toBe('缺失')
  })
})

describe('isPlainObject', () => {
  it('只认非 null 非数组的对象', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject({ a: 1 })).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject('s')).toBe(false)
  })
})

describe('jsonChildPath', () => {
  it('合法标识符用点号', () => {
    expect(jsonChildPath('$', 'abc')).toBe('$.abc')
    expect(jsonChildPath('$', '_x1')).toBe('$._x1')
    expect(jsonChildPath('$', '$weird')).toBe('$.$weird')
  })

  it('含点、空格、中文、引号的键改用方括号', () => {
    expect(jsonChildPath('$', 'a.b')).toBe('$["a.b"]')
    expect(jsonChildPath('$', 'a b')).toBe('$["a b"]')
    expect(jsonChildPath('$', '中文')).toBe('$["中文"]')
    expect(jsonChildPath('$', 'a"b')).toBe('$["a\\"b"]')
  })

  it('数字开头的键不被当成标识符', () => {
    expect(jsonChildPath('$', '1a')).toBe('$["1a"]')
  })
})

describe('jsonIndexPath', () => {
  it('用方括号包索引', () => {
    expect(jsonIndexPath('$', 0)).toBe('$[0]')
    expect(jsonIndexPath('$.list', 12)).toBe('$.list[12]')
  })
})

describe('collectTypeHints', () => {
  it('前序输出：根在最前，子节点跟随父节点', () => {
    expect(collectTypeHints({ a: 1, b: { c: 'x' } }).map((hint) => hint.path)).toEqual([
      '$',
      '$.a',
      '$.b',
      '$.b.c',
    ])
  })

  it('容器与字符串给出概要，标量不给', () => {
    const hints = collectTypeHints({ o: { a: 1 }, arr: [1, 2, 3], s: '中文', n: 1, t: true })
    const by = (path: string) => hints.find((hint) => hint.path === path)

    expect(by('$.o')?.summary).toBe('1 个键')
    expect(by('$.arr')?.summary).toBe('长度 3')
    expect(by('$.s')?.summary).toBe('长度 2')
    expect(by('$.n')?.summary).toBe('')
    expect(by('$.t')?.summary).toBe('')
  })

  it('字符串长度按码点计，emoji 不算两个', () => {
    expect(collectTypeHints('🚀')[0]?.summary).toBe('长度 1')
    expect(collectTypeHints('🚀🚀')[0]?.summary).toBe('长度 2')
  })

  it('数组元素用索引路径，嵌套不丢层级', () => {
    expect(collectTypeHints({ list: [{ x: null }] }).map((hint) => hint.path)).toEqual([
      '$',
      '$.list',
      '$.list[0]',
      '$.list[0].x',
    ])
  })

  it('顶层 null 是 null 而非 absent', () => {
    expect(collectTypeHints(null)[0]?.type).toBe('null')
    expect(collectTypeHints(undefined)[0]?.type).toBe('absent')
  })

  it('每个条目的 label 与其类型一致', () => {
    for (const hint of collectTypeHints({ a: [1, 'x', null, true] })) {
      expect(hint.label).toBe(JSON_TYPE_LABEL[hint.type])
    }
  })

  it('对象的键序即输入顺序', () => {
    expect(collectTypeHints({ z: 1, a: 2 }).map((hint) => hint.path)).toEqual(['$', '$.z', '$.a'])
  })

  it('空容器只产出自身一条', () => {
    expect(collectTypeHints({})).toHaveLength(1)
    expect(collectTypeHints([])).toHaveLength(1)
    expect(collectTypeHints({})[0]?.summary).toBe('0 个键')
  })

  it('超过深度上限时停止下钻但仍保留该节点', () => {
    // 迭代构造 300 层嵌套对象（递归构造会先炸在测试自己身上）
    let deep: unknown = 1
    for (let i = 0; i < 300; i++) deep = { n: deep }

    const hints = collectTypeHints(deep)
    // 根 + 上限层，恰好 TYPE_HINT_MAX_DEPTH + 1 条
    expect(hints).toHaveLength(TYPE_HINT_MAX_DEPTH + 1)
    expect(hints[hints.length - 1]?.type).toBe('object')
    expect(hints[hints.length - 1]?.summary).toBe('1 个键')
  })
})
