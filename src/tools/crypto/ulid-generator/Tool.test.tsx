/**
 * T8 偏离说明（沿用仓库既有约定，见 src/framework/ui/ErrorNote.test.tsx 顶部）：
 * 1) 计划原文用了 jest-dom 的 `toBeInTheDocument`（2 处）与 `toHaveTextContent`，但仓库未安装
 *    `@testing-library/jest-dom` ⇒ 实测报 `Invalid Chai property`。改为语义等价断言。
 * 2) 计划原文的 `getByText(/时间戳/)` 会**同时命中输入区说明文字**里的「时间戳」二字
 *    （Testing Library 按元素的直接文本节点匹配 ⇒ 状态行 span 与输入区 p 各命中一次，
 *    实测 `Found multiple elements`）。改为锚定状态行的正则，意图（状态行展示解码时间戳）不变。
 * 3) 评审补强：spec 的「时间戳可解析」明确要求偏差 ≤ 2 秒，原用例只查格式；这里把时钟固定到
 *    毫秒位为 007 的时刻，既让格式断言确定（pad 写错就露），又把解析回的时间与当前时间比对。
 *    另补「同一毫秒」的同一性断言与 count=0 的空态断言。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetUlidStateForTests } from '@/core/crypto/ulid'
import UlidGeneratorTool from './Tool'

function outputLines(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((item) => item.lastElementChild?.textContent ?? '')
}

beforeEach(() => {
  localStorage.clear()
  // core 的单调性状态是模块级的：不清就跨用例串味，用例之间会互相影响
  __resetUlidStateForTests()
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

  it('状态行展示解码出的时间戳，且与当前时间偏差在 2 秒内', () => {
    // 固定到毫秒位为 007 的时刻：格式与偏差都变成确定值
    const fixedNow = 1_700_000_000_007
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
    render(<UlidGeneratorTool />)

    // 锚定到状态行整串，避开输入区说明文字里的「时间戳」字样
    const status = screen.getByText(/^共 \d+ 条 · 时间戳 /)
    const shown = status.textContent ?? ''
    const match = shown.match(/(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})/)
    if (!match) throw new Error(`状态行未展示可解析的时间戳：${shown}`)

    // 独立把展示文本解析回时间再比对（而非「看起来像时间戳」）：
    // 这正是 spec「解码出的时间戳与当前时间偏差 ≤ 2 秒」的要求
    const day = match[1]!
    const clock = match[2]!
    const decoded = new Date(`${day}T${clock}`).getTime()
    expect(Number.isNaN(decoded)).toBe(false)
    expect(Math.abs(decoded - Date.now())).toBeLessThanOrEqual(2000)

    // 毫秒必须补足 3 位并被解码正确（pad 尺寸写错时上面 \d{3} 先失败，这里再钉死取值）
    expect(clock.endsWith('.007')).toBe(true)
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
    const fixedNow = 1_700_000_000_000
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
    const user = userEvent.setup()
    render(<UlidGeneratorTool />)

    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '30')

    const lines = outputLines()
    expect(lines).toHaveLength(30)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]! > lines[i - 1]!).toBe(true)
    }
    // 「同一毫秒」这一前提本身也要成立：前 10 个字符是时间戳，必须整批相同，
    // 否则上面的递增可能只是跨毫秒的假象
    expect(new Set(lines.map((line) => line.slice(0, 10))).size).toBe(1)
  })

  it('数量超出上限时提示范围且不输出结果', async () => {
    const user = userEvent.setup()
    render(<UlidGeneratorTool />)

    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '1001')

    expect(screen.getByRole('alert').textContent).toContain('数量必须为 0 到 1000 之间的整数')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)

    // 数量的另一端：0 是合法值（core 允许），应落到空态而不是报错
    await user.clear(screen.getByLabelText('数量'))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('尚未生成')).toBeDefined()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
