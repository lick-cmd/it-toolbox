import type { ToolMeta } from '@/framework/types'

export default {
  id: 'yaml-to-json',
  name: 'YAML 转 JSON',
  category: 'converter',
  description: '把 YAML 转换为 JSON，支持缩进配置并在语法错误时定位行号',
  keywords: ['yaml', 'yml', 'json', 'parse', '转换', '配置', '缩进'],
  order: 30,
} satisfies ToolMeta
