import { utf8ByteLength } from '@/core/bytes'

const PREFIX = 'itt:v1:'

export const PREF_KEY = `${PREFIX}prefs`
export const TOOL_STATE_KEY = `${PREFIX}toolState`

/** 单个工具的状态上限，超出则丢弃该工具的状态。 */
const MAX_TOOL_ENTRY_BYTES = 50 * 1024
/** 全量工具状态上限，超出按 updatedAt 从旧到新淘汰。 */
const MAX_TOTAL_BYTES = 2 * 1024 * 1024

interface StorageDriver {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

const memoryBacking = new Map<string, string>()

const memoryDriver: StorageDriver = {
  get: (key) => memoryBacking.get(key) ?? null,
  set: (key, value) => {
    memoryBacking.set(key, value)
  },
  remove: (key) => {
    memoryBacking.delete(key)
  },
}

let driver: StorageDriver | null = null
let usingFallback = false

function resolveDriver(): StorageDriver {
  if (driver) return driver
  try {
    const probe = `${PREFIX}__probe`
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    driver = {
      get: (key) => window.localStorage.getItem(key),
      set: (key, value) => window.localStorage.setItem(key, value),
      remove: (key) => window.localStorage.removeItem(key),
    }
  } catch {
    // 隐私模式、禁用存储或配额耗尽：应用必须仍然可用，只是不持久化
    usingFallback = true
    driver = memoryDriver
  }
  return driver
}

export function isUsingMemoryFallback(): boolean {
  resolveDriver()
  return usingFallback
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = resolveDriver().get(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    resolveDriver().set(key, JSON.stringify(value))
  } catch {
    // 配额耗尽等写入失败：静默降级，不影响当前会话
  }
}

export function removeKey(key: string): void {
  resolveDriver().remove(key)
}

export interface ToolStateEntry {
  input: string
  options: Record<string, unknown>
  updatedAt: number
}

type ToolStateStore = Record<string, ToolStateEntry>

function readStore(): ToolStateStore {
  return readJson<ToolStateStore>(TOOL_STATE_KEY, {})
}

/** 淘汰超限条目，避免 localStorage 被单一工具撑爆。 */
export function pruneToolState(store: ToolStateStore): ToolStateStore {
  const kept: [string, ToolStateEntry][] = []

  for (const [id, entry] of Object.entries(store)) {
    if (utf8ByteLength(JSON.stringify(entry)) <= MAX_TOOL_ENTRY_BYTES) {
      kept.push([id, entry])
    }
  }

  const sizeOf = (list: [string, ToolStateEntry][]): number =>
    utf8ByteLength(JSON.stringify(Object.fromEntries(list)))

  if (sizeOf(kept) <= MAX_TOTAL_BYTES) return Object.fromEntries(kept)

  // 最久未更新者先被淘汰
  kept.sort((a, b) => a[1].updatedAt - b[1].updatedAt)
  while (kept.length > 0 && sizeOf(kept) > MAX_TOTAL_BYTES) kept.shift()

  return Object.fromEntries(kept)
}

export function loadToolStateEntry(id: string): ToolStateEntry | undefined {
  return readStore()[id]
}

export function saveToolStateEntry(id: string, entry: ToolStateEntry): void {
  const store = readStore()
  store[id] = entry
  writeJson(TOOL_STATE_KEY, pruneToolState(store))
}

export function clearToolStateEntry(id: string): void {
  const store = readStore()
  delete store[id]
  writeJson(TOOL_STATE_KEY, store)
}
