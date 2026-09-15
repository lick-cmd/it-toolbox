import type { ErrorInfo } from '@/core/result'
import { Icon } from './Icon'

export interface ErrorNoteProps {
  info: ErrorInfo
}

export function ErrorNote({ info }: ErrorNoteProps) {
  const hasLocation =
    typeof info.line === 'number' || typeof info.column === 'number' || typeof info.offset === 'number'

  return (
    <div
      role="alert"
      className="flex items-start gap-2 border-t border-danger/40 bg-danger/10 px-2.5 py-2 text-[12px]"
    >
      <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-fg">{info.error}</p>

        {hasLocation && (
          <p className="code-text text-muted">
            {typeof info.line === 'number' && <span>第 {info.line} 行</span>}
            {typeof info.column === 'number' && <span> 第 {info.column} 列</span>}
            {typeof info.offset === 'number' && <span> （偏移 {info.offset}）</span>}
          </p>
        )}

        {info.detail && <p className="text-muted">{info.detail}</p>}

        {info.suggestion && (
          <p className="text-muted">
            建议：<span className="code-text text-fg">{info.suggestion}</span>
          </p>
        )}
      </div>
    </div>
  )
}
