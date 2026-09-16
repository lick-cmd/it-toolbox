import type { ToolMeta } from '@/framework/types'

export default {
  id: 'token-generator',
  name: 'Token 生成器',
  category: 'crypto',
  description: '生成密码学安全的随机 Token，支持字符集、长度、数量与前缀',
  keywords: ['token', '随机', '随机字符串', '密钥', 'apikey', 'secret', '密码', '生成'],
} satisfies ToolMeta
