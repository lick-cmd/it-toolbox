import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import QrcodeGeneratorTool from './Tool'

// 参数类型照着 `@/framework/file` 的真实签名写：`vi.fn(async () => …)` 会推成零参函数，
// 于是 `mock.calls[0]` 是长度 0 的元组，取第 0/1/2 项过不了 tsc。
const fileMocks = vi.hoisted(() => ({
  downloadText: vi.fn(async (_filename: string, _text: string, _mime?: string) => ({
    ok: true as const,
    value: undefined,
  })),
  downloadBlob: vi.fn(async (_filename: string, _blob: Blob) => ({
    ok: true as const,
    value: undefined,
  })),
  downloadBytes: vi.fn(async (_filename: string, _bytes: Uint8Array, _mime?: string) => ({
    ok: true as const,
    value: undefined,
  })),
  guessMime: vi.fn((_filename: string) => 'application/octet-stream'),
  isTauri: () => false,
}))

// 只替换落盘动作：jsdom 里真点会触发导航告警，且无法断言
vi.mock('@/framework/file', () => fileMocks)

const setInput = (value: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: '输入内容' }), { target: { value } })
}

const preview = () => screen.queryByTestId('qr-preview')
const previewSvg = () => preview()?.querySelector('svg') ?? null

const statusText = () => screen.getByText(/版本 v\d+/).textContent ?? ''
const versionOf = () => Number(/版本 v(\d+)/.exec(statusText())?.[1] ?? 0)
const modulesOf = () => Number(/模组 (\d+)×/.exec(statusText())?.[1] ?? 0)
const pixelsOf = () => Number(/输出 (\d+)×/.exec(statusText())?.[1] ?? 0)

beforeEach(() => {
  localStorage.clear()
  fileMocks.downloadText.mockClear()
  fileMocks.downloadBlob.mockClear()
})

describe('二维码生成器 —— 生成与预览', () => {
  it('默认参数下渲染出 SVG 预览与概要状态', () => {
    render(<QrcodeGeneratorTool />)
    setInput('hello')

    expect(previewSvg()).not.toBeNull()
    expect(statusText()).toContain('版本 v')
    expect(statusText()).toContain('模组')
    expect(statusText()).toContain('内容 5 字节')
  })

  it('实时预览：改输入即改输出，无需点击任何按钮', () => {
    render(<QrcodeGeneratorTool />)
    setInput('hello')
    const before = previewSvg()?.querySelector('path')?.getAttribute('d') ?? ''

    setInput('another text that is longer')
    const after = previewSvg()?.querySelector('path')?.getAttribute('d') ?? ''

    expect(before).not.toBe('')
    expect(after).not.toBe('')
    expect(after).not.toBe(before)
  })

  it('空输入（含纯空白）不生成预览', () => {
    render(<QrcodeGeneratorTool />)
    expect(screen.getByText('需要输入内容')).toBeDefined()
    expect(preview()).toBeNull()

    setInput('   ')
    expect(preview()).toBeNull()
  })

  it('中文内容正常生成', () => {
    render(<QrcodeGeneratorTool />)
    setInput('中文内容')

    expect(previewSvg()).not.toBeNull()
    // 4 个汉字 = 12 字节，不是 4
    expect(statusText()).toContain('内容 12 字节')
  })
})

describe('二维码生成器 —— 颜色与对比度', () => {
  it('自定义前景色与背景色进入预览', () => {
    render(<QrcodeGeneratorTool />)
    setInput('hello')

    fireEvent.change(screen.getByLabelText('前景色'), { target: { value: '#1565c0' } })
    fireEvent.change(screen.getByLabelText('背景色'), { target: { value: '#fffde7' } })

    const svg = previewSvg()
    expect(svg?.querySelector('path')?.getAttribute('fill')).toBe('#1565c0')
    expect(svg?.querySelector('rect')?.getAttribute('fill')).toBe('#fffde7')
  })

  it('对比度不足时给出警告，但仍按当前配色生成', () => {
    render(<QrcodeGeneratorTool />)
    setInput('hello')

    fireEvent.change(screen.getByLabelText('前景色'), { target: { value: '#ffffff' } })
    fireEvent.change(screen.getByLabelText('背景色'), { target: { value: '#fffffe' } })

    const warning = screen.getByText(/对比度约/)
    expect(warning.textContent).toContain('低于建议的 3:1')
    expect(previewSvg()).not.toBeNull()
  })

  it('对比度充足时不出现警告', () => {
    render(<QrcodeGeneratorTool />)
    setInput('hello')

    expect(screen.queryByText(/对比度约/)).toBeNull()
  })
})

describe('二维码生成器 —— 复杂度参数', () => {
  it('提高纠错等级使模组数增加（编码内容不变）', async () => {
    render(<QrcodeGeneratorTool />)
    setInput('a'.repeat(120))

    const lowVersion = versionOf()
    const lowModules = modulesOf()
    const lowPath = previewSvg()?.querySelector('path')?.getAttribute('d')

    await userEvent.click(screen.getByRole('button', { name: 'H' }))

    expect(versionOf()).toBeGreaterThan(lowVersion)
    expect(modulesOf()).toBeGreaterThan(lowModules)
    // 等级变了自然会换一份符号，这里只确认换的是符号而不是渲染参数
    expect(previewSvg()?.querySelector('path')?.getAttribute('d')).not.toBe(lowPath)
  })

  it('模块尺寸只改输出分辨率，不改版本与模组数', () => {
    render(<QrcodeGeneratorTool />)
    setInput('hello')

    const version = versionOf()
    const modules = modulesOf()
    const path = previewSvg()?.querySelector('path')?.getAttribute('d')
    const units = modules + 8 // 默认静默区 4

    expect(pixelsOf()).toBe(units * 4)

    fireEvent.change(screen.getByLabelText('模块尺寸'), { target: { value: '8' } })

    expect(pixelsOf()).toBe(units * 8)
    expect(versionOf()).toBe(version)
    expect(modulesOf()).toBe(modules)
    expect(previewSvg()?.querySelector('path')?.getAttribute('d')).toBe(path)
  })
})

describe('二维码生成器 —— 容量', () => {
  it('超出容量时提示内容过长并给出当前等级的上限', () => {
    render(<QrcodeGeneratorTool />)
    setInput('a'.repeat(3000))

    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('超出该纠错等级的容量上限')
    // M 等级上限 2331 字节
    expect(alert).toContain('2331')
    expect(alert).toContain('3000')
    expect(preview()).toBeNull()
  })

  it('换成容量更大的等级后同一内容可以生成', async () => {
    render(<QrcodeGeneratorTool />)
    setInput('a'.repeat(2600))

    expect(screen.getByRole('alert')).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: 'L' }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(previewSvg()).not.toBeNull()
  })
})

describe('二维码生成器 —— 导出与复制', () => {
  it('导出 SVG 交出与预览同源的矢量内容', async () => {
    render(<QrcodeGeneratorTool />)
    setInput('hello')

    await userEvent.click(screen.getByRole('button', { name: '导出 SVG' }))

    expect(fileMocks.downloadText).toHaveBeenCalledTimes(1)
    const [filename, text, mime] = fileMocks.downloadText.mock.calls[0] ?? []
    expect(filename).toBe('qrcode.svg')
    expect(mime).toBe('image/svg+xml')

    // 「与预览同源」按路径逐字比对，而不是拿 outerHTML 比字符串 ——
    // jsdom 的序列化会调整属性顺序与自闭合写法
    const downloaded = String(text)
    expect(downloaded).toContain('<svg')
    const holder = document.createElement('div')
    holder.innerHTML = downloaded
    expect(holder.querySelector('path')?.getAttribute('d')).toBe(
      previewSvg()?.querySelector('path')?.getAttribute('d'),
    )

    expect(screen.getByRole('status').textContent).toContain('已导出 SVG')
  })

  it('jsdom 没有 2D 上下文时导出 PNG 给出明确提示而不是静默失败', async () => {
    render(<QrcodeGeneratorTool />)
    setInput('hello')

    await userEvent.click(screen.getByRole('button', { name: '导出 PNG' }))

    expect(fileMocks.downloadBlob).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('不支持 Canvas')
  })

  it('复制图片在无剪贴板能力时报出原因并指向 PNG 下载', async () => {
    render(<QrcodeGeneratorTool />)
    setInput('hello')

    await userEvent.click(screen.getByRole('button', { name: '复制图片' }))

    // 这个环境没有 2D 上下文，先卡在 Canvas 一步；真机上才会进到剪贴板写入
    expect(screen.getByRole('status').textContent).toContain('不支持 Canvas')
  })

  it('没有可导出内容时不显示导出按钮', () => {
    render(<QrcodeGeneratorTool />)

    expect(screen.queryByRole('button', { name: '导出 PNG' })).toBeNull()
    expect(screen.queryByRole('button', { name: '导出 SVG' })).toBeNull()
    expect(screen.queryByRole('button', { name: '复制图片' })).toBeNull()
  })

  it('填入示例后可直接导出 SVG', async () => {
    render(<QrcodeGeneratorTool />)
    await userEvent.click(screen.getByRole('button', { name: '填入示例' }))

    expect(previewSvg()).not.toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '导出 SVG' }))
    expect(fileMocks.downloadText).toHaveBeenCalled()
  })
})
