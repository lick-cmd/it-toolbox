import { useSyncExternalStore } from 'react'
import { DEFAULT_THEME_MODE, type ThemeMode } from './theme'
import { PREF_KEY, readJson, writeJson } from './storage'

export interface RecentEntry {
  id: string
  at: number
  count: number
}

export interface Prefs {
  theme: ThemeMode
  favorites: string[]
  recents: RecentEntry[]
}

export const DEFAULT_PREFS: Prefs = {
  theme: DEFAULT_THEME_MODE, // spec P1：默认暗色
  favorites: [],
  recents: [],
}

const RECENTS_LIMIT = 12

let current: Prefs = normalize(readJson<Partial<Prefs>>(PREF_KEY, {}))

function normalize(raw: Partial<Prefs>): Prefs {
  return {
    theme: raw.theme ?? DEFAULT_PREFS.theme,
    favorites: Array.isArray(raw.favorites) ? raw.favorites.filter((x) => typeof x === 'string') : [],
    recents: Array.isArray(raw.recents)
      ? raw.recents.filter((r) => r && typeof r.id === 'string')
      : [],
  }
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getPrefs(): Prefs {
  return current
}

function commit(next: Prefs): void {
  current = next
  writeJson(PREF_KEY, next)
  emit()
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribePrefs, getPrefs, getPrefs)
}

export function setTheme(theme: ThemeMode): void {
  commit({ ...current, theme })
}

export function toggleFavorite(id: string): void {
  const has = current.favorites.includes(id)
  commit({
    ...current,
    favorites: has
      ? current.favorites.filter((item) => item !== id)
      : [...current.favorites, id],
  })
}

export function pushRecent(id: string): void {
  const existing = current.recents.find((entry) => entry.id === id)
  const others = current.recents.filter((entry) => entry.id !== id)
  const updated: RecentEntry = {
    id,
    at: Date.now(),
    count: (existing?.count ?? 0) + 1,
  }
  commit({ ...current, recents: [updated, ...others].slice(0, RECENTS_LIMIT) })
}

export function clearRecents(): void {
  commit({ ...current, recents: [] })
}

/** 仅供测试：重置内存中的偏好。 */
export function __resetPrefsForTests(): void {
  current = { ...DEFAULT_PREFS }
  writeJson(PREF_KEY, current)
  emit()
}
