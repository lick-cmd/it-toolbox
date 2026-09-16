// Inputs.tsx
import type { ReactNode } from 'react'

const CONTROL =
  'h-6 rounded-sm border border-border bg-surface-2 px-1.5 text-[12px] text-fg outline-none focus:border-accent'

export interface SelectOption<T extends string> {
  value: T
  label: string
}

export function Select<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string
  options: readonly SelectOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <select
      aria-label={label}
      className={CONTROL}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label?: string
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
}) {
  return (
    <input
      aria-label={label}
      type="number"
      className={`${CONTROL} w-20`}
      value={value}
      min={min}
      max={max}
      onChange={(event) => {
        const next = Number(event.target.value)
        if (Number.isFinite(next)) onChange(next)
      }}
    />
  )
}

export function ColorInput({
  label,
  value,
  onChange,
}: {
  label?: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        aria-label={label}
        type="color"
        className="h-6 w-8 cursor-pointer rounded-sm border border-border bg-surface-2 p-0.5"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <code className="text-[11px] text-muted uppercase">{value}</code>
    </span>
  )
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px]">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 accent-accent"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  )
}

export function TextInput({
  label,
  value,
  placeholder,
  onChange,
  className,
}: {
  label?: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <input
      aria-label={label}
      type="text"
      className={`${CONTROL} ${className ?? ''}`}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      onChange={(event) => onChange(event.target.value)}
    />
  )
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string
  options: readonly SelectOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <span role="group" aria-label={label} className="inline-flex rounded-sm border border-border">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={[
            'h-6 px-2 text-[12px] first:rounded-l-sm last:rounded-r-sm',
            value === option.value
              ? 'bg-accent text-white'
              : 'bg-surface-2 text-muted hover:text-fg',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </span>
  )
}

/** 一次性动作按钮。类名沿用 CopyButton 的约定，保证工具栏内高度与圆角一致。 */
export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'ghost'
}) {
  const tone =
    variant === 'primary'
      ? 'bg-accent text-white hover:opacity-90'
      : 'text-muted hover:bg-surface-2 hover:text-fg'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-6 items-center gap-1 rounded-sm px-2 text-[12px] disabled:opacity-40 ${tone}`}
    >
      {children}
    </button>
  )
}

export function ToolbarRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{children}</div>
}
