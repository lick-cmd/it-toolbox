import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadText, isTauri } from './file'

describe('isTauri', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__']
  })

  it('无 Tauri 标记时返回 false', () => {
    expect(isTauri()).toBe(false)
  })

  it('存在 Tauri 标记时返回 true', () => {
    ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {}
    expect(isTauri()).toBe(true)
  })
})

describe('downloadText（浏览器降级路径）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('创建并点击带 download 属性的锚点', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const result = await downloadText('a.json', '{"a":1}')
    expect(result.ok).toBe(true)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('导出后不遗留锚点元素', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadText('a.txt', 'x')
    expect(document.querySelectorAll('a[download]').length).toBe(0)
  })
})
