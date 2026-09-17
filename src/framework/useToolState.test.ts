import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TOOL_STATE_KEY } from './storage'
import { useToolState } from './useToolState'

/**
 * `useToolState` 是 spec「工具输入输出状态持久化」（按 id 隔离、重开恢复、互不污染）的
 * 唯一落点，此前只有各工具组件的间接覆盖，没有框架层用例。S1 点名的两处缺口 ——
 * 「恢复各工具上次输入」与「状态互不污染」—— 在这里直接钉住。
 */

const INITIAL = { input: '', options: { size: 8 } }

const seed = (entries: Record<string, unknown>) => {
  localStorage.setItem(TOOL_STATE_KEY, JSON.stringify(entries))
}

beforeEach(() => {
  localStorage.clear()
})

describe('useToolState', () => {
  it('挂载时恢复上次输入与参数，未保存过的字段回落初始值', () => {
    seed({ a: { input: '上次的输入', options: { size: 32 }, updatedAt: 1 } })

    const { result } = renderHook(() => useToolState('a', INITIAL))

    expect(result.current.state.input).toBe('上次的输入')
    expect(result.current.state.options.size).toBe(32)
  })

  it('没有历史状态时用初始值', () => {
    const { result } = renderHook(() => useToolState('never-used', INITIAL))

    expect(result.current.state.input).toBe('')
    expect(result.current.state.options.size).toBe(8)
  })

  it('按 id 隔离：工具 A 的改动不污染工具 B（spec「状态互不污染」）', () => {
    seed({
      a: { input: 'A 的内容', options: { size: 1 }, updatedAt: 1 },
      b: { input: 'B 的内容', options: { size: 2 }, updatedAt: 2 },
    })

    const a = renderHook(() => useToolState('a', INITIAL))
    const b = renderHook(() => useToolState('b', INITIAL))

    expect(a.result.current.state.input).toBe('A 的内容')
    expect(b.result.current.state.input).toBe('B 的内容')
    expect(a.result.current.state.options.size).toBe(1)
    expect(b.result.current.state.options.size).toBe(2)

    act(() => a.result.current.update({ input: 'A 改过' }))

    expect(a.result.current.state.input).toBe('A 改过')
    expect(b.result.current.state.input).toBe('B 的内容')
    expect(b.result.current.state.options.size).toBe(2)
  })

  it('updateOptions 合并而不是整体替换', () => {
    const { result } = renderHook(() => useToolState('a', INITIAL))

    act(() => result.current.updateOptions({ size: 64 }))

    expect(result.current.state.options.size).toBe(64)
  })

  it('reset 回到初始值并抹掉该工具的落盘条目', () => {
    seed({ a: { input: 'x', options: { size: 3 }, updatedAt: 1 } })
    const { result } = renderHook(() => useToolState('a', INITIAL))
    expect(result.current.state.input).toBe('x')

    act(() => result.current.reset())

    expect(result.current.state.input).toBe('')
    expect(result.current.state.options.size).toBe(8)
    expect(localStorage.getItem(TOOL_STATE_KEY) ?? '').not.toContain('"a"')
  })

  it('seed 优先于本地持久化（跳转带来的输入必须赢，旧持久内容整体不参与）', () => {
    seed({ a: { input: '旧的持久化内容', options: { size: 32 }, updatedAt: 1 } })

    const { result } = renderHook(() =>
      useToolState('a', INITIAL, { input: '跳转带来的 JSON' }),
    )

    expect(result.current.state.input).toBe('跳转带来的 JSON')
    // seed 存在时不读持久化：持久化的 size 是 32，这里必须是初始值 8
    expect(result.current.state.options.size).toBe(8)
  })

  it('seed 的 options 参与合并（不会被忽略）', () => {
    seed({ a: { input: 'x', options: { size: 32 }, updatedAt: 1 } })

    const { result } = renderHook(() => useToolState('a', INITIAL, { options: { size: 64 } }))

    expect(result.current.state.options.size).toBe(64)
  })

  it('seed 会把交接来的内容写回持久化', async () => {
    const { result } = renderHook(() => useToolState('a', INITIAL, { input: '交接内容' }))

    // 去抖 200ms
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(localStorage.getItem(TOOL_STATE_KEY) ?? '').toContain('交接内容')
    expect(result.current.state.input).toBe('交接内容')
  })

  it('不传 seed 时行为与从前一致', () => {
    seed({ a: { input: '上次的输入', options: { size: 32 }, updatedAt: 1 } })

    const { result } = renderHook(() => useToolState('a', INITIAL))

    expect(result.current.state.input).toBe('上次的输入')
    expect(result.current.state.options.size).toBe(32)
  })
})
