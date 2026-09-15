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
  },
})
