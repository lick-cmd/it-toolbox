import { positionToLineColumn } from '@/core/json/scanner'

export interface CodeAreaProps {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  label?: string
  placeholder?: string
  rows?: number
  /** 出错行号（1 基），用于高亮 */
  errorLine?: number
  /** 出错字符偏移；未给 `errorLine` 时由组件用 `lineOfOffset` 兜底换算 */
  errorOffset?: number
  className?: string
}

export function CodeArea({
  value,
  onChange,
  readOnly = false,
  label,
  placeholder,
  rows = 10,
  errorLine,
  errorOffset,
  className,
}: CodeAreaProps) {
  // errorLine 优先（调用方已完成换算）；只给 errorOffset 时在此兜底换算 —— 否则该对外参数
  // 会静默无效。注意：定位只在**只读视图**生效，可编辑 textarea 不显示任何高亮。
  const effectiveErrorLine =
    errorLine ?? (errorOffset === undefined ? undefined : lineOfOffset(value, errorOffset))

  // 只读视图用带行号的行列表，以便逐行标错
  if (readOnly) {
    const lines = value.split('\n')
    return (
      <div className={['code-text relative min-h-0 overflow-auto', className ?? ''].join(' ')}>
        {label && <span className="sr-only">{label}</span>}
        {value.length === 0 ? (
          <p className="p-2.5 text-muted">{placeholder ?? '（空）'}</p>
        ) : (
          <ol className="m-0 list-none p-0">
            {lines.map((line, index) => {
              const lineNumber = index + 1
              const isError = effectiveErrorLine === lineNumber
              return (
                <li
                  key={`${lineNumber}-${line.length}`}
                  data-error={isError || undefined}
                  className={[
                    'flex gap-2.5 px-2.5',
                    isError ? 'bg-danger/15' : '',
                  ].join(' ')}
                >
                  <span className="w-9 shrink-0 text-right text-muted select-none">
                    {lineNumber}
                  </span>
                  <span className="whitespace-pre-wrap break-all">{line || ' '}</span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    )
  }

  return (
    <textarea
      aria-label={label}
      value={value}
      readOnly={readOnly}
      rows={rows}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      placeholder={placeholder}
      onChange={(event) => onChange?.(event.target.value)}
      className={[
        'code-text w-full resize-none border-0 bg-transparent p-2.5 outline-none',
        'placeholder:text-muted/70',
        className ?? '',
      ].join(' ')}
    />
  )
}

/** 由字符偏移推导出行号，供调用方设置 errorLine。 */
export function lineOfOffset(text: string, offset: number): number {
  return positionToLineColumn(text, offset).line
}
