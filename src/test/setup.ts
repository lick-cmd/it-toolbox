import { webcrypto } from 'node:crypto'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// RTL 的自动 cleanup 依赖「全局可用的 afterEach」；本项目未开 `globals`（见 vitest.config.ts），
// 因此必须显式注册 —— 否则同一测试文件内多次 render 的 DOM 会互相泄漏（T13 实测：
// 第二个用例起报 `Found multiple elements with the role "alert"`）。
afterEach(() => {
  cleanup()
})

// jsdom 不实现 Element.scrollIntoView，而命令面板的「高亮项滚入视野」依赖它
// （T17 落地前预检实测：`Element.prototype.scrollIntoView` 为 undefined ⇒ 计划代码会抛错）
if (typeof window !== 'undefined' && !window.Element.prototype.scrollIntoView) {
  window.Element.prototype.scrollIntoView = vi.fn() as unknown as typeof window.Element.prototype.scrollIntoView
}

// jsdom 不实现 matchMedia，而主题「跟随系统」依赖它
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

// jsdom 30.0.1 不实现 SubtleCrypto（crypto.subtle 为 undefined），而 HMAC 与 RSA
// 工具依赖真实 WebCrypto。Node 的 webcrypto 与浏览器实现同源，直接接管整个 crypto
// （连同 getRandomValues 一起换掉，避免两套 crypto 混用）。
if (typeof window !== 'undefined' && !window.crypto.subtle) {
  Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true })
}
