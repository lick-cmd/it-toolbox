import type { ToolMeta } from '@/framework/types'

export default {
  id: 'ulid-generator',
  name: 'ULID 生成器',
  category: 'crypto',
  description: '生成 ULID：26 位、按时间有序，并展示内嵌时间戳',
  keywords: ['ulid', '时间有序', '有序id', '唯一标识', '26位', '排序id', '单调'],
} satisfies ToolMeta
