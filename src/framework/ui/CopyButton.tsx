// CopyButton.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { copyText } from '../clipboard'
import { Icon } from './Icon'

export interface CopyButtonProps {
  text: string
  label?: string
  disabled?: boolean
}

export function CopyButton({ text, label = '复制', disabled }: CopyButtonProps) {
  const [status, setStatus] = useState<'idle' | 'done' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const onClick = useCallback(async () => {
    const result = await copyText(text)
    setStatus(result.ok ? 'done' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus('idle'), 1500)
  }, [text])

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled || text.length === 0}
      className="inline-flex h-6 items-center gap-1 rounded-sm px-2 text-[12px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
    >
      <Icon name={status === 'done' ? 'check' : 'copy'} size={13} />
      {status === 'done' ? '已复制' : status === 'failed' ? '复制失败' : label}
    </button>
  )
}
