import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listTools, type ToolEntry } from '@/framework/registry'
import { __resetPrefsForTests, type RecentEntry } from '@/framework/usePrefs'
import { App, resolveLandingToolId } from './App'

function entry(id: string, name: string): ToolEntry {
  return {
    meta: { id, name, category: 'crypto', description: `${name}的描述`, keywords: [id] },
    load: async () => ({ default: () => null }),
  }
}

const recent = (id: string): RecentEntry => ({ id, at: 1, count: 1 })

/**
 * 计划 Step 4 自己「推荐采用」的方案：把落地 id 解析抽成纯函数单测。
 * 计划的第 4 个用例（写 localStorage 的 ghost 偏好）实际是空转 ——
 * usePrefs 只在模块 import 时读一次 storage，而 __resetPrefsForTests()
 * 只重置内存、不再回读；该用例会通过，但证明不了回退逻辑。
 */
describe('resolveLandingToolId', () => {
  const entries = [entry('first', '第一个'), entry('second', '第二个')]

  it('无活跃与历史时落地注册表首项', () => {
    expect(resolveLandingToolId(null, [], entries)).toBe('first')
  })

  it('最近使用仍存在时优先于注册表首项', () => {
    expect(resolveLandingToolId(null, [recent('second')], entries)).toBe('second')
  })

  it('最近使用指向已不存在的工具时回退注册表首项（避免启动白屏）', () => {
    expect(resolveLandingToolId(null, [recent('ghost')], entries)).toBe('first')
  })

  it('活跃 id 有效时优先于最近使用', () => {
    expect(resolveLandingToolId('second', [recent('first')], entries)).toBe('second')
  })

  it('活跃 id 失效时回退注册表首项', () => {
    expect(resolveLandingToolId('ghost', [], entries)).toBe('first')
  })

  it('注册表为空时返回 null（界面据此展示「尚无可用工具」）', () => {
    expect(resolveLandingToolId(null, [recent('ghost')], [])).toBeNull()
  })
})

/** jsdom 自带的 stub 恒为「宽窗」，窄窗分支会变成死代码，故按需改写。 */
function stubMatchMedia(narrow: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: narrow && query.includes('899px'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  )
}

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetPrefsForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('首屏展示侧栏与工具面板', () => {
    render(<App />)
    expect(screen.getByRole('navigation', { name: '工具导航' })).toBeDefined()
    expect(screen.getByRole('main')).toBeDefined()
  })

  it('落地到注册表首项：标题与工具界面都渲染出来', async () => {
    render(<App />)
    // 侧栏里也有工具名，但 h1 只存在于主面板 ⇒ 该断言能区分「落地失败」。
    // 首项由注册表顺序决定，不写死具体工具：本计划 T7 插入 token-generator 后首项已变，
    // 写死名字会让「后续每加一个排序在前的工具」都撞一次。
    const first = listTools()[0]
    expect(first).toBeDefined()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(first?.meta.name)

    // 懒加载的组件真的挂载了：改用确定性工具取证 —— 点侧栏进入 UUID 生成器，
    // 等它自己的按钮出现（首项的控件形状会随首项变化，不适合做证据）。
    await userEvent.click(screen.getByRole('button', { name: 'UUID 生成器' }))
    await waitFor(() => {
      // 工具自身的按钮出现了 ⇒ 懒加载的组件真的挂载了
      expect(within(screen.getByRole('main')).getByRole('button', { name: '重新生成' })).toBeDefined()
    })
  })

  it('点击类别表头可折叠并重新展开该类别', () => {
    render(<App />)
    const header = screen.getByRole('button', { name: /加密/ })
    expect(header.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'UUID 生成器' })).toBeNull()

    fireEvent.click(header)
    expect(screen.getByRole('button', { name: 'UUID 生成器' })).toBeDefined()
  })

  it('收藏后出现「收藏」分区，取消后消失', () => {
    render(<App />)
    expect(screen.queryByRole('heading', { name: '收藏' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '收藏 UUID 生成器' }))
    expect(screen.getByRole('heading', { name: '收藏' })).toBeDefined()
    // 收藏分区 + 类别分区各一行
    expect(screen.getAllByRole('button', { name: 'UUID 生成器' })).toHaveLength(2)

    fireEvent.click(screen.getAllByRole('button', { name: '取消收藏 UUID 生成器' })[0]!)
    expect(screen.queryByRole('heading', { name: '收藏' })).toBeNull()
    expect(screen.getAllByRole('button', { name: 'UUID 生成器' })).toHaveLength(1)
  })

  it('展示主题切换控件，默认选中暗色；切换后立即应用', async () => {
    render(<App />)
    expect(screen.getByRole('button', { name: '暗色' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '亮色' }))

    await waitFor(() => {
      expect(document.documentElement.classList.contains('light')).toBe(true)
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(screen.getByRole('button', { name: '亮色' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('窄窗下侧栏收为抽屉：可打开、可关闭、选中工具后自动关闭', () => {
    stubMatchMedia(true)
    render(<App />)

    expect(screen.queryByRole('navigation', { name: '工具导航' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '打开导航' }))
    const drawer = screen.getByRole('navigation', { name: '工具导航' })
    expect(drawer.className).toContain('absolute')

    // 关闭按钮
    fireEvent.click(within(drawer).getByRole('button', { name: '关闭导航' }))
    expect(screen.queryByRole('navigation', { name: '工具导航' })).toBeNull()

    // 再次打开后选中工具 ⇒ 抽屉自动关闭
    fireEvent.click(screen.getByRole('button', { name: '打开导航' }))
    fireEvent.click(
      within(screen.getByRole('navigation', { name: '工具导航' })).getByRole('button', {
        name: 'UUID 生成器',
      }),
    )
    expect(screen.queryByRole('navigation', { name: '工具导航' })).toBeNull()
    expect(screen.getByRole('button', { name: '打开导航' })).toBeDefined()
  })

  it('页头搜索按钮打开命令面板，Escape 关闭', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /搜索/ }))
    expect(screen.getByRole('dialog', { name: '搜索工具' })).toBeDefined()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // spec 的硬要求：输入框聚焦时全局快捷键仍须生效（计划把这条留成手工验证）
  it('输入框保持聚焦时 Cmd+K 仍能关闭并重新打开面板', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /搜索/ }))

    // 限定在弹出层内：着陆的工具自身也可能带文本框（T7 的 Token 生成器有「前缀」）
    const textbox = within(screen.getByRole('dialog', { name: '搜索工具' })).getByRole('textbox')
    expect(document.activeElement).toBe(textbox)

    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect(screen.getByRole('dialog', { name: '搜索工具' })).toBeDefined()
  })

  // 补这一条是为了不依赖 CommandPalette.test 里的合成样本：走真实注册表 + 真实 meta.ts 关键词
  it('真实注册表下按中文关键词命中工具', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /搜索/ }))
    // 必须限定在弹出层内：着陆的工具自身也可能带文本框（T7 的 Token 生成器就有「前缀」），
    // 全局限定的 getByRole('textbox') 会因多个匹配而抛错。
    await userEvent.type(
      within(screen.getByRole('dialog', { name: '搜索工具' })).getByRole('textbox'),
      '唯一标识',
    )

    expect(within(screen.getByRole('dialog', { name: '搜索工具' })).getByText('UUID 生成器')).toBeDefined()
  })
})
