import type { ToolMeta } from '@/framework/types'

export default {
  id: 'qrcode-generator',
  name: '二维码生成器',
  category: 'image',
  description: '把文本实时生成二维码，支持颜色、纠错等级与模块尺寸，可导出 PNG / SVG',
  keywords: [
    'qrcode',
    'qr',
    '二维码',
    '二维条码',
    'barcode',
    '生成二维码',
    'qr code',
  ],
  order: 10,
} satisfies ToolMeta
