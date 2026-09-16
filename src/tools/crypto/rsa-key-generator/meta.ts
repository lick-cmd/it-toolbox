import type { ToolMeta } from '@/framework/types'

export default {
  id: 'rsa-key-generator',
  name: 'RSA 密钥对生成器',
  category: 'crypto',
  description: '在本地生成 RSA 密钥对，导出 PKCS#1 / PKCS#8 / SPKI / OpenSSH 格式',
  keywords: ['rsa', '密钥对', 'pem', 'pkcs1', 'pkcs8', 'spki', 'openssh', '公钥', '私钥', '生成'],
} satisfies ToolMeta
