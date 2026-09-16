import type { ToolMeta } from '@/framework/types'

export default {
  id: 'date-converter',
  name: '日期转换器',
  category: 'converter',
  description: '时间戳与多种日期表示互转，支持单位指定与歧义提示',
  keywords: [
    'date',
    'time',
    'timestamp',
    'unix',
    'iso8601',
    'rfc2822',
    '时间戳',
    '日期',
    '时间',
    '转换',
  ],
  order: 10,
} satisfies ToolMeta
