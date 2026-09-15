import { useMemo, useState } from 'react'
import { CATEGORIES } from '@/framework/categories'
import { listTools, type ToolEntry } from '@/framework/registry'
import { toggleFavorite, usePrefs } from '@/framework/usePrefs'
import { Icon } from '@/framework/ui/Icon'
import type { ToolCategory } from '@/framework/types'

export interface SidebarProps {
  activeId: string | null
  onSelect: (id: string) => void
  /** 窄窗模式下以覆盖层呈现 */
  overlay?: boolean
  onRequestClose?: () => void
}

function ToolRow({
  entry,
  active,
  favorite,
  onSelect,
  onToggleFavorite,
}: {
  entry: ToolEntry
  active: boolean
  favorite: boolean
  onSelect: (id: string) => void
  onToggleFavorite: (id: string) => void
}) {
  return (
    <li className="group/row flex items-center">
      <button
        type="button"
        onClick={() => onSelect(entry.meta.id)}
        aria-current={active ? 'page' : undefined}
        className={[
          'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-sm px-2 text-left text-[12.5px]',
          active ? 'bg-accent/15 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
        ].join(' ')}
      >
        <span className="truncate">{entry.meta.name}</span>
      </button>
      <button
        type="button"
        aria-label={favorite ? `取消收藏 ${entry.meta.name}` : `收藏 ${entry.meta.name}`}
        onClick={() => onToggleFavorite(entry.meta.id)}
        className={[
          'mr-1 shrink-0 rounded-sm p-1',
          favorite ? 'text-warn' : 'text-muted opacity-0 group-hover/row:opacity-100',
        ].join(' ')}
      >
        <Icon name={favorite ? 'star-filled' : 'star'} size={13} />
      </button>
    </li>
  )
}

export function Sidebar({ activeId, onSelect, overlay, onRequestClose }: SidebarProps) {
  const prefs = usePrefs()
  const [collapsed, setCollapsed] = useState<Set<ToolCategory>>(new Set())

  const byCategory = useMemo(() => {
    const map = new Map<ToolCategory, ToolEntry[]>()
    for (const category of CATEGORIES) map.set(category.id, [])
    for (const entry of listTools()) map.get(entry.meta.category)?.push(entry)
    return map
  }, [])

  const favorites = useMemo(
    () => prefs.favorites.map((id) => listTools().find((e) => e.meta.id === id)).filter(Boolean),
    [prefs.favorites],
  ) as ToolEntry[]

  const recents = useMemo(
    () =>
      prefs.recents
        .map((recent) => listTools().find((entry) => entry.meta.id === recent.id))
        .filter((entry): entry is ToolEntry => entry !== undefined),
    [prefs.recents],
  )

  const toggleCollapse = (category: ToolCategory) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  return (
    <nav
      aria-label="工具导航"
      className={[
        'flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface',
        overlay ? 'absolute inset-y-0 left-0 z-20 shadow-lg' : '',
      ].join(' ')}
    >
      {overlay && (
        <div className="flex h-9 items-center justify-between border-b border-border px-2.5">
          <span className="text-[12px] text-muted">工具导航</span>
          <button
            type="button"
            aria-label="关闭导航"
            onClick={onRequestClose}
            className="rounded-sm p-1 text-muted hover:text-fg"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {favorites.length > 0 && (
          <section className="mb-2">
            <h2 className="px-2 py-1 text-[11px] tracking-wide text-muted uppercase">收藏</h2>
            <ul className="m-0 list-none p-0">
              {favorites.map((entry) => (
                <ToolRow
                  key={`fav-${entry.meta.id}`}
                  entry={entry}
                  active={entry.meta.id === activeId}
                  favorite
                  onSelect={onSelect}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </ul>
          </section>
        )}

        {recents.length > 0 && (
          <section className="mb-2">
            <h2 className="px-2 py-1 text-[11px] tracking-wide text-muted uppercase">最近使用</h2>
            <ul className="m-0 list-none p-0">
              {recents.slice(0, 5).map((entry) => (
                <ToolRow
                  key={`recent-${entry.meta.id}`}
                  entry={entry}
                  active={entry.meta.id === activeId}
                  favorite={prefs.favorites.includes(entry.meta.id)}
                  onSelect={onSelect}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </ul>
          </section>
        )}

        {CATEGORIES.map((category) => {
          const entries = byCategory.get(category.id) ?? []
          // 类别下无工具时不展示（spec 要求）
          if (entries.length === 0) return null
          const isCollapsed = collapsed.has(category.id)

          return (
            <section key={category.id} className="mb-1">
              <button
                type="button"
                onClick={() => toggleCollapse(category.id)}
                aria-expanded={!isCollapsed}
                className="flex h-6 w-full items-center gap-1.5 rounded-sm px-2 text-[11px] tracking-wide text-muted uppercase hover:text-fg"
              >
                <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={12} />
                <Icon name={category.icon} size={13} />
                <span>{category.name}</span>
                <span className="ml-auto text-muted/60">{entries.length}</span>
              </button>

              {!isCollapsed && (
                <ul className="m-0 list-none p-0">
                  {entries.map((entry) => (
                    <ToolRow
                      key={entry.meta.id}
                      entry={entry}
                      active={entry.meta.id === activeId}
                      favorite={prefs.favorites.includes(entry.meta.id)}
                      onSelect={onSelect}
                      onToggleFavorite={toggleFavorite}
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </nav>
  )
}
