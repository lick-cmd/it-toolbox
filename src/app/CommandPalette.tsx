import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { categoryById } from '@/framework/categories'
import { searchTools } from '@/framework/search'
import { Icon } from '@/framework/ui/Icon'

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onSelect: (id: string) => void
}

const MAX_RESULTS = 40

export function CommandPalette({ open, onClose, onSelect }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const hits = useMemo(() => searchTools(query).slice(0, MAX_RESULTS), [query])

  // 每次打开重置查询与高亮项。
  // 必须用 useLayoutEffect：面板由 App 常驻渲染，关闭时内部 state 仍保留上次查询，
  // 若在 paint 之后（useEffect）才重置，重开会先闪一帧旧查询与旧结果。
  useLayoutEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // 高亮项滚动进入视野
  useEffect(() => {
    const item = listRef.current?.children[activeIndex]
    if (item instanceof HTMLElement) item.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!open) return null

  const commit = (index: number) => {
    const hit = hits[index]
    if (!hit) return
    onSelect(hit.entry.meta.id)
    onClose()
  }

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="absolute inset-0 z-30 flex items-start justify-center bg-black/40 pt-24"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="搜索工具"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[60vh] w-[min(560px,90vw)] flex-col overflow-hidden rounded-md border border-border bg-surface"
      >
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <Icon name="search" size={15} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索工具名称或关键词…"
            aria-label="搜索工具"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // 监听器挂在 window 上，因此输入框聚焦时快捷键与方向键都能生效
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => Math.min(index + 1, Math.max(hits.length - 1, 0)))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                commit(activeIndex)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              }
            }}
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
          <kbd className="shrink-0 rounded-sm border border-border px-1 text-[10px] text-muted">
            Esc
          </kbd>
        </div>

        {hits.length === 0 ? (
          <p className="p-4 text-center text-[12px] text-muted">没有匹配的工具</p>
        ) : (
          <ul
            ref={listRef}
            role="listbox"
            aria-label="匹配的工具"
            className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-1"
          >
            {hits.map((hit, index) => (
              <li key={hit.entry.meta.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(index)}
                  className={[
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left',
                    index === activeIndex ? 'bg-accent/15' : '',
                  ].join(' ')}
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">
                    {hit.entry.meta.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">
                    {categoryById(hit.entry.meta.category)?.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
