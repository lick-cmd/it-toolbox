import { useCallback, useEffect, useState } from 'react'
import { getTool, listTools, type ToolEntry } from '@/framework/registry'
import { applyTheme, resolveTheme, systemPrefersDark } from '@/framework/theme'
import { pushRecent, usePrefs, type RecentEntry } from '@/framework/usePrefs'
import { ToolHost } from '@/framework/ToolHost'
import { Icon } from '@/framework/ui/Icon'
import { CommandPalette } from './CommandPalette'
import { Sidebar } from './Sidebar'
import { ThemeToggle } from './ThemeToggle'

const NARROW_QUERY = '(max-width: 899px)'

/**
 * 解析启动时要打开的工具 id。
 *
 * 历史最近使用里的 id 可能已失效（工具被改名或移除），此时必须回退到
 * 注册表首项 —— 否则应用启动即白屏。
 */
export function resolveLandingToolId(
  activeId: string | null,
  recents: readonly RecentEntry[],
  entries: readonly ToolEntry[],
): string | null {
  const fallback = entries[0]?.meta.id ?? null
  const candidate = activeId ?? recents[0]?.id ?? fallback
  if (candidate === null) return null
  return entries.some((entry) => entry.meta.id === candidate) ? candidate : fallback
}

export function App() {
  const prefs = usePrefs()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_QUERY).matches : false,
  )

  // 落地工具：优先最近使用，但注册表变化后历史 id 可能失效，必须回退
  const resolvedId = resolveLandingToolId(activeId, prefs.recents, listTools())
  const resolvedEntry = resolvedId ? getTool(resolvedId) : undefined

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY)
    const onChange = (event: MediaQueryListEvent) => {
      setIsNarrow(event.matches)
      if (!event.matches) setDrawerOpen(false)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const apply = () => applyTheme(resolveTheme(prefs.theme, systemPrefersDark()))
    apply()
    if (prefs.theme !== 'system') return

    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [prefs.theme])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // 输入框聚焦时仍需生效，因此监听 window 而非某个容器
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (event.key === 'Escape') setPaletteOpen(false)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const openTool = useCallback((id: string) => {
    setActiveId(id)
    pushRecent(id)
    setDrawerOpen(false)
  }, [])

  return (
    <div className="relative flex h-full">
      {!isNarrow && (
        <Sidebar activeId={resolvedId} onSelect={openTool} />
      )}

      {isNarrow && drawerOpen && (
        <>
          <div
            role="presentation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 z-10 bg-black/40"
          />
          <Sidebar
            activeId={resolvedId}
            onSelect={openTool}
            overlay
            onRequestClose={() => setDrawerOpen(false)}
          />
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
          {isNarrow && (
            <button
              type="button"
              aria-label="打开导航"
              onClick={() => setDrawerOpen(true)}
              className="rounded-sm p-1 text-muted hover:text-fg"
            >
              <Icon name="menu" size={16} />
            </button>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[13px] font-medium">
              {resolvedEntry?.meta.name ?? 'IT Toolbox'}
            </h1>
            {resolvedEntry && (
              <p className="truncate text-[11px] text-muted">{resolvedEntry.meta.description}</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm border border-border px-2 text-[11px] text-muted hover:text-fg"
          >
            <Icon name="search" size={13} />
            <span>搜索</span>
            <kbd className="text-[10px]">⌘K</kbd>
          </button>

          <ThemeToggle />
        </header>

        <main className="min-h-0 flex-1">
          {resolvedEntry ? <ToolHost entry={resolvedEntry} /> : <p className="p-4 text-muted">尚无可用工具</p>}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelect={openTool}
      />
    </div>
  )
}
