/**
 * T9 偏离说明（沿用仓库既有约定，见 src/framework/ui/ErrorNote.test.tsx 顶部）：
 * 1) 计划原文用了 jest-dom 的 `toHaveTextContent`（2 处）与 `toBeInTheDocument`（1 处），
 *    仓库未安装 `@testing-library/jest-dom` ⇒ 必然报 `Invalid Chai property`。改为语义等价断言。
 * 2) 计划原文的「未填密钥」用例是**同步**断言：计算是异步的（`crypto.subtle` 返回 Promise），
 *    首帧不可能已有结果 ⇒ 实测报 `Unable to find an accessible element with the role "alert"`。
 *    改为 async + `waitFor`，并在同一用例里钉住「异步返回前的一帧是空态」。
 * 3) Base64URL 用例原来只断言「无 =、无 +/」：若实现误返回 hex（同样无这些字符）会漏杀。
 *    改为钉住 URL 安全 Base64 的字符表与长度（SHA-256 的 32 字节 ⇒ 43 字符，无填充），
 *    并按 spec「输出格式切换」补「可相互还原」的往返断言。
 * 4) 评审补强：摘要加已知答案向量（否则 key 与 message 传反也会通过）、状态行位数随算法走、
 *    错误态盖住旧摘要的渲染顺序、以及用挂起式 mock 验证「过期结果守卫」（新增 1 条用例）。
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// 用命名空间类型导入而不是内联 `import()` 注解：后者被仓库规则
// `@typescript-eslint/consistent-type-imports` 禁止（T9 实测 lint 报错）
import type * as HmacModule from '@/core/crypto/hmac'
import HmacGeneratorTool from './Tool'

/**
 * 可控的挂起开关：只用于验证「过期结果守卫」。
 *
 * 用 vi.hoisted 而不是普通顶层 const：vi.mock 的工厂会被提升到文件顶部，
 * 引用未初始化的普通变量会直接抛错。
 */
const mockHmac = vi.hoisted(() => ({ defer: false, pending: [] as Array<() => void> }))

vi.mock('@/core/crypto/hmac', async (importOriginal) => {
  const actual = await importOriginal<typeof HmacModule>()
  return {
    ...actual,
    computeHmac: async (options: Parameters<typeof actual.computeHmac>[0]) => {
      if (!mockHmac.defer) return actual.computeHmac(options)
      // 挂起本次计算，由用例决定放行顺序（模拟「先发出的请求后返回」）
      await new Promise<void>((resolve) => mockHmac.pending.push(resolve))
      return actual.computeHmac(options)
    },
  }
})

/** 只读 CodeArea 的行取值方式与 Task 7 相同。 */
function outputLines(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((item) => item.lastElementChild?.textContent ?? '')
}

describe('HMAC 生成器', () => {
  beforeEach(() => {
    localStorage.clear()
    mockHmac.defer = false
    mockHmac.pending.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
      // 已知答案向量（node：createHmac('sha256','secret').update('hello')）：
      // 只断言「64 位十六进制」的话，key 与 message 传反也会照样通过
      expect(outputLines()[0]).toBe(
        '88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b',
      )
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
    // 状态行的位数要跟着算法走（写死 256 的话这里会失败）
    expect(screen.getByText(/SHA-512 · 摘要 512 位 · hex/)).toBeDefined()
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

  it('密钥编码选十六进制但内容非法时提示密钥格式非法并清空旧摘要', async () => {
    const user = userEvent.setup()
    render(<HmacGeneratorTool />)

    // 先拿到一份正常摘要：否则「错误态是否盖住旧摘要」无从验证
    await user.type(screen.getByLabelText('密钥'), 'secret')
    await user.type(screen.getByLabelText('消息'), 'hello')
    await waitFor(() => expect(outputLines()[0]).toMatch(/^[0-9a-f]{64}$/))

    // 切到十六进制后，原先的 'secret' 本身就含非十六进制字符
    await user.selectOptions(screen.getByLabelText('密钥编码'), 'hex')

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('密钥格式非法')
    })
    // 错误必须盖住旧摘要：渲染分支顺序反过来就会把过期摘要留在屏幕上
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

  it('旧请求后返回时不会覆盖新结果（过期结果守卫）', async () => {
    const user = userEvent.setup()
    render(<HmacGeneratorTool />)

    await user.type(screen.getByLabelText('密钥'), 'secret')
    // 从这里开始把每次计算挂起，由本用例手动放行
    mockHmac.defer = true

    await user.type(screen.getByLabelText('消息'), 'a') // 请求 A（挂起）
    await user.type(screen.getByLabelText('消息'), 'b') // 请求 B（挂起）；effect 的 cleanup 已把 A 作废
    expect(mockHmac.pending).toHaveLength(2)

    // 期望值用真实 core 独立算（vi.importActual 绕开本文件的 mock）
    const actual = await vi.importActual<typeof HmacModule>('@/core/crypto/hmac')
    const expected = await actual.computeHmac({
      message: 'ab',
      key: 'secret',
      algorithm: 'SHA-256',
      messageEncoding: 'utf8',
      keyEncoding: 'utf8',
      outputEncoding: 'hex',
    })
    if (!expected.ok) throw new Error('参考实现不应失败')

    // 后发先至：先放行新请求 B，再放行旧请求 A。没有守卫时 A 会把 B 的结果盖掉
    await act(async () => {
      mockHmac.pending[1]!()
      mockHmac.pending[0]!()
      await Promise.resolve()
    })

    await waitFor(() => expect(outputLines()[0]).toBe(expected.value))
  })
})
