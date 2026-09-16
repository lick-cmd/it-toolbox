import { describe, expect, it } from 'vitest'
import { buildRegistry, type RegistryModules, type RegistryIssue } from './registry'
import type { ToolMeta } from './types'

/**
 * `registry.ts` 的校验分支（原 `:79-158`）此前只有正向路径被覆盖：真实目录结构下
 * 不可能出现孤儿 meta、孤儿 Tool、id 重复这些情形，`registry.test.ts` 只能断言
 * 「当前注册表没有问题」。本文件用**合成模块表**逐条触发失败路径 —— 校验代码失效
 * （比如某条 `issues.push` 被删掉）时会立刻失败。
 */

const load = () => Promise.resolve({ default: () => null })

const meta = (id: string, patch: Partial<ToolMeta> = {}): ToolMeta => ({
  id,
  name: `工具 ${id}`,
  description: '描述',
  category: 'dev',
  keywords: ['k'],
  ...patch,
})

/** 目录名决定期望 id：`../tools/dev/<dir>/meta.ts` ⇒ 目录名 `<dir>`，id 必须等于它 */
function modules(
  dirs: readonly string[],
  overrides: Record<string, Partial<ToolMeta>> = {},
): RegistryModules {
  const metaModules: RegistryModules['metaModules'] = {}
  const toolModules: RegistryModules['toolModules'] = {}
  for (const dir of dirs) {
    metaModules[`../tools/dev/${dir}/meta.ts`] = { default: meta(dir, overrides[dir]) }
    toolModules[`../tools/dev/${dir}/Tool.tsx`] = load
  }
  return { metaModules, toolModules }
}

const kindsOf = (issues: readonly RegistryIssue[]): string[] => issues.map((issue) => issue.kind)

describe('buildRegistry（合成模块表）', () => {
  it('合法模块表：产出条目且无任何 issue（对照组，防止合成夹具本身失效）', () => {
    const { entries, issues } = buildRegistry(modules(['foo', 'bar']))

    expect(issues).toEqual([])
    expect(entries.map((entry) => entry.meta.id).sort()).toEqual(['bar', 'foo'])
    expect(entries.every((entry) => typeof entry.load === 'function')).toBe(true)
  })

  it('有 meta 无 Tool：报 orphan-meta，且该目录不进条目', () => {
    const mods = modules(['foo', 'bar'])
    delete mods.toolModules['../tools/dev/bar/Tool.tsx']

    const { entries, issues } = buildRegistry(mods)

    expect(kindsOf(issues)).toEqual(['orphan-meta'])
    expect(entries.map((entry) => entry.meta.id)).toEqual(['foo'])
  })

  it('有 Tool 无 meta：报 orphan-tool', () => {
    const mods = modules(['foo'])
    mods.toolModules['../tools/dev/ghost/Tool.tsx'] = load

    const { issues } = buildRegistry(mods)

    expect(kindsOf(issues)).toEqual(['orphan-tool'])
  })

  it('同一目录下多个 meta.ts：报 duplicate-id 并跳过后来者', () => {
    const mods = modules(['foo'])
    mods.metaModules['../tools/dev/foo/index.ts'] = { default: meta('foo') }

    const { entries, issues } = buildRegistry(mods)

    expect(kindsOf(issues)).toEqual(['duplicate-id'])
    expect(entries).toHaveLength(1)
  })

  it('两个目录用同一个 id：报 duplicate-id', () => {
    const { issues, entries } = buildRegistry(
      modules(['a', 'b'], { a: { id: 'same' }, b: { id: 'same' } }),
    )

    expect(kindsOf(issues)).toContain('duplicate-id')
    // 两个目录的 id 都与目录名不符，故条目为空 —— 这里只钉「重复被识别」这一件事
    expect(entries).toEqual([])
  })

  it('id 与目录名不符：报 id-directory-mismatch', () => {
    const { entries, issues } = buildRegistry(modules(['foo'], { foo: { id: 'bar' } }))

    expect(kindsOf(issues)).toEqual(['id-directory-mismatch'])
    expect(entries).toEqual([])
  })

  it('id 不是 kebab-case：报 bad-id-format', () => {
    const { issues } = buildRegistry(modules(['foo'], { foo: { id: 'Foo_Bar' } }))

    expect(kindsOf(issues)).toContain('bad-id-format')
  })

  it('类别不在枚举内：报 bad-category', () => {
    const { entries, issues } = buildRegistry(
      modules(['foo'], { foo: { category: 'nope' as ToolMeta['category'] } }),
    )

    expect(kindsOf(issues)).toEqual(['bad-category'])
    expect(entries).toEqual([])
  })

  it('keywords 为空数组：报 empty-keywords', () => {
    const { entries, issues } = buildRegistry(modules(['foo'], { foo: { keywords: [] } }))

    expect(kindsOf(issues)).toEqual(['empty-keywords'])
    expect(entries).toEqual([])
  })

  it('meta 缺 name / description：报 incomplete-meta', () => {
    const { entries, issues } = buildRegistry(modules(['foo'], { foo: { name: '' } }))

    expect(kindsOf(issues)).toEqual(['incomplete-meta'])
    expect(entries).toEqual([])
  })

  it('meta 默认导出不是对象：报 incomplete-meta', () => {
    const mods = modules(['foo'])
    mods.metaModules['../tools/dev/foo/meta.ts'] = { default: null as unknown as ToolMeta }

    const { issues } = buildRegistry(mods)

    expect(kindsOf(issues)).toEqual(['incomplete-meta'])
  })

  // 本条是新增用例当场咬出的真缺陷的回归钉子：非法 meta 的目录此前会额外多报一条
  // 「有 Tool.tsx 但缺少 meta.ts」（`continue` 跳过了从孤儿候选里摘除那一步），
  // 而真实目录结构下不可能出现非法 meta，于是这条噪声从未暴露过。
  it('混合场景：合法目录进条目、非法目录只报自己的问题、无 meta 的目录才算孤儿 Tool', () => {
    const mods = modules(['good', 'bad'], { bad: { category: 'nope' as ToolMeta['category'] } })
    mods.toolModules['../tools/dev/ghost/Tool.tsx'] = load

    const { entries, issues } = buildRegistry(mods)

    expect(entries.map((entry) => entry.meta.id)).toEqual(['good'])
    expect([...kindsOf(issues)].sort()).toEqual(['bad-category', 'orphan-tool'])
  })
})
