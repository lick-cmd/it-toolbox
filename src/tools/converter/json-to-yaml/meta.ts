import type { ToolMeta } from '@/framework/types'

export default {
  id: 'json-to-yaml',
  name: 'JSON 转 YAML',
  category: 'converter',
  description: '把 JSON 转换为 YAML，非法输入时指出行列位置',
  keywords: ['json', 'yaml', 'yml', 'stringify', '转换', '配置'],
  order: 40,
} satisfies ToolMeta
