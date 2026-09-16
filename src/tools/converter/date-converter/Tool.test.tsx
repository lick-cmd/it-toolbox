import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DateConverterTool from './Tool'

const input = () => screen.getByRole('textbox', { name: '日期或时间戳' })

/**
 * 一律用 `fireEvent.change` 而不是 `userEvent.type`：后者把 `{` `[` 当特殊键语法，
 * 会让「时间戳 / 日期字面量」这类含特殊字符的输入变得难以书写。
 */
const setInput = (value: string) => {
  fireEvent.change(input(), { target: { value } })
}

beforeEach(() => {
  localStorage.clear()
})

describe('日期转换器工具', () => {
  it('输入秒级时间戳后展示多项表示', () => {
    render(<DateConverterTool />)
    setInput('1700000000')

    expect(screen.getByText('2023-11-14T22:13:20.000Z')).toBeDefined()
    // 加 selector：jsdom 里受控 textarea 的文本内容等于其 value，会与结果行的 <code> 撞名
    expect(screen.getByText('1700000000', { selector: 'code' })).toBeDefined()
    expect(screen.getByText('1700000000000', { selector: 'code' })).toBeDefined()
    expect(screen.getByText('Unix 时间戳（秒）')).toBeDefined()
    expect(screen.getByText('RFC 2822')).toBeDefined()
  })

  it('无法识别的输入给出错误提示且不展示结果', () => {
    render(<DateConverterTool />)
    setInput('not-a-date')

    expect(screen.getByRole('alert').textContent).toContain('无法识别的日期格式')
    expect(screen.queryByText('ISO 8601（UTC）')).toBeNull()
  })

  it('歧义数字输入展示判定依据与提示', () => {
    render(<DateConverterTool />)
    setInput('20240315')

    expect(screen.getByText(/8 位数字，按秒级时间戳解释/)).toBeDefined()
    expect(screen.getByText(/该输入可能有多种解释/)).toBeDefined()
  })

  it('手动指定毫秒单位后按毫秒重新解释，且不再提示歧义', async () => {
    render(<DateConverterTool />)
    setInput('1700000000')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '时间戳单位' }),
      'milliseconds',
    )

    expect(screen.getByText('1970-01-20T16:13:20.000Z')).toBeDefined()
    expect(screen.getByText(/用户指定/)).toBeDefined()
    expect(screen.queryByText(/该输入可能有多种解释/)).toBeNull()
  })

  it('输入 ISO 8601 并标注识别到的格式', () => {
    render(<DateConverterTool />)
    setInput('2024-03-15T08:30:00Z')

    expect(screen.getByText('ISO 8601（UTC）')).toBeDefined()
    expect(screen.getByText('1710491400')).toBeDefined()
    expect(screen.getByText(/识别为 ISO 8601/)).toBeDefined()
  })

  it('日期字符串走本地时间分支并标注格式', () => {
    render(<DateConverterTool />)
    setInput('2024/03/15 08:30:00')

    expect(screen.getByText(/识别为 YYYY\/MM\/DD HH:mm:ss/)).toBeDefined()
  })

  it('空输入时展示空态', () => {
    render(<DateConverterTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})

describe('日期转换器 —— 常用时间快捷', () => {
  // 只伪造 Date，不动 setTimeout：React 调度与工具状态去抖仍用真实计时器
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2024, 2, 15, 10, 30, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('提供当前 / 今天 / 昨天 / 本月 / 上个月 / 今年 / 上一年七个入口', () => {
    render(<DateConverterTool />)
    for (const label of ['当前时间', '今天', '昨天', '本月', '上个月', '今年', '上一年']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
  })

  it('点击「今天」回填本地零点并给出对应时间戳', () => {
    render(<DateConverterTool />)
    fireEvent.click(screen.getByRole('button', { name: '今天' }))

    expect((input() as HTMLTextAreaElement).value).toBe('2024-03-15T00:00:00')
    const todayStart = new Date(2024, 2, 15).getTime()
    expect(
      screen.getByText(String(Math.floor(todayStart / 1000)), { selector: 'code' }),
    ).toBeDefined()
  })

  it('点击「上个月」回填上月 1 日零点', () => {
    render(<DateConverterTool />)
    fireEvent.click(screen.getByRole('button', { name: '上个月' }))
    expect((input() as HTMLTextAreaElement).value).toBe('2024-02-01T00:00:00')
  })

  it('点击「上一年」回填去年 1 月 1 日零点', () => {
    render(<DateConverterTool />)
    fireEvent.click(screen.getByRole('button', { name: '上一年' }))
    expect((input() as HTMLTextAreaElement).value).toBe('2023-01-01T00:00:00')
  })
})
