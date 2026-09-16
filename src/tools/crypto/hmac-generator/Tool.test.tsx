/**
 * T9 偏离说明（沿用仓库既有约定，见 src/framework/ui/ErrorNote.test.tsx 顶部）：
 * 1) 计划原文用了 jest-dom 的 `toHaveTextContent`（2 处）与 `toBeInTheDocument`（1 处），
 *    仓库未安装 `@testing-library/jest-dom` ⇒ 必然报 `Invalid Chai property`。改为语义等价断言。
 * 2) 计划原文的「未填密钥」用例是**同步**断言：计算是异步的（`crypto.subtle` 返回 Promise），
 *    首帧不可能已有结果 ⇒ 实测必失败。改为 async + `waitFor`，并在同一用例里钉住「异步返回前的
 *    一帧是空态」——否则 `EmptyState` 分支无人覆盖（与 T8 评审的 I-2 同类漏杀）。
 * 3) Base64URL 用例原来只断言「无 =、无 +/」：若实现误返回 hex（同样无这些字符）会漏杀。
 *    改为钉住 URL 安全 Base64 的字符表与长度（SHA-256 的 32 字节 ⇒ 43 字符，无填充）。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import HmacGeneratorTool from './Tool'

/** 只读 CodeArea 的行取值方式与 Task 7 相同。 */
function outputLines(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((item) => item.lastElementChild?.textContent ?? '')
}

describe('HMAC 生成器', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('未填密钥时先呈现空态，随后提示密钥不可为空且无输出', async () => {
    render(<HmacGeneratorTool />)

    // 首帧：异步计算还没返回，此时是空态而不是错误（同步断言，确定性）
    expect(screen.getByText('尚无摘要')).toBeDefined()

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('密钥不可为空')
    })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('填入密钥与消息后产出 64 位十六进制摘要', async () => {
    const user = userEvent.setup()
    render(<HmacGeneratorTool />)

    await user.type(screen.getByLabelText('密钥'), 'secret')
    await user.type(screen.getByLabelText('消息'), 'hello')

    await waitFor(() => {
      expect(outputLines()[0]).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  it('切换到 SHA-512 后摘要变长到 128 位', async () => {
    const user = userEvent.setup()
    render(<HmacGeneratorTool />)

    await user.type(screen.getByLabelText('密钥'), 'secret')
    await user.type(screen.getByLabelText('消息'), 'hello')
    await waitFor(() => expect(outputLines()[0]).toMatch(/^[0-9a-f]{64}$/))

    await user.selectOptions(screen.getByLabelText('算法'), 'SHA-512')

    await waitFor(() => expect(outputLines()[0]).toMatch(/^[0-9a-f]{128}$/))
  })

  it('输出编码切换后为同一摘要的不同表示，且可相互还原', async () => {
    const user = userEvent.setup()
    render(<HmacGeneratorTool />)

    await user.type(screen.getByLabelText('密钥'), 'secret')
    await user.type(screen.getByLabelText('消息'), 'hello')
    await waitFor(() => expect(outputLines()[0]).toMatch(/^[0-9a-f]{64}$/))
    const hexDigest = outputLines()[0]

    await user.selectOptions(screen.getByLabelText('输出编码'), 'base64url')

    await waitFor(() => {
      // SHA-256 的 32 字节 ⇒ URL 安全 Base64 恰好 43 字符（无填充）；
      // 长度与字符表同时钉住，才排得掉「其实返回了 hex」这类同形实现
      expect(outputLines()[0]).toMatch(/^[A-Za-z0-9_-]{43}$/)
    })

    // spec 的「输出格式切换」还要求「可相互还原」：切回十六进制必须是同一摘要
    await user.selectOptions(screen.getByLabelText('输出编码'), 'hex')

    await waitFor(() => expect(outputLines()[0]).toBe(hexDigest))
  })

  it('密钥编码选十六进制但内容非法时提示密钥格式非法', async () => {
    const user = userEvent.setup()
    render(<HmacGeneratorTool />)

    await user.selectOptions(screen.getByLabelText('密钥编码'), 'hex')
    await user.type(screen.getByLabelText('密钥'), 'zz')

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('密钥格式非法')
    })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('消息变化后摘要随之改变', async () => {
    const user = userEvent.setup()
    render(<HmacGeneratorTool />)

    await user.type(screen.getByLabelText('密钥'), 'secret')
    await user.type(screen.getByLabelText('消息'), 'hello')
    await waitFor(() => expect(outputLines()[0]).toMatch(/^[0-9a-f]{64}$/))
    const first = outputLines()[0]

    await user.type(screen.getByLabelText('消息'), '!')

    await waitFor(() => expect(outputLines()[0]).not.toBe(first))
  })

  it('状态行展示算法与摘要十六进制长度', async () => {
    const user = userEvent.setup()
    render(<HmacGeneratorTool />)

    await user.type(screen.getByLabelText('密钥'), 'secret')
    await user.type(screen.getByLabelText('消息'), 'hello')

    await waitFor(() => {
      // 断言必须锚定整段状态文案：单选一个 /SHA-256/ 会同时命中 <option>（算法下拉项）
      // 与状态行两个元素，getByText 直接抛「Found multiple elements」
      expect(screen.getByText(/SHA-256 · 摘要 256 位 · hex/)).toBeDefined()
    })
  })
})
