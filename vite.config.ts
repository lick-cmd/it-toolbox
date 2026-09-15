import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Tauri 需要固定端口；开发服务器被 Tauri 作为 frontendDist 使用
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'es2022',
    // 离线应用不需要 sourcemap，且能显著减小产物体积
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    // modulepreload polyfill 会在产物中注入一处 fetch(e.href, n)（抓取它自己插入的
    // link[rel=modulepreload] href，恒为本地资源，非外发）。但「产物零外发能力」这条
    // 不变量要求 net-zero：与其在扫描器里为它开白名单（那会削弱对真实外发的判定），
    // 不如从源头去掉这次网络调用 —— 目标运行时是 Tauri 的 WebView，本就不需要它。
    modulePreload: { polyfill: false },
  },
})
