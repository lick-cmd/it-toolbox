import { describe, expect, it } from 'vitest'
import { CATEGORIES, categoryById, categoryOrder } from './categories'
import { TOOL_CATEGORIES, isToolCategory } from './types'

describe('类别定义', () => {
  it('覆盖全部 5 个类别且无遗漏', () => {
    expect(CATEGORIES.map((c) => c.id).sort()).toEqual([...TOOL_CATEGORIES].sort())
  })

  it('顺序值互不重复', () => {
    const orders = CATEGORIES.map((c) => c.order)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('每个类别都有中文显示名与图标', () => {
    for (const category of CATEGORIES) {
      expect(category.name.length).toBeGreaterThan(0)
      expect(category.icon.length).toBeGreaterThan(0)
    }
  })

  it('categoryById 可查得描述符', () => {
    expect(categoryById('crypto')?.name).toBe('加密')
    expect(categoryById('dev')?.name).toBe('开发')
  })

  it('categoryOrder 对未知值返回兜底排序', () => {
    expect(categoryOrder('crypto')).toBe(1)
    expect(categoryOrder('dev')).toBe(5)
  })
})

describe('isToolCategory', () => {
  it.each(['crypto', 'converter', 'web', 'image', 'dev'])('接受 %s', (value) => {
    expect(isToolCategory(value)).toBe(true)
  })

  it.each([['toolbox'], [''], [null], [undefined], [1], [{}]])('拒绝 %p', (value) => {
    expect(isToolCategory(value)).toBe(false)
  })
})
