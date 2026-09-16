import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import UrlAnalyzerTool from './Tool'

const setUrl = (value: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), { target: { value } })
}

/** 参数表去掉表头后的数据行 */
const paramRows = () => {
  const table = screen.getByTestId('url-params')
  return within(table)
    .getAllByRole('row')
    .slice(1)
}

beforeEach(() => {
  localStorage.clear()
})

describe('URL 分析器工具', () => {
  it('完整 URL 的各组成部分都被展示', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://user:pass@example.com:8443/a/b?x=1&x=2#sec')

    expect(screen.getByText('https:')).toBeDefined()
    expect(screen.getByText('user')).toBeDefined()
    expect(screen.getByText('pass')).toBeDefined()
    expect(screen.getByText('example.com')).toBeDefined()
    expect(screen.getByText('8443')).toBeDefined()
    expect(screen.getByText('/a/b')).toBeDefined()
    expect(screen.getByText('sec')).toBeDefined()
  })

  it('Origin 推导结果被展示', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://user:pass@example.com:8443/a/b')

    expect(screen.getByText('https://example.com:8443')).toBeDefined()
  })

  it('未写端口时补默认端口并标注', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://example.com/path')

    expect(screen.getByText('443')).toBeDefined()
    expect(screen.getByText('协议默认端口')).toBeDefined()
    expect(screen.getByText('（输入中未写出）')).toBeDefined()
  })

  it('同名查询参数逐行展示且顺序保持', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://example.com/?x=1&x=2')

    const rows = paramRows()
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getAllByRole('cell')[1]!.textContent).toBe('1')
    expect(within(rows[1]!).getAllByRole('cell')[1]!.textContent).toBe('2')
  })

  it('路径分段逐项展示', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://example.com/a/b/c')

    const list = screen.getByTestId('url-segments')
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('编码字符并列展示原始与解码形式', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://example.com/%E4%B8%AD%E6%96%87/%E6%96%87?q=a+b')

    const parts = screen.getByTestId('url-parts').textContent ?? ''
    expect(parts).toContain('/%E4%B8%AD%E6%96%87/%E6%96%87')
    expect(parts).toContain('/中文/文')

    const row = paramRows()[0]!
    expect(row.textContent).toContain('a+b')
    expect(row.textContent).toContain('a b')
  })

  it('无查询参数时不渲染参数表', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://example.com/a')

    expect(screen.queryByTestId('url-params')).toBeNull()
    expect(screen.getByText('（无查询参数）')).toBeDefined()
  })

  it('无协议输入提示不是绝对 URL 并给出补全建议', () => {
    render(<UrlAnalyzerTool />)
    setUrl('example.com/a?x=1')

    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('不是绝对 URL')
    expect(screen.getByRole('button', { name: '按 https:// 补全' })).toBeDefined()
  })

  it('点击补全建议后按补全的 URL 重新分析', async () => {
    render(<UrlAnalyzerTool />)
    setUrl('example.com/a?x=1')
    await userEvent.click(screen.getByRole('button', { name: '按 https:// 补全' }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('example.com')).toBeDefined()
    expect(screen.getByText('443')).toBeDefined()
  })

  it('非法 URL 提示解析失败且不展示分段结果', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://exa mple.com/path')

    expect(screen.getByRole('alert').textContent).toContain('URL 解析失败')
    expect(screen.queryByTestId('url-parts')).toBeNull()
  })

  it('空输入时展示空态', () => {
    render(<UrlAnalyzerTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})
