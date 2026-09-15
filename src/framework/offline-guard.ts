export type EgressKind = 'fetch' | 'XMLHttpRequest' | 'WebSocket' | 'EventSource' | 'sendBeacon'

export interface EgressViolation {
  kind: EgressKind
  target: string
  at: number
}

const violations: EgressViolation[] = []
let installed = false

/** 应用内部协议，不构成出网能力。 */
const INTERNAL_SCHEME = /^(?:ipc:|asset:|tauri:|blob:|data:)/i

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

/**
 * 判断目标是否为本机地址。
 *
 * 之所以以「目标是否外部」而非「是否调用网络 API」为判定标准：
 * Vite 的 HMR 依赖 ws://localhost，若无差别拦截会让开发环境不可用。
 */
export function isLocalTarget(target: string): boolean {
  if (!target) return true
  if (INTERNAL_SCHEME.test(target)) return true
  if (target.startsWith('//')) {
    // 协议相对地址：以当前页面协议解析外站
    return false
  }
  try {
    // 相对路径会落到占位 base 上，因而 hostname 为 localhost
    const url = new URL(target, 'http://localhost')
    return LOOPBACK_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

function record(kind: EgressKind, target: string): void {
  violations.push({ kind, target, at: Date.now() })
  console.error(
    `%c[offline-guard] 检测到外发请求 — ${kind}`,
    'background:#d92d20;color:#fff;padding:2px 6px;border-radius:3px',
    target,
  )
}

function targetOf(input: RequestInfo | URL | string): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url
  return String(input)
}

/**
 * 开发期外发检测（离线第 2 层）。
 *
 * 生产环境由 CSP 承担（第 1 层），本函数不应被静态引入生产包 ——
 * `main.tsx` 中须使用动态 import。
 */
export function installOfflineGuard(): void {
  if (installed) return
  installed = true

  const originalFetch = globalThis.fetch
  globalThis.fetch = function guardedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const target = targetOf(input)
    if (!isLocalTarget(target)) {
      record('fetch', target)
      throw new Error(`[offline-guard] 已拦截外发请求（fetch）：${target}`)
    }
    return originalFetch.call(globalThis, input, init)
  } as typeof globalThis.fetch

  const OriginalXhr = globalThis.XMLHttpRequest
  if (OriginalXhr) {
    class GuardedXhr extends OriginalXhr {
      override open(method: string, url: string | URL, ...rest: unknown[]): void {
        const target = targetOf(url)
        if (!isLocalTarget(target)) {
          record('XMLHttpRequest', target)
          throw new Error(`[offline-guard] 已拦截外发请求（XMLHttpRequest）：${target}`)
        }
        ;(super.open as (...args: unknown[]) => void)(method, url, ...rest)
      }
    }
    globalThis.XMLHttpRequest = GuardedXhr as typeof XMLHttpRequest
  }

  const OriginalWebSocket = globalThis.WebSocket
  if (OriginalWebSocket) {
    class GuardedWebSocket extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const target = targetOf(url)
        if (!isLocalTarget(target)) {
          record('WebSocket', target)
          throw new Error(`[offline-guard] 已拦截外发连接（WebSocket）：${target}`)
        }
        super(url, protocols)
      }
    }
    globalThis.WebSocket = GuardedWebSocket as typeof WebSocket
  }

  const OriginalEventSource = globalThis.EventSource
  if (OriginalEventSource) {
    class GuardedEventSource extends OriginalEventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        const target = targetOf(url)
        if (!isLocalTarget(target)) {
          record('EventSource', target)
          throw new Error(`[offline-guard] 已拦截外发连接（EventSource）：${target}`)
        }
        super(url, init)
      }
    }
    globalThis.EventSource = GuardedEventSource as typeof EventSource
  }

  if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    navigator.sendBeacon = ((url: string | URL) => {
      const target = targetOf(url)
      record('sendBeacon', target)
      console.error(`[offline-guard] 已拦截外发信标（sendBeacon）：${target}`)
      return false
    }) as typeof navigator.sendBeacon
  }
}

export function getEgressViolations(): readonly EgressViolation[] {
  return violations
}

/** 仅供测试重置违规记录（守卫本身一旦安装即不再卸载）。 */
export function __resetEgressViolationsForTests(): void {
  violations.length = 0
}
