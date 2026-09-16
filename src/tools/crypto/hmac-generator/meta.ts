import type { ToolMeta } from '@/framework/types'

export default {
  id: 'hmac-generator',
  name: 'HMAC 生成器',
  category: 'crypto',
  description: '计算 HMAC 消息认证码，支持四种算法与多编码输入输出',
  keywords: ['hmac', '签名', '摘要', '消息认证', 'sha256', 'sha512', 'mac', '校验'],
} satisfies ToolMeta
