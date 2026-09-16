import type { ToolMeta } from '@/framework/types'

export default {
  id: 'base64',
  name: 'Base64 编码/解码',
  category: 'converter',
  description: '标准与 URL-safe 变体的 Base64 编解码，支持文件与填充符开关',
  keywords: ['base64', 'b64', 'encode', 'decode', '编码', '解码', 'urlsafe', '文件编码'],
  order: 20,
} satisfies ToolMeta
