import type { ToolMeta } from '@/framework/types'

export default {
  id: 'json-converter',
  name: 'JSON 转换器',
  category: 'converter',
  description: '把 JSON 转成 JS 字面量、PHP 数组、YAML、CSV 或 XML',
  keywords: [
    'json',
    'convert',
    '转换',
    '导出',
    'javascript',
    'js',
    'php',
    'yaml',
    'yml',
    'stringify',
    'csv',
    'xml',
    'json转yaml',
    'json转csv',
    'json转xml',
    'json转js',
    'json转php',
    '表格',
    // 并入被下线的 json-to-yaml 的关键词（spec §8.3）
    '配置',
  ],
  order: 30,
} satisfies ToolMeta
