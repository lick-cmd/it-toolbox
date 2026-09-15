import { afterEach, describe, expect, it, vi } from 'vitest'
import { canCopyImage, copyImage, copyText } from './clipboard'

/**
 * R68：计划只为 `file.ts` 列了测试文件，`clipboard.ts` 的 68 行实现零覆盖，
 * 而它是 T13 的 `CopyButton`/`DownloadButton` 与 T19 导出功能的直接依赖。
 *
 * 本文件按实现意图独立推演：空内容短路、Web Clipboard 成功、Web Clipboard 失败
 * 且无 Tauri 回退、`navigator.clipboard` 缺失、能力探测的真/假两侧，
 * 以及图片复制的成功与失败路径。
 */
afterEach(() => {
  // 注意：`vi.restoreAllMocks()` 不会撤销 `vi.stubGlobal`，必须显式撤销
  vi.unstubAllGlobals()
})

function stubNavigator(clipboard: unknown): void {
  vi.stubGlobal('navigator', { clipboard })
}

class FakeClipboardItem {
  constructor(readonly items: Record<string, Blob>) {}
}

describe('copyText', () => {
  it('空内容短路，返回 EMPTY 且不触碰剪贴板', async () => {
    const writeText = vi.fn()
    stubNavigator({ writeText })

    const result = await copyText('')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('应当失败')
    expect(result.error).toBe('没有可复制的内容')
    expect(result.code).toBe('EMPTY')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('Web Clipboard 可用时写入并返回成功', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ writeText })

    const result = await copyText('hello')

    expect(result.ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('Web Clipboard 被拒且无 Tauri 回退时返回 CLIPBOARD_UNAVAILABLE', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    stubNavigator({ writeText })

    const result = await copyText('hello')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('应当失败')
    // 被拒的原始原因被 catch 吞掉，对外统一报「当前环境不支持」——见报告的遗留项
    expect(result.code).toBe('CLIPBOARD_UNAVAILABLE')
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it('navigator.clipboard 缺失时返回 CLIPBOARD_UNAVAILABLE', async () => {
    stubNavigator(undefined)

    const result = await copyText('hello')

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('应当失败')
    expect(result.code).toBe('CLIPBOARD_UNAVAILABLE')
  })
})

describe('canCopyImage / copyImage', () => {
  it('缺少 ClipboardItem 时能力为 false，复制返回 CLIPBOARD_UNAVAILABLE', async () => {
    stubNavigator({ write: vi.fn() })

    expect(canCopyImage()).toBe(false)

    const result = await copyImage(new Blob(['x'], { type: 'image/png' }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('应当失败')
    expect(result.code).toBe('CLIPBOARD_UNAVAILABLE')
  })

  it('ClipboardItem 与 clipboard.write 齐备时能力为 true，复制成功', async () => {
    const write = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ write })
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)

    expect(canCopyImage()).toBe(true)

    const result = await copyImage(new Blob(['x'], { type: 'image/png' }))

    expect(result.ok).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('clipboard.write 抛错时返回 CLIPBOARD_FAILED 并带上原因', async () => {
    const write = vi.fn().mockRejectedValue(new Error('WriteError'))
    stubNavigator({ write })
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)

    const result = await copyImage(new Blob(['x'], { type: 'image/png' }))

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('应当失败')
    expect(result.code).toBe('CLIPBOARD_FAILED')
    expect(result.detail).toBe('WriteError')
  })
})
