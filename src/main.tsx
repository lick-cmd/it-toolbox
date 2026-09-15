import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import '@/app/theme.css'

// 开发期外发检测（离线第 2 层）。动态 import 确保其不进入生产包。
if (import.meta.env.DEV) {
  void import('@/framework/offline-guard').then((m) => m.installOfflineGuard())
}

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
