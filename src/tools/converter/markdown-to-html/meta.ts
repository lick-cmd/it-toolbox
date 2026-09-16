import type { ToolMeta } from '@/framework/types'

export default {
  id: 'markdown-to-html',
  name: 'Markdown 转 HTML',
  category: 'converter',
  description: 'Markdown 转 HTML，提供安全预览与源码视图，图片与链接不触网',
  keywords: ['markdown', 'md', 'html', 'preview', '转换', '渲染', '预览'],
  order: 50,
} satisfies ToolMeta
