import type { ToolMeta } from '@/framework/types'

export default {
  id: 'jwt-parser',
  name: 'JWT 解析器',
  category: 'web',
  description: '拆解 JWT 的头部、载荷与签名，可读化时间声明并判定过期状态（不校验签名）',
  keywords: ['jwt', 'token', 'jose', 'jws', 'bearer', '解析', '令牌', '解码', '过期'],
  order: 30,
} satisfies ToolMeta
