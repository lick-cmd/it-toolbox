import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CATEGORIES } from '@/framework/categories'
import { getRegistryIssues, listByCategory, listTools } from '@/framework/registry'
import { searchTools } from '@/framework/search'
import type { ToolCategory } from '@/framework/types'
import { App } from './App'

/**
 * tasks.md 9.1「核对 17 个工具在侧栏与搜索中均可发现，且分类归属正确」的验收用例。
 * （当前分支为 18 个：新增 json-converter，json-to-yaml 待 Task 13 下线后回到 17）
 *
 * 为什么需要本文件：既有用例证明的是别的东西 —— `registry.test.ts` 只校验注册表一致性
 * （配对 / id / 类别合法 / keywords 非空），`App.test.tsx` 与 `CommandPalette.test.tsx`
 * 写于「仓库只有 1 个工具」时期，前者只断言 `listTools()[0]` 是 UUID 生成器、后者的候选项
 * 来自 3 条合成样本。**没有任何用例断言「全部 18 个工具都能被渲染、都能被搜到」**。
 *
 * 这份基线故意写死：新增或删除工具时它必须失败，由作者显式更新 —— 否则「17 个」这个
 * spec 数字会随注册表悄悄漂移。
 */
const BASELINE: ReadonlyArray<readonly [ToolCategory, readonly string[]]> = [
  ['crypto', ['token-generator', 'ulid-generator', 'hmac-generator', 'rsa-key-generator', 'uuid-generator']],
  ['converter', ['date-converter', 'base64', 'yaml-to-json', 'json-to-yaml', 'json-converter', 'markdown-to-html']],
  ['web', ['url-codec', 'json-diff', 'jwt-parser', 'url-analyzer']],
  ['image', ['qrcode-generator']],
  ['dev', ['json-minify', 'json-format']],
]

describe('9.1 工具可发现性（真实注册表）', () => {
  it('注册表恰好 18 个工具，且每个类别的 id 集合与基线一致', () => {
    // 注册表本身无任何配对/命名/类别问题 —— 后续断言建立在「18 条都是有效条目」之上
    expect(getRegistryIssues()).toEqual([])

    const entries = listTools()
    expect(entries).toHaveLength(18)
    expect(new Set(entries.map((entry) => entry.meta.id)).size).toBe(18)

    for (const [category, ids] of BASELINE) {
      const actual = listByCategory(category)
        .map((entry) => entry.meta.id)
        .sort()
      expect(actual).toEqual([...ids].sort())
    }

    // 类别维度也要对上：分类若写错，listByCategory 的上面两组断言会同时错位
    expect(new Set(entries.map((entry) => entry.meta.category))).toEqual(
      new Set(BASELINE.map(([category]) => category)),
    )
  })

  it('侧栏渲染全部 18 个工具，顺序与注册表一致，并列出每个类别名', () => {
    render(<App />)
    const nav = screen.getByRole('navigation', { name: '工具导航' })

    const entries = listTools()
    const nameById = new Map(entries.map((entry) => [entry.meta.id, entry.meta.name]))
    const names = new Set(nameById.values())

    // 侧栏里的按钮只有两类：类别表头与工具项。按「名字命中某工具名」筛出工具项，
    // 顺序必须等于注册表顺序（注册表已按 类别 order → meta.order → 名称 排好）。
    const renderedToolNames = within(nav)
      .getAllByRole('button')
      .map((button) => button.textContent?.trim() ?? '')
      .filter((label) => names.has(label))

    expect(renderedToolNames).toEqual(entries.map((entry) => entry.meta.name))

    // 类别名必须出现在侧栏（每类都有工具 ⇒ 按 spec「类别无工具时不展示」全部应展示）
    for (const category of CATEGORIES) {
      expect(nav.textContent).toContain(category.name)
    }
  })

  it('每个工具都能按名称与每一个关键词被搜索到', () => {
    for (const entry of listTools()) {
      const byName = searchTools(entry.meta.name)
      // 只断言「搜得到」，不断言「排第一」：检索是按 token 累加打分的，而
      // 「JSON 转 YAML」与「YAML 转 JSON」互为镜像 —— 三个 token 在两边的得分逐项相同，
      // 总分必然相等，首位由注册表顺序（meta.order）决定。要改「整名精确命中优先」
      // 得动 search.ts 的打分模型（属 计划① 的既有行为，本次验收不改）。
      expect(byName.some((hit) => hit.entry.meta.id === entry.meta.id)).toBe(true)

      for (const keyword of entry.meta.keywords) {
        const byKeyword = searchTools(keyword)
        // 关键词可以与其他工具共享（如「编码」），故只要求「能被搜到」
        expect(byKeyword.some((hit) => hit.entry.meta.id === entry.meta.id)).toBe(true)
      }
    }
  })

  it('每个工具都能按所属类别名被搜索到（类别的匹配面没退化）', () => {
    for (const [category, ids] of BASELINE) {
      const categoryName = CATEGORIES.find((item) => item.id === category)?.name
      expect(categoryName).toBeDefined()

      const hits = searchTools(categoryName ?? '')
      const hitIds = new Set(hits.map((hit) => hit.entry.meta.id))
      for (const id of ids) {
        expect(hitIds.has(id)).toBe(true)
      }
    }
  })
})
