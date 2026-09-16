import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) }

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'core',
          environment: 'node',
          include: ['src/core/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: [
            'src/framework/**/*.test.{ts,tsx}',
            'src/app/**/*.test.{ts,tsx}',
            'src/tools/**/*.test.{ts,tsx}',
          ],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
      {
        // 构建期脚本（Node 侧）：产物扫描的判定逻辑此前只有「真实产物上跑通」这一条
        // 间接证据，故单独收一个 project 来跑脚本级用例。
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.test.mjs'],
        },
      },
    ],
  },
})
