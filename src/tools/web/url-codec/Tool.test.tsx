import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import UrlCodecTool from './Tool'

/** 只读 CodeArea 渲染的是行号列表，内容在每行最后一个 span */
const lines = () =>
  screen.getAllByRole('listitem').map((item) => item.lastElementChild?.textContent ?? '')

/**
 * 一律用 `fireEvent.change` 而不是 `userEvent.type`：后者把 `{` `[` 当特殊键语法，
 * 会让 URL 与 JSON 这类含特殊字符的输入变得难以书写。
 */
const setInput = (value: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: '待处理的文本' }), {
    target: { value },
  })
}

beforeEach(() => {
  localStorage.clear()
})

describe('URL 编码/解码工具', () => {
  it('默认组件模式编码 a b&c=d', () => {
    render(<UrlCodecTool />)
    setInput('a b&c=d')

    expect(lines()).toEqual(['a%20b%26c%3Dd'])
    expect(screen.getByRole('button', { name: '复制' })).toBeDefined()
  })

  it('切到整体 URI 模式后保留结构字符', async () => {
    render(<UrlCodecTool />)
    setInput('https://a.com/b c?d=e&f=g')
    await userEvent.click(screen.getByRole('button', { name: '整体 URI' }))

    expect(lines()).toEqual(['https://a.com/b%20c?d=e&f=g'])
  })

  it('切到表单模式后空格编码为 +', async () => {
    render(<UrlCodecTool />)
    setInput('a b')
    await userEvent.click(screen.getByRole('button', { name: '表单' }))

    expect(lines()).toEqual(['a+b'])
  })

  it('切换到解码方向后按当前模式解码', async () => {
    render(<UrlCodecTool />)
    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setInput('a%20b%26c%3Dd')

    expect(lines()).toEqual(['a b&c=d'])
  })

  it('表单模式解码把 + 还原为空格', async () => {
    render(<UrlCodecTool />)
    await userEvent.click(screen.getByRole('button', { name: '表单' }))
    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setInput('a+b')

    expect(lines()).toEqual(['a b'])
  })

  it('中文与 emoji 编码后再解码还原', async () => {
    render(<UrlCodecTool />)
    setInput('你好 🚀')
    const encoded = lines()[0] ?? ''
    expect(encoded).not.toContain('你')

    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setInput(encoded)

    expect(lines()).toEqual(['你好 🚀'])
  })

  it('以 % 结尾时提示非法转义且不给结果', async () => {
    render(<UrlCodecTool />)
    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setInput('abc%')

    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('非法的转义序列')
    expect(alert).toContain('偏移 3')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('%ZZ 提示非法转义', async () => {
    render(<UrlCodecTool />)
    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setInput('%ZZ')

    expect(screen.getByRole('alert').textContent).toContain('非法的转义序列')
  })

  it('状态栏标出方向与模式', async () => {
    render(<UrlCodecTool />)
    setInput('a b')
    expect(screen.getByText(/组件模式编码/)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: '表单' }))
    expect(screen.getByText(/表单模式编码/)).toBeDefined()
  })

  it('空输入时展示空态', () => {
    render(<UrlCodecTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})
