/**
 * T10 偏离说明：
 * 1) 计划原文用了 jest-dom 匹配器（`toBeInTheDocument` ×6、`toBeDisabled` / `toBeEnabled`、
 *    `toHaveTextContent`、`toHaveValue`），仓库未安装 `@testing-library/jest-dom`
 *    ⇒ 必然报 `Invalid Chai property`（T7 / T9 已两次实测）。改为语义等价断言。
 * 2) `vi.mock` 工厂里的内联 `import()` 类型注解被仓库规则
 *    `@typescript-eslint/consistent-type-imports` 禁止（T9 实测 lint 报错）
 *    ⇒ 改为命名空间类型导入。
 * 3) 生成中用例的延迟由 40ms 提到 150ms：`user.click` 自身有若干内部 await，
 *    40ms 在慢机器上会先于断言结束，使「按钮已禁用」变成闪断用例。
 * 4) 补强（都是「计划写了这个意图但用例其实证不了」的同一类问题，T8/T9 已各踩一次）：
 *    - 「生成失败不保留旧结果」原本从空态起步，删掉 `setPair(null)` 也能全绿 ⇒ 改为先
 *      成功生成一次再失败。
 *    - 「重新点击生成应用新参数」原本只改密钥长度，**写死 `privateKeyFormat` 的变异可存活**
 *      ⇒ 一并切到 PKCS#8 并断言新头部与状态行。
 * 5) 计划原文的 `getByText('尚未生成')` 必然撞车：`EmptyState` 的标题与**状态行**都是这四个
 *    字，`getByText` 直接抛 `Found multiple elements with the text: 尚未生成`（与 T9 的
 *    `<option>` 撞车同一类）。改为断言只出现在空态里的提示文案「选择参数后点击生成」。
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RsaModule from '@/core/crypto/rsa'
import RsaKeyGeneratorTool from './Tool'

/**
 * 可控的失败 / 延迟开关。
 *
 * 用 vi.hoisted 而不是普通顶层 const：vi.mock 的工厂会被提升到文件顶部，
 * 引用未初始化的普通变量会直接抛错。
 */
const mockRsa = vi.hoisted(() => ({ delayMs: 0, fail: false }))

vi.mock('@/core/crypto/rsa', async (importOriginal) => {
  const actual = await importOriginal<typeof RsaModule>()
  return {
    ...actual,
    generateRsaKeyPair: async (options: Parameters<typeof actual.generateRsaKeyPair>[0]) => {
      if (mockRsa.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, mockRsa.delayMs))
      }
      if (mockRsa.fail) throw new Error('模拟密钥生成失败')
      return actual.generateRsaKeyPair(options)
    },
  }
})

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

beforeEach(() => {
  localStorage.clear()
  mockRsa.delayMs = 0
  mockRsa.fail = false
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
    })
  })

  it('生成中按钮禁用，完成后恢复可用', async () => {
    mockRsa.delayMs = 150
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())

    // 按钮文案在生成前后不变，故这里仍能按名取到同一个按钮
    expect(generateButton().disabled).toBe(true)
    await waitFor(() => expect(generateButton().disabled).toBe(false), { timeout: 3000 })
  })

  it('修改参数不自动重算：结果保留，状态行提示参数已变更', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----'))
    const before = publicText()

    await user.selectOptions(keySizeSelect(), '1024')

    expect(screen.getByText(/参数已变更/)).toBeDefined()
    expect(publicText()).toBe(before)
  })

  it('重新点击生成后应用新参数并刷新结果', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----'))
    const before = publicText()
    expect(privateText()).toContain('-----BEGIN RSA PRIVATE KEY-----')

    // 密钥长度与私钥格式一起改：只改长度的话，「私钥格式写死 pkcs1」的变异仍可存活
    await user.selectOptions(keySizeSelect(), '1024')
    await user.selectOptions(screen.getByLabelText('私钥格式'), 'pkcs8')
    await user.click(generateButton())

    await waitFor(() => expect(publicText()).not.toBe(before))
    expect(privateText()).toContain('-----BEGIN PRIVATE KEY-----')
    expect(screen.getByText(/已生成 1024 位密钥对/)).toBeDefined()
    expect(screen.queryByText(/参数已变更/)).toBeNull()
  })

  it('公钥格式选 OpenSSH 时输出单行 ssh-rsa', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.selectOptions(screen.getByLabelText('公钥格式'), 'openssh')
    await user.click(generateButton())

    await waitFor(() => expect(publicText()).toMatch(/^ssh-rsa /))
  })

  it('生成失败时展示原因且不保留旧结果', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    // 先拿到一份正常结果：否则「失败时是否清掉旧结果」无从验证
    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----'))

    mockRsa.fail = true
    await user.click(generateButton())

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('模拟密钥生成失败')
    })
    expect(screen.queryByRole('region', { name: '公钥' })).toBeNull()
    expect(screen.queryByRole('region', { name: '私钥' })).toBeNull()
  })

  it('参数持久化但密钥材料不落盘：重新挂载回到空态', async () => {
    const user = userEvent.setup()
    const first = render(<RsaKeyGeneratorTool />)

    await user.selectOptions(keySizeSelect(), '1024')
    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----'))
    // 等参数真正写进 localStorage，否则「参数被持久化」这一半可能是假通过
    await vi.waitFor(() => expect(localStorage.length).toBeGreaterThan(0))
    first.unmount()

    render(<RsaKeyGeneratorTool />)

    expect(keySizeSelect().value).toBe('1024')
    expect(screen.getByText('选择参数后点击生成')).toBeDefined()
    expect(screen.queryByRole('region', { name: '公钥' })).toBeNull()
  })

  it('私钥从未写入 localStorage', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----'))
    await vi.waitFor(() => expect(localStorage.length).toBeGreaterThan(0))

    // 逐键检查：只要有人把 pair 塞进 useToolState（或顺手 setItem），这里必然失败
    const dump = Object.keys(localStorage)
      .map((key) => localStorage.getItem(key) ?? '')
      .join('\n')
    expect(dump).not.toContain('PRIVATE KEY')
    expect(dump).not.toContain('ssh-rsa')
  })
})
