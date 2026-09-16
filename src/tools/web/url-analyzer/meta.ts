import type { ToolMeta } from '@/framework/types'

export default {
  id: 'url-analyzer',
  name: 'URL 分析器',
  category: 'web',
  description: '拆解 URL 的协议、主机、端口、路径、查询参数与片段，并列展示编码与解码形式',
  keywords: ['url', 'uri', 'parse', 'query', 'origin', '分析', '解析', '参数', '拆解'],
  order: 40,
} satisfies ToolMeta
