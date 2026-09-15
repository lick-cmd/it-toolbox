import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ToolEntry } from '@/framework/registry'
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

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetPrefsForTests()
  })

  it('首屏展示侧栏与工具面板', () => {
    render(<App />)
    expect(screen.getByRole('navigation', { name: '工具导航' })).toBeDefined()
    expect(screen.getByRole('main')).toBeDefined()
  })

  it('默认落地到注册表首项并渲染工具标题', async () => {
    render(<App />)
    // 注册表当前仅含 UUID 生成器
    await waitFor(() => {
      expect(screen.getAllByText('UUID 生成器').length).toBeGreaterThan(0)
    })
  })

  it('展示主题切换控件，默认选中暗色', () => {
    render(<App />)
    const dark = screen.getByRole('button', { name: '暗色' })
    expect(dark.getAttribute('aria-pressed')).toBe('true')
  })
})
