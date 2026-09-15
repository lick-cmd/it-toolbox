// DownloadButton.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { downloadText } from '../file'
import { Icon } from './Icon'

export interface DownloadButtonProps {
  filename: string
  text: string
  mime?: string
  label?: string
  disabled?: boolean
}

export function DownloadButton({
  filename,
  text,
  mime,
  label = '下载',
  disabled,
}: DownloadButtonProps) {
  const [status, setStatus] = useState<'idle' | 'done' | 'failed'>('idle')
  const [failure, setFailure] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const onClick = useCallback(async () => {
    const result = await downloadText(filename, text, mime)
    // 用户主动取消保存不算失败（T14 评审 IMPORTANT-1）
    if (!result.ok && result.code === 'CANCELLED') return
    setStatus(result.ok ? 'done' : 'failed')
    // 失败原因以 title 呈现：否则「保存无权限（R69 的 ACL 拒绝）」与「磁盘写失败」
    // 在界面上无法区分，用户无从排查
    setFailure(result.ok ? '' : [result.error, result.detail].filter(Boolean).join('：'))
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus('idle'), 1500)
  }, [filename, text, mime])

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled || text.length === 0}
      title={status === 'failed' ? failure : undefined}
      className="inline-flex h-6 items-center gap-1 rounded-sm px-2 text-[12px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
    >
      <Icon name={status === 'done' ? 'check' : 'download'} size={13} />
      {status === 'done' ? '已下载' : status === 'failed' ? '下载失败' : label}
    </button>
  )
}
