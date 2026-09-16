import type { ToolMeta } from '@/framework/types'

export default {
  id: 'json-format',
  name: 'JSON 美化',
  category: 'dev',
  description: '按 2 空格 / 4 空格 / 制表符缩进格式化 JSON，可选键排序与逐值类型提示',
  keywords: [
    'json',
    'format',
    'pretty',
    'beautify',
    '美化',
    '格式化',
    '缩进',
    '键排序',
    '类型提示',
  ],
  order: 20,
} satisfies ToolMeta
