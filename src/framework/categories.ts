import type { IconName, ToolCategory } from './types'

export interface CategoryDescriptor {
  id: ToolCategory
  name: string
  icon: IconName
  order: number
}

/** 侧栏分组与排序的唯一事实源。 */
export const CATEGORIES: readonly CategoryDescriptor[] = [
  { id: 'crypto', name: '加密', icon: 'lock', order: 1 },
  { id: 'converter', name: '转换器', icon: 'swap', order: 2 },
  { id: 'web', name: 'Web', icon: 'globe', order: 3 },
  { id: 'image', name: '图片', icon: 'image', order: 4 },
  { id: 'dev', name: '开发', icon: 'terminal', order: 5 },
]

const BY_ID = new Map<ToolCategory, CategoryDescriptor>(CATEGORIES.map((c) => [c.id, c]))

export function categoryById(id: ToolCategory): CategoryDescriptor | undefined {
  return BY_ID.get(id)
}

export function categoryOrder(id: ToolCategory): number {
  return BY_ID.get(id)?.order ?? 99
}
