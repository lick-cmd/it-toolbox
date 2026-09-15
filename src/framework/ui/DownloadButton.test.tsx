/**
 * T13 追加（不在计划 Files 内）：
 * `DownloadButton` 是本任务**唯一偏离计划文本**的产物 —— 计划原文
 * `onClick={() => void downloadText(...)}` 丢弃 Result，使「用户取消」与「写失败」
 * 都无任何反馈（T14 评审 IMPORTANT-1；与 R69 叠加即是桌面端文本导出**静默失效**）。
 * 本文件把该偏离的行为钉住，尤其是「取消不算失败」这条计划中不存在的新语义。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadText } from '../file'
import { DownloadButton } from './DownloadButton'

vi.mock('../file', () => ({ downloadText: vi.fn() }))

const mockDownload = vi.mocked(downloadText)

beforeEach(() => {
  mockDownload.mockReset()
})

describe('DownloadButton', () => {
  it('成功时把参数交给 downloadText 并反馈「已下载」', async () => {
    mockDownload.mockResolvedValue({ ok: true, value: undefined })
    const user = userEvent.setup()
    render(<DownloadButton filename="a.json" text="{}" mime="application/json" />)

    await user.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toContain('已下载')
    })
    expect(mockDownload).toHaveBeenCalledWith('a.json', '{}', 'application/json')
  })

  it('写失败时反馈「下载失败」，不再静默（T14 评审 IMPORTANT-1）', async () => {
    mockDownload.mockResolvedValue({ ok: false, error: '保存文件失败', code: 'WRITE_FAILED' })
    const user = userEvent.setup()
    render(<DownloadButton filename="a.json" text="{}" />)

    await user.click(screen.getByRole('button'))

    await waitFor(() => {
      expect(screen.getByRole('button').textContent).toContain('下载失败')
    })
  })

  it('用户主动取消不算失败，保持原标签', async () => {
    mockDownload.mockResolvedValue({ ok: false, error: '已取消保存', code: 'CANCELLED' })
    const user = userEvent.setup()
    render(<DownloadButton filename="a.json" text="{}" label="导出" />)

    await user.click(screen.getByRole('button'))

    // 先确认异步回调真的跑过，否则本用例会空转通过
    await waitFor(() => {
      expect(mockDownload).toHaveBeenCalledTimes(1)
    })
    expect(screen.getByRole('button').textContent).toContain('导出')
    expect(screen.getByRole('button').textContent).not.toContain('失败')
  })

  it('文本为空时禁用', () => {
    render(<DownloadButton filename="a.json" text="" />)

    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
  })
})
