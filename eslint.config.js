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
    // core 的生产代码要在 WebView 中运行，Node 内置模块只在测试里可用。
    // 这条口子是 T6 为 openssl 交叉验证打开 types: ["node"] 时新开的，
    // 不堵住就会出现「类型通过、WebView 崩溃」的静默缺陷。
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'core 生产代码不得依赖 Node 内置模块' },
            // `node:` 前缀不是唯一写法：裸模块名（'fs'）同样会在 WebView 里崩，而
            // @types/node 对两者都声明，只挡前缀会留下一整片静默漏洞。
            {
              group: [
                'fs',
                'fs/*',
                'path',
                'path/*',
                'os',
                'os/*',
                'child_process',
                'crypto',
                'stream',
                'stream/*',
                'util',
                'util/*',
                'buffer',
                'events',
                'url',
                'url/*',
                'assert',
                'assert/*',
                'zlib',
                'net',
                'http',
                'https',
                'http2',
                'tls',
                'dgram',
                'cluster',
                'vm',
                'v8',
                'timers',
                'timers/*',
                'readline',
                'readline/*',
                'dns',
                'dns/*',
                'tty',
                'perf_hooks',
                'string_decoder',
                'querystring',
                'worker_threads',
              ],
              message: 'core 生产代码不得依赖 Node 内置模块（含裸模块名写法）',
            },
          ],
        },
      ],
      // 只堵 import 是不够的：types 打开 "node" 后，process / Buffer / setImmediate 这些
      // **全局标识符**会被注入，`Buffer.from(...)` 能同时通过 tsc 与 lint，却在 WebView 里崩。
      // 本块 ignore 了测试（core 测试里确实在用 Buffer），故这里补上全局限制；
      // 又因后匹配的配置块会整体覆盖同名规则，DOM 那四个全局必须在这里重列一遍。
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'core 层不得接触 DOM' },
        { name: 'window', message: 'core 层不得接触 DOM' },
        { name: 'localStorage', message: 'core 层不得接触存储' },
        { name: 'alert', message: 'core 层不得接触 UI' },
        { name: 'process', message: 'core 生产代码不得依赖 Node 全局（WebView 中不存在）' },
        { name: 'Buffer', message: 'core 生产代码不得依赖 Node 全局（WebView 中不存在）' },
        { name: 'setImmediate', message: 'core 生产代码不得依赖 Node 全局（WebView 中不存在）' },
        {
          name: 'clearImmediate',
          message: 'core 生产代码不得依赖 Node 全局（WebView 中不存在）',
        },
        { name: 'global', message: 'core 生产代码不得依赖 Node 全局（WebView 中不存在）' },
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
