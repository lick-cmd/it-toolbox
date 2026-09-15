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
    ],
  },
})
