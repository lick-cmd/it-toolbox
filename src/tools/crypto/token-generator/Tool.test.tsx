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
    // 默认字符集也要钉住：只断言长度的话，默认值被改成别的字符集也发现不了
    expect(lines[0]).toMatch(/^[a-zA-Z0-9]{32}$/)
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

  it('前缀 sk_ 会出现在每一行开头，且计入总数上限', async () => {
    const user = userEvent.setup()
    render(<TokenGeneratorTool />)

    await user.type(screen.getByLabelText('前缀'), 'sk_')
    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '3')

    const lines = outputLines()
    expect(lines).toHaveLength(3)
    for (const line of lines) expect(line.startsWith('sk_')).toBe(true)

    // 前缀必须参与总数核算：4000 × 25 = 100000「不含前缀刚好不超、含前缀就超」。
    // 界面若按不含前缀的公式校验，就会放行到 core，而 core 抛出的错曾被静默吞掉。
    await user.clear(screen.getByLabelText('长度'))
    await user.type(screen.getByLabelText('长度'), '4000')
    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '25')

    expect(screen.getByRole('alert').textContent).toContain('单次生成的字符总数不得超过 100000')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('长度超出上限时提示范围且不输出结果', async () => {
    const user = userEvent.setup()
    render(<TokenGeneratorTool />)

    // 先钉住「上限本身可用」：否则把守卫写成 `>=` 时，下面只测 4097 的断言仍会通过
    await user.clear(screen.getByLabelText('长度'))
    await user.type(screen.getByLabelText('长度'), '4096')
    expect(outputLines()[0]).toHaveLength(4096)

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
    // 显式 3s timeout（S6）：默认 1s 只剩 800ms 余量，与 typecheck/lint 并行时会假红；
    // uuid-generator 的同款用例早已传 `{ timeout: 3000 }`。
    await vi.waitFor(
      () => {
        expect(localStorage.length).toBeGreaterThan(0)
      },
      { timeout: 3000 },
    )
    // 「按工具 id 持久化」是这条用例的意图之一：同 key 往返在「换成任意常量 id」时也成立。
    // 注意 storage.ts 的布局是「单一 localStorage 键 + JSON 映射」，工具 id 是**映射里的键**
    // 而不是 localStorage 键名，故只能在落盘内容里找 id（不绑定 storage.ts 的完整键格式）。
    // 用「映射里存在该 id 这个键」而不是「内容里含该子串」：子串写法挡不住
    // `'token-generator-v2'` 这类仍含前缀的改名，等于放过了最常见的写错方式。
    const payloads = Object.keys(localStorage).map(
      (key) => JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>,
    )
    expect(payloads.some((payload) => Object.keys(payload).includes('token-generator'))).toBe(true)

    first.unmount()

    render(<TokenGeneratorTool />)
    expect(screen.getByLabelText<HTMLSelectElement>('字符集').value).toBe('hex')
  })
})
