/**
 * T13 追加（不在计划 Files 内）：T13 评审 I-3 判定 `CopyButton` 为 Important ——
 * 它有真实的三态机（idle/done/failed）与 1500ms 回退定时器，且 **T19 立即消费**它
 * （计划第 6863 行），符合 R66/R68 的「零覆盖的生产代码 + 即将被消费」判据。
 * 断言不依赖 jest-dom（理由见 ErrorNote.test.tsx 顶部）。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { copyText } from '../clipboard'
import { CopyButton } from './CopyButton'

vi.mock('../clipboard', () => ({ copyText: vi.fn() }))

const mockCopy = vi.mocked(copyText)

beforeEach(() => {
  mockCopy.mockReset()
})

describe('CopyButton', () => {
  it('默认展示传入的标签', () => {
    render(<CopyButton text="hello" label="复制数据" />)

    expect(screen.getByRole('button').textContent).toContain('复制数据')
  })

  it('复制成功反馈「已复制」', async () => {
    mockCopy.mockResolvedValue({ ok: true, value: undefined })
    const user = userEvent.setup()
    render(<CopyButton text="hello" />)

    await user.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toContain('已复制')
    })
    expect(mockCopy).toHaveBeenCalledWith('hello')
  })

  it('复制失败反馈「复制失败」（spec 的「不可用时的降级」）', async () => {
    mockCopy.mockResolvedValue({
      ok: false,
      error: '当前环境不支持写入剪贴板',
      code: 'CLIPBOARD_UNAVAILABLE',
    })
    const user = userEvent.setup()
    render(<CopyButton text="hello" label="复制数据" />)

    await user.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toContain('复制失败')
    })
  })

  it('1500ms 后回落到原标签', async () => {
    mockCopy.mockResolvedValue({ ok: true, value: undefined })
    const user = userEvent.setup()
    render(<CopyButton text="hello" label="复制数据" />)

    await user.click(screen.getByRole('button'))
    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toContain('已复制')
    })

    await waitFor(
      () => {
        expect(screen.getByRole('button').textContent).toContain('复制数据')
      },
      { timeout: 2500 },
    )
  })

  it('文本为空时禁用（EMPTY 分支不可达）', () => {
    render(<CopyButton text="" />)

    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
  })
})
