import type { ComponentType } from 'react'
import { categoryOrder } from './categories'
import { isToolCategory, type ToolCategory, type ToolMeta } from './types'

export type ToolComponent = ComponentType

export interface ToolEntry {
  meta: ToolMeta
  /** 懒加载入口。调用它才会真正拉取组件代码。 */
  load: () => Promise<{ default: ToolComponent }>
}

export type RegistryIssueKind =
  | 'orphan-meta'
  | 'orphan-tool'
  | 'duplicate-id'
  | 'id-directory-mismatch'
  | 'bad-id-format'
  | 'bad-category'
  | 'empty-keywords'
  | 'incomplete-meta'

export interface RegistryIssue {
  kind: RegistryIssueKind
  path: string
  detail: string
}

/**
 * Vite 的静态 glob 分析。
 *
 * meta.ts 用 eager 同步加载（侧栏与搜索需要元数据即刻可用）；
 * Tool.tsx 保持为懒加载 thunk，从而为每个工具生成独立 chunk。
 * 两个路径必须是字面量，Vite 在编译期做静态分析。
 */
const metaModules = import.meta.glob<{ default: ToolMeta }>('../tools/*/*/meta.ts', {
  eager: true,
})

const toolModules = import.meta.glob<{ default: ToolComponent }>('../tools/*/*/Tool.tsx')

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** '../tools/crypto/uuid-generator/meta.ts' → 'crypto/uuid-generator' */
function directoryOf(modulePath: string): string {
  return modulePath.split('/').slice(-3, -1).join('/')
}

function basenameOf(directory: string): string {
  const parts = directory.split('/')
  return parts[parts.length - 1] ?? ''
}

export interface RegistryModules {
  metaModules: Record<string, { default: ToolMeta }>
  toolModules: Record<string, () => Promise<{ default: ToolComponent }>>
}

/**
 * 纯函数形态的注册表构建：模块表由参数注入。
 *
 * 生产路径用 `import.meta.glob` 的结果（见下方 `built`）；用例注入合成模块表，
 * 才能触发「孤儿 meta / 孤儿 Tool / id 重复 / 缺字段」这些在任何真实目录结构下
 * 都无法出现的失败路径 —— 否则校验代码只有正向路径被覆盖。
 */
export function buildRegistry({
  metaModules: metas,
  toolModules: tools,
}: RegistryModules): { entries: ToolEntry[]; issues: RegistryIssue[] } {
  const issues: RegistryIssue[] = []
  const metaByDirectory = new Map<string, { path: string; meta: ToolMeta }>()
  const nameCount = new Map<string, number>()

  for (const [path, module] of Object.entries(metas)) {
    const directory = directoryOf(path)
    if (metaByDirectory.has(directory)) {
      issues.push({
        kind: 'duplicate-id',
        path,
        detail: `目录 ${directory} 下出现多个 meta.ts`,
      })
      continue
    }
    metaByDirectory.set(directory, { path, meta: module.default })
  }

  const toolByDirectory = new Map<string, () => Promise<{ default: ToolComponent }>>()
  for (const [path, loader] of Object.entries(tools)) {
    toolByDirectory.set(directoryOf(path), loader)
  }

  const entries: ToolEntry[] = []

  for (const [directory, { path, meta }] of metaByDirectory) {
    const expectedId = basenameOf(directory)
    let invalid = false

    if (typeof meta !== 'object' || meta === null) {
      issues.push({ kind: 'incomplete-meta', path, detail: 'meta 默认导出不是对象' })
      // 该目录有 meta.ts（只是导出的不是对象）：它的 Tool.tsx 并非无主，
      // 故同样要从「孤儿 Tool」候选里摘掉（详见下方同名注释）
      toolByDirectory.delete(directory)
      continue
    }

    if (!meta.id || !meta.name || !meta.description) {
      issues.push({
        kind: 'incomplete-meta',
        path,
        detail: 'meta 缺少 id / name / description 中的一项',
      })
      invalid = true
    }

    if (!ID_PATTERN.test(meta.id)) {
      issues.push({
        kind: 'bad-id-format',
        path,
        detail: `id "${meta.id}" 不是 kebab-case`,
      })
      invalid = true
    }

    if (meta.id !== expectedId) {
      issues.push({
        kind: 'id-directory-mismatch',
        path,
        detail: `meta.id 为 "${meta.id}"，但目录名为 "${expectedId}"`,
      })
      invalid = true
    }

    if (!isToolCategory(meta.category)) {
      issues.push({
        kind: 'bad-category',
        path,
        detail: `category "${String(meta.category)}" 不是已知类别`,
      })
      invalid = true
    }

    if (!Array.isArray(meta.keywords) || meta.keywords.length === 0) {
      issues.push({ kind: 'empty-keywords', path, detail: 'keywords 不能为空数组' })
      invalid = true
    }

    const seen = nameCount.get(meta.id) ?? 0
    nameCount.set(meta.id, seen + 1)
    if (seen > 0) {
      issues.push({ kind: 'duplicate-id', path, detail: `id "${meta.id}" 重复出现` })
      invalid = true
    }

    const loader = toolByDirectory.get(directory)
    if (!loader) {
      issues.push({
        kind: 'orphan-meta',
        path,
        detail: `目录 ${directory} 有 meta.ts 但缺少 Tool.tsx`,
      })
      invalid = true
    }

    // 走到这里说明该目录的 meta.ts 确实存在（只是可能非法）：它的 Tool.tsx 已有归属，
    // 一律从「孤儿 Tool」候选里摘掉。原先只在成功分支里 delete，导致**每个非法 meta**
    // 都会额外多报一条自相矛盾的「有 Tool.tsx 但缺少 meta.ts」—— 该路径此前没有用例
    // 触发（真实目录结构下不可能有非法 meta），故长期无人发现。
    toolByDirectory.delete(directory)
    if (invalid || !loader) continue

    entries.push({ meta, load: loader })
  }

  for (const directory of toolByDirectory.keys()) {
    issues.push({
      kind: 'orphan-tool',
      path: `${directory}/Tool.tsx`,
      detail: `目录 ${directory} 有 Tool.tsx 但缺少 meta.ts`,
    })
  }

  entries.sort((a, b) => {
    const byCategory = categoryOrder(a.meta.category) - categoryOrder(b.meta.category)
    if (byCategory !== 0) return byCategory
    const byOrder = (a.meta.order ?? 0) - (b.meta.order ?? 0)
    if (byOrder !== 0) return byOrder
    return a.meta.name.localeCompare(b.meta.name, 'zh-Hans-CN')
  })

  return { entries, issues }
}

const built = buildRegistry({ metaModules, toolModules })

/** 开发构建下即时暴露注册问题，避免违规静默进入后续环节。 */
if (import.meta.env.DEV && built.issues.length > 0) {
  for (const issue of built.issues) {
    console.error(`[registry] ${issue.kind} — ${issue.path}\n  ${issue.detail}`)
  }
}

export function getRegistryIssues(): readonly RegistryIssue[] {
  return built.issues
}

export function listTools(): readonly ToolEntry[] {
  return built.entries
}

export function getTool(id: string): ToolEntry | undefined {
  return built.entries.find((entry) => entry.meta.id === id)
}

export function listByCategory(category: ToolCategory): readonly ToolEntry[] {
  return built.entries.filter((entry) => entry.meta.category === category)
}
