import { useCallback, useEffect, useRef, useState } from 'react'
import { clearToolStateEntry, loadToolStateEntry, saveToolStateEntry } from './storage'

const WRITE_DEBOUNCE_MS = 200

export interface ToolStateShape {
  input: string
  options: Record<string, unknown>
}

/** 跨工具交接的载荷：有值时优先于本地持久化 */
export interface ToolStateSeed {
  input?: string
  options?: Record<string, unknown>
}

/**
 * 按工具 id 隔离的状态。
 *
 * 写入去抖 200ms，避免每次按键都触碰 localStorage。
 * 挂载时若存在历史状态则恢复，满足 spec 的「重新打开仍保留上次输入」。
 *
 * `seed` 是跨工具跳转的落点：**它的优先级高于持久化** —— 跳转带来的这份输入
 * 才是用户当下的意图，若让旧内容盖掉它，功能看起来就完全失效了。
 */
export function useToolState<S extends ToolStateShape>(
  toolId: string,
  initial: S,
  seed?: ToolStateSeed,
) {
  const [state, setState] = useState<S>(() => {
    const base = {
      ...initial,
      input: seed?.input ?? initial.input,
      options: { ...initial.options, ...seed?.options },
    } as S

    if (seed) return base

    const saved = loadToolStateEntry(toolId)
    if (!saved) return base
    return {
      ...initial,
      input: saved.input,
      options: { ...initial.options, ...saved.options },
    } as S
  })

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      saveToolStateEntry(toolId, {
        input: state.input,
        options: state.options,
        updatedAt: Date.now(),
      })
    }, WRITE_DEBOUNCE_MS)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [toolId, state.input, state.options])

  const update = useCallback((patch: Partial<S>) => {
    setState((prev) => ({ ...prev, ...patch }))
  }, [])

  const updateOptions = useCallback((patch: Record<string, unknown>) => {
    setState((prev) => ({ ...prev, options: { ...prev.options, ...patch } }))
  }, [])

  const reset = useCallback(() => {
    clearToolStateEntry(toolId)
    setState(initial)
  }, [toolId, initial])

  return { state, update, updateOptions, reset }
}
