/**
 * T10 偏离说明：
 * 1) 计划原文用了 jest-dom 匹配器（`toBeInTheDocument` ×6、`toBeDisabled` / `toBeEnabled`、
 *    `toHaveTextContent`、`toHaveValue`），仓库未安装 `@testing-library/jest-dom`
 *    ⇒ 必然报 `Invalid Chai property`（T7 / T9 已两次实测）。改为语义等价断言。
 * 2) `vi.mock` 工厂里的内联 `import()` 类型注解被仓库规则
 *    `@typescript-eslint/consistent-type-imports` 禁止（T9 实测 lint 报错）
 *    ⇒ 改为命名空间类型导入。
 * 3) 计划原文的 `getByText('尚未生成')` 必然撞车：`EmptyState` 的标题与**状态行**都是这四个
 *    字，`getByText` 直接抛 `Found multiple elements with the text: 尚未生成`（与 T9 的
 *    `<option>` 撞车同一类）。改为断言只出现在空态里的提示文案「选择参数后点击生成」。
 * 4) 「生成中」原本用 40ms 睡眠制造时间窗（计划原文即如此），慢机器上断言会在睡眠结束之后
 *    才执行 ⇒ 假失败。改为挂起式 mock（与 hmac-generator 同款手法），放行前按钮必然处于禁用态。
 * 5) 评审反馈的三处覆盖缺口与一处真缺陷（均已闭合）：
 *    - 任务书 5.11 要求「公钥私钥**分别复制与导出**」，计划却零覆盖：补复制 payload 与导出
 *      文件名两条用例（复制写反、文件名写死都能被杀）。
 *    - `isStale` 的两个格式维度从未被单独触发（只比 keySize 的变异可存活）⇒ 在用例 4 里
 *      隔离出「只改私钥格式」这一维，并顺带钉住「改回原值即复位」。
 *    - 导出文件名原先由**实时参数**推导：只改公钥格式不重新生成时，结果区内容仍是 SPKI PEM
 *      而文件名已变成 public.pub（名实不符）⇒ 实现改为跟随快照，用例 11 钉住两种情形。
 *    - 真实 2048 位生成在慢机器上可能超过 `waitFor` 默认的 1000ms ⇒ 统一显式 timeout。
 * 6) 计划原文的 `delayMs` 延迟开关已由挂起开关取代；`fail` 开关保留。
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RsaModule from '@/core/crypto/rsa'
import RsaKeyGeneratorTool from './Tool'

/**
 * 可控的失败 / 挂起开关。
 *
 * 用 vi.hoisted 而不是普通顶层 const：vi.mock 的工厂会被提升到文件顶部，
 * 引用未初始化的普通变量会直接抛错。
 */
const mockRsa = vi.hoisted(() => ({
  defer: false,
  fail: false,
  pending: [] as Array<() => void>,
}))

vi.mock('@/core/crypto/rsa', async (importOriginal) => {
  const actual = await importOriginal<typeof RsaModule>()
  return {
    ...actual,
    generateRsaKeyPair: async (options: Parameters<typeof actual.generateRsaKeyPair>[0]) => {
      if (mockRsa.defer) {
        // 挂起本次生成，由用例决定放行时机（不依赖墙钟时间）
        await new Promise<void>((resolve) => mockRsa.pending.push(resolve))
      }
      if (mockRsa.fail) throw new Error('模拟密钥生成失败')
      return actual.generateRsaKeyPair(options)
    },
  }
})

// 注意「分别复制与导出」是任务书 5.11 的交付面，因此这两个模块必须被观测而不是放行真实现
const clipboardMocks = vi.hoisted(() => ({
  copyText: vi.fn(async (_text: string) => ({ ok: true as const, value: undefined })),
}))
vi.mock('@/framework/clipboard', () => clipboardMocks)

// 参数类型照着 `@/framework/file` 的真实签名写：`vi.fn(async () => …)` 会推成零参函数，
// 于是 `mock.calls[0]` 是长度 0 的元组，取第 0/1 项过不了 tsc（同 json-format 的既有注释）
const fileMocks = vi.hoisted(() => ({
  downloadText: vi.fn(async (_filename: string, _text: string, _mime?: string) => ({
    ok: true as const,
    value: undefined,
  })),
}))
vi.mock('@/framework/file', () => fileMocks)

/** 真实 RSA 生成（默认 2048 位）在慢机器上可能超过 waitFor 默认的 1000ms。 */
const GEN_TIMEOUT = { timeout: 5000 }

/** 每个 region 内的只读 CodeArea 行（readOnly 渲染的是带行号的行列表）。 */
function linesOf(regionName: string): string[] {
  const region = screen.getByRole('region', { name: regionName })
  return within(region)
    .getAllByRole('listitem')
    .map((item) => item.lastElementChild?.textContent ?? '')
}

const generateButton = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: '生成密钥对' })
const keySizeSelect = () => screen.getByLabelText<HTMLSelectElement>('密钥长度')
const publicText = () => linesOf('公钥').join('')
const privateText = () => linesOf('私钥').join('')

/** 下载成功后按钮文案会变成「已下载」，故按 /下载/ 取，避免第二次取不到 */
const downloadPublicButton = () =>
  within(screen.getByRole('region', { name: '公钥' })).getByRole('button', { name: /下载/ })

beforeEach(() => {
  localStorage.clear()
  mockRsa.defer = false
  mockRsa.fail = false
  mockRsa.pending.length = 0
  clipboardMocks.copyText.mockClear()
  fileMocks.downloadText.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RSA 密钥对生成器', () => {
  it('首次渲染是空态，不自动生成', () => {
    render(<RsaKeyGeneratorTool />)

    // 同步断言在这里是成立的：挂载后没有任何东西会触发生成，空态是稳定状态。
    // 这条同时钉住 spec 的「参数变更不自动重算」精神：不点就不生成。
    expect(screen.getByText('选择参数后点击生成')).toBeDefined()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('点击生成后同时展示公钥与私钥', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())

    await waitFor(() => {
      expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----')
      expect(privateText()).toContain('-----BEGIN RSA PRIVATE KEY-----')
    }, GEN_TIMEOUT)
  })

  it('生成中按钮禁用且给出进行中状态，完成后恢复可用', async () => {
    mockRsa.defer = true
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())

    // 挂起式 mock：放行之前，这两条断言与墙钟时间无关，慢机器上也必然成立
    expect(generateButton().disabled).toBe(true)
    expect(screen.getByRole('status')).toBeDefined() // Spinner：spec 的「进行中状态」

    await act(async () => {
      mockRsa.pending.shift()?.()
      await Promise.resolve()
    })

    await waitFor(() => expect(generateButton().disabled).toBe(false), GEN_TIMEOUT)
  })

  it('修改参数不自动重算：结果保留，状态行提示参数已变更', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----'), GEN_TIMEOUT)
    const before = publicText()

    // 维度 1：密钥长度
    await user.selectOptions(keySizeSelect(), '1024')
    expect(screen.getByText(/参数已变更/)).toBeDefined()
    expect(publicText()).toBe(before)

    // 改回原值即复位（stale 是「与快照比较」而不是「是否改动过」）
    await user.selectOptions(keySizeSelect(), '2048')
    expect(screen.queryByText(/参数已变更/)).toBeNull()

    // 维度 2：只改私钥格式。少比一个格式字段的 isStale 实现会在这里露出来
    await user.selectOptions(screen.getByLabelText('私钥格式'), 'pkcs8')
    expect(screen.getByText(/参数已变更/)).toBeDefined()
    expect(privateText()).toContain('-----BEGIN RSA PRIVATE KEY-----')
  })

  it('重新点击生成后应用新参数并刷新结果', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----'), GEN_TIMEOUT)
    const before = publicText()
    expect(privateText()).toContain('-----BEGIN RSA PRIVATE KEY-----')

    // 密钥长度与私钥格式一起改：只改长度的话，「私钥格式写死 pkcs1」的变异仍可存活
    await user.selectOptions(keySizeSelect(), '1024')
    await user.selectOptions(screen.getByLabelText('私钥格式'), 'pkcs8')
    await user.click(generateButton())

    await waitFor(() => expect(publicText()).not.toBe(before), GEN_TIMEOUT)
    expect(privateText()).toContain('-----BEGIN PRIVATE KEY-----')
    expect(screen.getByText(/已生成 1024 位密钥对/)).toBeDefined()
    expect(screen.queryByText(/参数已变更/)).toBeNull()
  })

  it('公钥格式选 OpenSSH 时输出单行 ssh-rsa', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.selectOptions(screen.getByLabelText('公钥格式'), 'openssh')
    await user.click(generateButton())

    await waitFor(() => expect(publicText()).toMatch(/^ssh-rsa /), GEN_TIMEOUT)
  })

  it('生成失败时展示原因并进入错误态（结果区不再显示任何密钥）', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    // 先拿到一份正常结果。注意：本用例**无法**观测 catch 里是否清掉了内层 pair ——
    // 错误分支在渲染上优先于结果分支，残留 pair 在下次生成前不可见，属行为等价变异。
    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----'), GEN_TIMEOUT)

    mockRsa.fail = true
    await user.click(generateButton())

    await waitFor(
      () => expect(screen.getByRole('alert').textContent).toContain('模拟密钥生成失败'),
      GEN_TIMEOUT,
    )
    expect(screen.queryByRole('region', { name: '公钥' })).toBeNull()
    expect(screen.queryByRole('region', { name: '私钥' })).toBeNull()
  })

  it('参数持久化但密钥材料不落盘：重新挂载回到空态', async () => {
    const user = userEvent.setup()
    const first = render(<RsaKeyGeneratorTool />)

    await user.selectOptions(keySizeSelect(), '1024')
    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----'), GEN_TIMEOUT)
    // 等参数真正写进 localStorage，否则「参数被持久化」这一半可能是假通过
    await vi.waitFor(() => expect(localStorage.length).toBeGreaterThan(0), GEN_TIMEOUT)
    first.unmount()

    render(<RsaKeyGeneratorTool />)

    expect(keySizeSelect().value).toBe('1024')
    expect(screen.getByText('选择参数后点击生成')).toBeDefined()
    expect(screen.queryByRole('region', { name: '公钥' })).toBeNull()
  })

  it('密钥材料从未写入 localStorage（含 OpenSSH 公钥）', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    // 特意用 OpenSSH 公钥生成：否则下面的 `ssh-rsa` 子句在默认 SPKI 下恒真、等于没断言
    await user.selectOptions(screen.getByLabelText('公钥格式'), 'openssh')
    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toMatch(/^ssh-rsa /), GEN_TIMEOUT)
    await vi.waitFor(() => expect(localStorage.length).toBeGreaterThan(0), GEN_TIMEOUT)

    // 逐键 dump：只要有人把 pair 塞进 useToolState（或顺手 setItem），这里必然失败
    const dump = Object.keys(localStorage)
      .map((key) => localStorage.getItem(key) ?? '')
      .join('\n')
    expect(dump).not.toContain('PRIVATE KEY')
    expect(dump).not.toContain('ssh-rsa')
  })

  it('复制公钥与私钥分别送出各自的内容', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----'), GEN_TIMEOUT)

    await user.click(screen.getByRole('button', { name: '复制公钥' }))
    await waitFor(() => expect(clipboardMocks.copyText).toHaveBeenCalledTimes(1))
    expect(clipboardMocks.copyText.mock.calls[0]?.[0]).toContain('BEGIN PUBLIC KEY')

    await user.click(screen.getByRole('button', { name: '复制私钥' }))
    await waitFor(() => expect(clipboardMocks.copyText).toHaveBeenCalledTimes(2))
    expect(clipboardMocks.copyText.mock.calls[1]?.[0]).toContain('BEGIN RSA PRIVATE KEY')
  })

  it('导出文件名跟随已生成结果的格式，不提前跳到尚未生效的参数', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----'), GEN_TIMEOUT)

    await user.click(downloadPublicButton())
    expect(fileMocks.downloadText).toHaveBeenCalledTimes(1)
    expect(fileMocks.downloadText.mock.calls[0]?.[0]).toBe('public.pem')

    // 只改公钥格式而不重新生成：内容仍是 SPKI PEM，文件名必须仍是 public.pem
    await user.selectOptions(screen.getByLabelText('公钥格式'), 'openssh')
    await user.click(downloadPublicButton())
    expect(fileMocks.downloadText).toHaveBeenCalledTimes(2)
    expect(fileMocks.downloadText.mock.calls[1]?.[0]).toBe('public.pem')
    expect(String(fileMocks.downloadText.mock.calls[1]?.[1])).toContain('BEGIN PUBLIC KEY')

    // 重新生成之后才切到 .pub，且落盘内容换成 ssh-rsa 单行
    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toMatch(/^ssh-rsa /), GEN_TIMEOUT)
    await user.click(downloadPublicButton())
    expect(fileMocks.downloadText).toHaveBeenCalledTimes(3)
    expect(fileMocks.downloadText.mock.calls[2]?.[0]).toBe('public.pub')
    expect(String(fileMocks.downloadText.mock.calls[2]?.[1])).toMatch(/^ssh-rsa /)
  })
})
