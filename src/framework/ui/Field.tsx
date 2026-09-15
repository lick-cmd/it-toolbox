// Field.tsx
import type { ReactNode } from 'react'

export interface FieldProps {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}

export function Field({ label, hint, children, className }: FieldProps) {
  return (
    <label className={['flex items-center gap-2 text-[12px]', className ?? ''].join(' ')}>
      <span className="shrink-0 text-muted" title={hint}>
        {label}
      </span>
      {children}
    </label>
  )
}
