import type { ToolMeta } from '@/framework/types'

export default {
  id: 'json-diff',
  name: 'JSON 差异比较',
  category: 'web',
  description: '对比两段 JSON 的结构差异，按路径定位新增、删除与修改',
  keywords: ['json', 'diff', 'compare', '差异', '比较', '对比', '对比json'],
  order: 20,
} satisfies ToolMeta
