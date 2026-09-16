import type { ToolMeta } from '@/framework/types'

export default {
  id: 'json-minify',
  name: 'JSON 压缩',
  category: 'dev',
  description: '移除 JSON 中的多余空白，字符串内的转义字面量原样保留',
  keywords: ['json', 'minify', 'compress', '压缩', '压缩json', '去空白', '单行', '紧凑'],
  order: 10,
} satisfies ToolMeta
