/**
 * T8 偏离说明（沿用仓库既有约定，见 src/framework/ui/ErrorNote.test.tsx 顶部）：
 * 1) 计划原文用了 jest-dom 的 `toBeInTheDocument`（2 处）与 `toHaveTextContent`，但仓库未安装
 *    `@testing-library/jest-dom` ⇒ 实测报 `Invalid Chai property`。改为语义等价断言。
 * 2) 计划原文的 `getByText(/时间戳/)` 会**同时命中输入区说明文字**里的「时间戳」二字
 *    （Testing Library 按元素的直接文本节点匹配 ⇒ 状态行 span 与输入区 p 各命中一次，
 *    实测 `Found multiple elements`）。改为锚定状态行的正则，意图（状态行展示解码时间戳）不变。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UlidGeneratorTool from './Tool'

function outputLines(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((item) => item.lastElementChild?.textContent ?? '')
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ULID 生成器', () => {
  it('首次渲染生成 10 条 26 位 ULID', () => {
    render(<UlidGeneratorTool />)

    const lines = outputLines()
    expect(lines).toHaveLength(10)
    for (const line of lines) expect(line).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('状态行展示解码出的时间戳', () => {
    render(<UlidGeneratorTool />)

    // 锚定到状态行整串，避开输入区说明文字里的「时间戳」字样
    const status = screen.getByText(/^共 \d+ 条 · 时间戳 /)
    expect(status.textContent).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/)
  })

  it('取消大写后输出为小写，且不改变已生成的那一批', async () => {
    const user = userEvent.setup()
    render(<UlidGeneratorTool />)

    const before = outputLines()
    await user.click(screen.getByLabelText('大写'))

    const after = outputLines()
    expect(after).toHaveLength(before.length)
    for (let i = 0; i < after.length; i++) {
      expect(after[i]).toBe(before[i]!.toLowerCase())
    }
  })

  it('数量改为 20 时输出 20 行且互不相同', async () => {
    const user = userEvent.setup()
    render(<UlidGeneratorTool />)

    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '20')

    const lines = outputLines()
    expect(lines).toHaveLength(20)
    expect(new Set(lines).size).toBe(20)
  })

  it('同一毫秒内的批量结果字典序严格递增', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const user = userEvent.setup()
    render(<UlidGeneratorTool />)

    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '30')

    const lines = outputLines()
    expect(lines).toHaveLength(30)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]! > lines[i - 1]!).toBe(true)
    }
  })

  it('数量超出上限时提示范围且不输出结果', async () => {
    const user = userEvent.setup()
    render(<UlidGeneratorTool />)

    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '1001')

    expect(screen.getByRole('alert').textContent).toContain('数量必须为 0 到 1000 之间的整数')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
