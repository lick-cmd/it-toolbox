/**
 * T7 偏离说明：计划原文用了 3 处 jest-dom 匹配器（`toHaveTextContent` / `toHaveValue`），
 * 但仓库未安装 `@testing-library/jest-dom` ⇒ 实测报 `Invalid Chai property`。
 * 沿用本仓库既有约定（见 ErrorNote.test.tsx 顶部），全部改为语义等价的
 * `textContent` + `toContain` 与 `.value` + `toBe`，断言意图与计划逐条一致。
 * （注：该缺陷在计划①的 T13 已出现过一次，本计划的 UI 任务仍有复现。）
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TokenGeneratorTool from './Tool'

/** CodeArea 只读态渲染的是带行号的行列表，故取每行最后一个 span 的文本。 */
function outputLines(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((item) => item.lastElementChild?.textContent ?? '')
}

beforeEach(() => {
  localStorage.clear()
})

describe('Token 生成器', () => {
  it('首次渲染按默认参数生成一个 32 位 Token', () => {
    render(<TokenGeneratorTool />)

    const lines = outputLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toHaveLength(32)
  })

  it('长度改为 64、字符集改为十六进制后输出 64 位十六进制', async () => {
    const user = userEvent.setup()
    render(<TokenGeneratorTool />)

    await user.clear(screen.getByLabelText('长度'))
    await user.type(screen.getByLabelText('长度'), '64')
    await user.selectOptions(screen.getByLabelText('字符集'), 'hex')

    const lines = outputLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('字符集选自定义但内容为空时提示不可为空且不输出结果', async () => {
    const user = userEvent.setup()
    render(<TokenGeneratorTool />)

    await user.selectOptions(screen.getByLabelText('字符集'), 'custom')

    expect(screen.getByRole('alert').textContent).toContain('自定义字符集不可为空')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('数量改为 5 时输出 5 行且互不相同', async () => {
    const user = userEvent.setup()
    render(<TokenGeneratorTool />)

    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '5')

    const lines = outputLines()
    expect(lines).toHaveLength(5)
    expect(new Set(lines).size).toBe(5)
  })

  it('前缀 sk_ 会出现在每一行开头', async () => {
    const user = userEvent.setup()
    render(<TokenGeneratorTool />)

    await user.type(screen.getByLabelText('前缀'), 'sk_')
    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '3')

    const lines = outputLines()
    expect(lines).toHaveLength(3)
    for (const line of lines) expect(line.startsWith('sk_')).toBe(true)
  })

  it('长度超出上限时提示范围且不输出结果', async () => {
    const user = userEvent.setup()
    render(<TokenGeneratorTool />)

    await user.clear(screen.getByLabelText('长度'))
    await user.type(screen.getByLabelText('长度'), '4097')

    expect(screen.getByRole('alert').textContent).toContain('长度必须为 1 到 4096 之间的整数')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('参数变更后重新挂载仍保留（按工具 id 持久化）', async () => {
    const user = userEvent.setup()
    const first = render(<TokenGeneratorTool />)

    await user.selectOptions(screen.getByLabelText('字符集'), 'hex')
    // 写入去抖 200ms：轮询到真的落盘，而不是死等固定时长。
    // 只断言「确实写入了」，不绑定具体存储键名 —— 键名属 storage.ts 的实现细节。
    await vi.waitFor(() => {
      expect(localStorage.length).toBeGreaterThan(0)
    })
    first.unmount()

    render(<TokenGeneratorTool />)
    expect(screen.getByLabelText<HTMLSelectElement>('字符集').value).toBe('hex')
  })
})
