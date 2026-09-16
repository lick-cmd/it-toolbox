import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Icon } from './Icon'

export interface FileDropProps {
  onFile: (file: File) => void
  label?: string
  hint?: string
  disabled?: boolean
}

/**
 * 文件拖入 / 选择。
 *
 * 拖放与点选是两条独立路径，都必须落到同一个 `onFile`：拖放在 WebView 之间
 * 的 `dataTransfer.files` 行为最不一致，因此保留「选择文件」这条纯 DOM 的
 * 兜底路径（也是 jsdom 里唯一可自动化的路径）。
 *
 * 文件内容不在这里读取：`File` 交给调用方后由它决定用 `arrayBuffer()` 还是
 * `text()`，避免框架层替工具决定编码方式。
 */
export function FileDrop({ onFile, label = '拖入文件', hint, disabled = false }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [active, setActive] = useState(false)

  const accept = (file: File | undefined) => {
    if (!disabled && file) onFile(file)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setActive(false)
    accept(event.dataTransfer.files[0])
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setActive(true)
      }}
      onDragLeave={() => setActive(false)}
      onDrop={onDrop}
      className={[
        'flex flex-col items-center gap-1 rounded-md border border-dashed px-3 py-2 text-center',
        active ? 'border-accent bg-accent/10' : 'border-border',
        disabled ? 'opacity-40' : '',
      ].join(' ')}
    >
      <Icon name="download" size={14} className="text-muted" />
      <p className="text-[12px] text-muted">{label}</p>
      {hint && <p className="text-[11px] text-muted/70">{hint}</p>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent disabled:opacity-40"
      >
        选择文件
      </button>
      {/* sr-only 而非 hidden：jsdom 与无障碍工具都要能定位到这个 input */}
      <input
        ref={inputRef}
        type="file"
        aria-label={label}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          accept(event.target.files?.[0])
          // 清空 value，使「同一个文件连选两次」也能触发 change
          event.target.value = ''
        }}
      />
    </div>
  )
}
