import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PREF_KEY,
  TOOL_STATE_KEY,
  clearToolStateEntry,
  loadToolStateEntry,
  pruneToolState,
  readJson,
  saveToolStateEntry,
  writeJson,
} from './storage'

describe('readJson / writeJson', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('往返一致', () => {
    writeJson('k', { a: 1, b: ['x'] })
    expect(readJson('k', null)).toEqual({ a: 1, b: ['x'] })
  })

  it('缺失键返回兜底值', () => {
    expect(readJson('missing', { fallback: true })).toEqual({ fallback: true })
  })

  it('损坏的 JSON 返回兜底值而非抛错', () => {
    window.localStorage.setItem('broken', '{not json')
    expect(readJson('broken', 'fallback')).toBe('fallback')
  })

  it('localStorage 抛错时降级为内存且不崩溃', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(() => writeJson('k', 'v')).not.toThrow()
    setItem.mockRestore()
  })
})

describe('pruneToolState', () => {
  const entry = (input: string, updatedAt: number) => ({ input, options: {}, updatedAt })

  it('保留未超限的条目', () => {
    const store = { a: entry('x', 1), b: entry('y', 2) }
    expect(Object.keys(pruneToolState(store)).sort()).toEqual(['a', 'b'])
  })

  it('丢弃超过单工具上限的条目', () => {
    const huge = entry('x'.repeat(60 * 1024), 1)
    expect(Object.keys(pruneToolState({ huge, ok: entry('y', 2) }))).toEqual(['ok'])
  })

  it('总量超限时优先淘汰最久未更新者', () => {
    // 单条 48KB < 50KB 单工具上限；43 条序列化后 2115538 字节 > 2MB（2097152）全局上限。
    // 原计划的 3 条 700KB 会因**超过单工具上限**在总量检查前就被全部丢弃，永远走不到淘汰循环（裁决 R65）。
    const big = 'z'.repeat(48 * 1024)
    const store: Record<string, ReturnType<typeof entry>> = {}
    for (let i = 0; i < 43; i++) store[`t${i}`] = entry(big, i)
    const pruned = pruneToolState(store)
    // 淘汰最旧的 t0 后为 2066341 字节 ≤ 上限，循环即停；其余按 updatedAt 升序保留。
    expect(Object.keys(pruned)).toEqual(Array.from({ length: 42 }, (_, i) => `t${i + 1}`))
  })
})

describe('工具状态存取', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('写入后可读回', () => {
    saveToolStateEntry('uuid-generator', { input: 'abc', options: { count: 3 }, updatedAt: 10 })
    expect(loadToolStateEntry('uuid-generator')).toEqual({
      input: 'abc',
      options: { count: 3 },
      updatedAt: 10,
    })
  })

  it('清空后返回 undefined', () => {
    saveToolStateEntry('uuid-generator', { input: 'abc', options: {}, updatedAt: 1 })
    clearToolStateEntry('uuid-generator')
    expect(loadToolStateEntry('uuid-generator')).toBeUndefined()
  })

  it('各工具状态相互隔离', () => {
    saveToolStateEntry('a', { input: 'A', options: {}, updatedAt: 1 })
    saveToolStateEntry('b', { input: 'B', options: {}, updatedAt: 2 })
    expect(loadToolStateEntry('a')?.input).toBe('A')
    expect(loadToolStateEntry('b')?.input).toBe('B')
  })

  it('使用版本化键名，便于将来迁移', () => {
    saveToolStateEntry('a', { input: 'A', options: {}, updatedAt: 1 })
    expect(window.localStorage.getItem(TOOL_STATE_KEY)).toContain('"a"')
    expect(PREF_KEY.startsWith('itt:v1:')).toBe(true)
  })
})

// R66：上面「localStorage 抛错时降级为内存且不崩溃」只在 writeJson 的 try/catch 层面通过 ——
// 同文件前几条用例已把模块级 driver 缓存为 localStorage 实现，故那条用例里的 setItem 抛错
// 被静默吞掉，内存降级路径从未执行、isUsingMemoryFallback() 始终为 false。
// 这里用「新模块实例 + 探测前即抛错」真正跑通降级路径（spec：存储不可用须降级为无持久化模式）。
describe('存储不可用时的降级', () => {
  it('探测即失败时切换到内存驱动，读写仍可用且不落盘', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })
    vi.resetModules()
    const fresh = await import('./storage')

    expect(fresh.isUsingMemoryFallback()).toBe(true)
    fresh.writeJson('k', { a: 1 })
    expect(fresh.readJson('k', null)).toEqual({ a: 1 })
    expect(window.localStorage.getItem('k')).toBeNull()

    spy.mockRestore()
    vi.resetModules()
  })
})
