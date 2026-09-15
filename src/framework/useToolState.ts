import { useCallback, useEffect, useRef, useState } from 'react'
import { clearToolStateEntry, loadToolStateEntry, saveToolStateEntry } from './storage'

const WRITE_DEBOUNCE_MS = 200

export interface ToolStateShape {
  input: string
  options: Record<string, unknown>
}

/**
 * 按工具 id 隔离的状态。
 *
 * 写入去抖 200ms，避免每次按键都触碰 localStorage。
 * 挂载时若存在历史状态则恢复，满足 spec 的「重新打开仍保留上次输入」。
 */
export function useToolState<S extends ToolStateShape>(toolId: string, initial: S) {
  const [state, setState] = useState<S>(() => {
    const saved = loadToolStateEntry(toolId)
    if (!saved) return initial
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
