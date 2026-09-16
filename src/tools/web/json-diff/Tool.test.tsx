import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import JsonDiffTool from './Tool'

/**
 * 结果区用「标题文本 → 最近的 section」定位，而不是 `getByRole('region')`：
 * `Pane` 渲染的是无 `aria-labelledby` 的 `<section>`，没有可访问名就不会暴露为 region。
 * 这样也免得为了测试去改框架组件。
 */
const resultPane = () => {
  const title = screen.getByText('差异结果')
  const section = title.closest('section')
  if (!section) throw new Error('未找到差异结果面板')
  return section
}

const rows = () => within(resultPane()).getAllByRole('listitem')

const setSide = (side: 'left' | 'right', value: string) => {
  const name = side === 'left' ? '左侧 JSON' : '右侧 JSON'
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })
}

beforeEach(() => {
  localStorage.clear()
})

describe('JSON 差异比较工具', () => {
  it('值修改：展示路径与新旧值', () => {
    render(<JsonDiffTool />)
    setSide('left', '{"a":1}')
    setSide('right', '{"a":2}')

    const row = rows()[0]!
    expect(row.textContent).toContain('修改')
    expect(within(row).getByText('$.a')).toBeDefined()
    expect(row.textContent).toContain('1')
    expect(row.textContent).toContain('2')
  })

  it('新增与删除分别标注', () => {
    render(<JsonDiffTool />)
    setSide('left', '{"c":4}')
    setSide('right', '{"b":3}')

    const text = resultPane().textContent ?? ''
    expect(text).toContain('新增')
    expect(text).toContain('$.b')
    expect(text).toContain('删除')
    expect(text).toContain('$.c')
  })

  it('数组按索引定位并区分修改与增删', () => {
    render(<JsonDiffTool />)
    setSide('left', '{"list":[1,2,3]}')
    setSide('right', '{"list":[1,9]}')

    const text = resultPane().textContent ?? ''
    expect(text).toContain('$.list[1]')
    expect(text).toContain('修改')
    expect(text).toContain('$.list[2]')
    expect(text).toContain('删除')
  })

  it('嵌套差异的路径反映层级', () => {
    render(<JsonDiffTool />)
    setSide('left', '{"a":{"b":{"c":1}}}')
    setSide('right', '{"a":{"b":{"c":2}}}')

    expect(within(rows()[0]!).getByText('$.a.b.c')).toBeDefined()
  })

  it('类型变化时并列展示两侧类型', () => {
    render(<JsonDiffTool />)
    setSide('left', '{"a":1}')
    setSide('right', '{"a":"1"}')

    const text = rows()[0]!.textContent ?? ''
    expect(text).toContain('数字')
    expect(text).toContain('字符串')
  })

  it('仅键序不同时展示无差异', () => {
    render(<JsonDiffTool />)
    setSide('left', '{"a":1,"b":2}')
    setSide('right', '{"b":2,"a":1}')

    expect(within(resultPane()).getByText('两段 JSON 无差异')).toBeDefined()
    // 用 queryAllByRole：getAllByRole 在「一个都没找到」时会抛错，断言不了 0 条
    expect(within(resultPane()).queryAllByRole('listitem')).toHaveLength(0)
  })

  it('左侧非法时在左侧提示且不给差异结果', () => {
    render(<JsonDiffTool />)
    setSide('left', '{')
    setSide('right', '{}')

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('左侧 JSON 解析失败')
    expect(within(resultPane()).queryAllByRole('listitem')).toHaveLength(0)
  })

  it('右侧非法时在右侧提示', () => {
    render(<JsonDiffTool />)
    setSide('left', '{}')
    setSide('right', '[1,]')

    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.textContent).toContain('右侧 JSON 解析失败')
  })

  it('交换两侧后新增与删除互换', async () => {
    render(<JsonDiffTool />)
    setSide('left', '{"a":1}')
    setSide('right', '{"a":1,"b":2}')
    expect(resultPane().textContent).toContain('新增')

    await userEvent.click(screen.getByRole('button', { name: '交换两侧' }))

    expect((screen.getByRole('textbox', { name: '左侧 JSON' }) as HTMLTextAreaElement).value).toBe(
      '{"a":1,"b":2}',
    )
    expect((screen.getByRole('textbox', { name: '右侧 JSON' }) as HTMLTextAreaElement).value).toBe(
      '{"a":1}',
    )
    expect(resultPane().textContent).toContain('删除')
  })

  it('状态栏统计三类变更数量', () => {
    render(<JsonDiffTool />)
    setSide('left', '{"a":1,"c":4}')
    setSide('right', '{"a":2,"b":3}')

    expect(screen.getByText(/新增 1 · 删除 1 · 修改 1/)).toBeDefined()
  })

  it('两侧都为空时展示空态', () => {
    render(<JsonDiffTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})
