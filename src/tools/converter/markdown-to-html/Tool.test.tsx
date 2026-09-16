import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownToHtmlTool from './Tool'

const preview = () => screen.getByTestId('md-preview')
const setInput = (value: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'Markdown 源码' }), {
    target: { value },
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  // `vi.restoreAllMocks()` 不撤销 `vi.stubGlobal`，必须显式撤销（本仓先例 clipboard.test.ts）
  vi.unstubAllGlobals()
})

describe('Markdown 转 HTML 工具', () => {
  it('预览渲染标题与段落', () => {
    render(<MarkdownToHtmlTool />)
    setInput('# 标题\n\n一段正文')

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('标题')
    expect(preview().textContent).toContain('一段正文')
  })

  it('源码视图展示 HTML 源码并可直接复制', async () => {
    render(<MarkdownToHtmlTool />)
    setInput('# 标题')
    await userEvent.click(screen.getByRole('button', { name: '源码' }))

    expect(screen.getByText('<h1>标题</h1>')).toBeDefined()
    expect(screen.getByRole('button', { name: '复制 HTML 源码' })).toBeDefined()
  })

  it('远程图片渲染为占位块，不产出 img 元素', () => {
    render(<MarkdownToHtmlTool />)
    setInput('![截图](https://example.com/a.png)')

    expect(preview().textContent).toContain('远程图片未加载')
    expect(preview().querySelector('img')).toBeNull()
  })

  it('外部链接不产出 a 元素，只读展示地址', () => {
    render(<MarkdownToHtmlTool />)
    setInput('[官网](https://example.com/docs)')

    expect(preview().querySelector('a')).toBeNull()
    expect(preview().textContent).toContain('https://example.com/docs')
  })

  it('script 标签不进入 DOM', () => {
    render(<MarkdownToHtmlTool />)
    setInput('<script>alert(1)</script>')

    expect(preview().querySelector('script')).toBeNull()
    expect(preview().textContent).toContain('alert(1)')
  })

  it('表格与代码块渲染为对应结构', () => {
    render(<MarkdownToHtmlTool />)
    setInput('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```js\nconst x = 1\n```\n')

    expect(preview().querySelector('table')).not.toBeNull()
    expect(preview().querySelector('pre code.language-js')).not.toBeNull()
  })

  it('空输入时展示空态', () => {
    render(<MarkdownToHtmlTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })

  // S1：原用例只断言「复制 HTML 源码」按钮存在，从未点过它、也没看过剪贴板内容
  it('复制 HTML 源码把源码写入剪贴板并给出反馈', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    // jsdom 的 navigator.clipboard 是 getter-only，故用 stubGlobal（先例 clipboard.test.ts:17-19）
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    render(<MarkdownToHtmlTool />)
    setInput('# 标题')
    await userEvent.click(screen.getByRole('button', { name: '源码' }))
    await userEvent.click(screen.getByRole('button', { name: '复制 HTML 源码' }))

    await vi.waitFor(() => {
      // markdown-it 的渲染结果以换行结束，源码视图与复制内容都保留它
      expect(writeText).toHaveBeenCalledWith('<h1>标题</h1>\n')
    })
    expect(await screen.findByText('已复制')).toBeDefined()
  })
})
