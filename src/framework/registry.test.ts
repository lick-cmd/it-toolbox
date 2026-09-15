import { describe, expect, it } from 'vitest'
import { TOOL_CATEGORIES } from './types'
import { getRegistryIssues, getTool, listByCategory, listTools } from './registry'

describe('注册表不变式', () => {
  it('不存在任何注册问题', () => {
    // 任一违规（孤儿 meta、孤儿 Tool、id 重复、id 与目录名不符、
    // 类别非法、keywords 为空）都会使此断言失败
    expect(getRegistryIssues()).toEqual([])
  })

  it('每个条目都有 meta 与懒加载函数', () => {
    for (const entry of listTools()) {
      expect(entry.meta.id.length).toBeGreaterThan(0)
      expect(typeof entry.load).toBe('function')
    }
  })

  it('id 全局唯一', () => {
    const ids = listTools().map((e) => e.meta.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('类别均为已知枚举值', () => {
    for (const entry of listTools()) {
      expect(TOOL_CATEGORIES).toContain(entry.meta.category)
    }
  })

  it('keywords 非空且均为非空字符串', () => {
    for (const entry of listTools()) {
      expect(entry.meta.keywords.length).toBeGreaterThan(0)
      for (const keyword of entry.meta.keywords) {
        expect(keyword.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('getTool 对未知 id 返回 undefined', () => {
    expect(getTool('does-not-exist')).toBeUndefined()
  })

  it('listByCategory 只返回该类别且保持顺序稳定', () => {
    const crypto = listByCategory('crypto')
    expect(crypto.every((e) => e.meta.category === 'crypto')).toBe(true)
    expect(listByCategory('image')).toEqual([])

    // 同一输入两次调用结果一致
    expect(listByCategory('crypto').map((e) => e.meta.id)).toEqual(
      crypto.map((e) => e.meta.id),
    )
  })
})
