import type { ToolMeta } from '@/framework/types'

export default {
  id: 'json-format',
  name: 'JSON 美化',
  category: 'dev',
  description: '按 2 空格 / 4 空格 / 制表符缩进格式化 JSON，支持搜索键与值、可选键排序与逐值类型提示',
  keywords: [
    'json',
    'format',
    'pretty',
    'beautify',
    '美化',
    '格式化',
    '缩进',
    '搜索',
    '查找',
    '键排序',
    '类型提示',
    '保留转义',
    '转义',
    'unicode',
    'unicode转码',
    '中文转unicode',
  ],
  order: 20,
} satisfies ToolMeta
