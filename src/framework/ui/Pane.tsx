import type { ReactNode } from 'react'

export interface PaneProps {
  title?: string
  actions?: ReactNode
  tone?: 'default' | 'danger'
  children: ReactNode
  className?: string
}

export function Pane({ title, actions, tone = 'default', children, className }: PaneProps) {
  return (
    <section
      className={[
        'flex min-h-0 flex-col rounded-md border bg-surface',
        tone === 'danger' ? 'border-danger/60' : 'border-border',
        className ?? '',
      ].join(' ')}
    >
      {(title || actions) && (
        <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-2.5">
          <span className="truncate text-[12px] font-medium tracking-wide text-muted uppercase">
            {title}
          </span>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  )
}
