export const TOOL_CATEGORIES = ['crypto', 'converter', 'web', 'image', 'dev'] as const

export type ToolCategory = (typeof TOOL_CATEGORIES)[number]

/** 手写 SVG 图标的名称集合。不引入图标库，以保证零外网与体积可控。 */
export type IconName =
  | 'search'
  | 'lock'
  | 'swap'
  | 'globe'
  | 'image'
  | 'terminal'
  | 'star'
  | 'star-filled'
  | 'clock'
  | 'chevron-right'
  | 'chevron-down'
  | 'copy'
  | 'check'
  | 'download'
  | 'trash'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'alert'
  | 'menu'
  | 'close'

/**
 * 工具元数据。
 *
 * 必须可**同步**获得（侧栏与搜索需要在组件未加载时渲染），
 * 因此单独放在 meta.ts 中，与懒加载的 Tool.tsx 分离。
 */
export interface ToolMeta {
  /** 与所在目录名一致，形如 kebab-case */
  id: string
  name: string
  category: ToolCategory
  description: string
  keywords: string[]
  /** 同类别内的排序权重，缺省为 0 */
  order?: number
}

export function isToolCategory(value: unknown): value is ToolCategory {
  return typeof value === 'string' && (TOOL_CATEGORIES as readonly string[]).includes(value)
}

/** 从一个工具跳到另一个工具时携带的一次性载荷 */
export interface ToolHandoff {
  input: string
  options?: Record<string, unknown>
}

/**
 * 工具组件收到的属性。
 *
 * 两个字段都是可选的，因此现有工具（不声明任何参数）无需改动 —— React 允许
 * 组件少声明参数，`ComponentType<{}>` 也可赋值给 `ComponentType<ToolProps>`。
 */
export interface ToolProps {
  /** 本次跳转带过来的载荷。仅在「被跳转」的那次挂载上有值 */
  handoff?: ToolHandoff
  /** 跳到另一个工具。由应用外壳注入，工具自身不感知路由 */
  onNavigate?: (toolId: string, payload?: ToolHandoff) => void
}
