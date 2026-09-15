import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * 分层依赖硬约束。
 *
 *   app/  →  framework/  →  tools/  →  core/
 *
 * core 是纯函数层，不得接触 React、Tauri 或 DOM；
 * framework 不得感知具体工具的实现。
 */
export default tseslint.config(
  {
    // 构建产物、Rust 生成物，以及本项目的工具/流程产物（技能脚本、SDD 账本）——R37
    ignores: [
      'dist',
      'src-tauri/target',
      'src-tauri/gen',
      'node_modules',
      '.codebuddy',
      '.superpowers',
    ],
  },
  js.configs.recommended,
  tseslint.configs.eslintRecommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Node 脚本（.mjs/.cjs 不在 eslintRecommended 的覆盖内，其 no-undef 仍开启）：
    // 显式声明所需 Node 全局，避免为了过检查而给全仓关掉 no-undef。
    // 有意不声明 fetch：脚本里出现网络 API 应当报错，而不是被当成可用全局。
    files: ['scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Buffer: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        queueMicrotask: 'readonly',
        structuredClone: 'readonly',
      },
    },
  },
  {
    // core 层：纯函数，零 React / 零 Tauri / 零 DOM
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'react/*'], message: 'core 层不得依赖 React' },
            { group: ['@tauri-apps/*'], message: 'core 层不得依赖 Tauri' },
            // 别名与相对路径都要列：no-restricted-imports 只对原始 import 字符串做匹配，
            // 漏掉相对路径会给 core→上层 留一条静默逃逸口（框架层同理，故并列两处）。
            {
              group: [
                '@/framework/*',
                '@/app/*',
                '@/tools/*',
                '../framework/*',
                '../../framework/*',
                '../app/*',
                '../../app/*',
                '../tools/*',
                '../../tools/*',
              ],
              message: 'core 层不得依赖上层',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'core 层不得接触 DOM' },
        { name: 'window', message: 'core 层不得接触 DOM' },
        { name: 'localStorage', message: 'core 层不得接触存储' },
        { name: 'alert', message: 'core 层不得接触 UI' },
      ],
    },
  },
  {
    // framework 层：不知道具体工具的实现
    files: ['src/framework/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/app/*'], message: 'framework 层不得依赖 app 层' },
            {
              group: ['@/tools/*', '../tools/*', '../../tools/*'],
              message: 'framework 层不得依赖具体工具实现',
            },
          ],
        },
      ],
    },
  },
  {
    // 离线守卫自身需要包装网络 API，故豁免
    files: ['src/framework/offline-guard.ts'],
    rules: { 'no-restricted-globals': 'off' },
  },
)
