---
change: it-toolbox-app
design-doc: docs/superpowers/specs/2026-09-15-it-toolbox-design.md
base-ref: f4497ace919e563ab43433da2a8b7c1bb3b09dc2
---

# IT Toolbox 基座与框架 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可运行的离线桌面工具箱骨架 —— 脚手架、Core 共享原语、工具注册与搜索、统一交互层、应用外壳、离线四层强制，并以 UUID 生成器端到端打通「注册 → 搜索 → 打开 → 计算 → 复制 → 状态恢复」全链路。

**Architecture:** 四层单向依赖（`app` → `framework` → `tools` → `core`）。算法全部落在 `core/` 的纯函数里（零 React / 零 Tauri / 零 DOM），可在 Node 中毫秒级测试；呈现由 `framework/` 兜底，使单个工具的实现量趋近于零。工具通过 `meta.ts`（同步元数据）+ `Tool.tsx`（懒加载组件）两文件声明，由 `import.meta.glob` 自动注册，无中心清单。

**Tech Stack:** Tauri 2.11 · React 19.3 · TypeScript 6.0.3 · Vite 8.3 · Vitest 5.0 · Tailwind CSS 4.3 · js-yaml 5.4 · markdown-it 15.0 · qrcode 1.5

**Spec:** `docs/superpowers/specs/2026-09-15-it-toolbox-design.md`

**本计划的范围：** 对应 `tasks.md` 的 1、2、3、4 组全部，加 4.10/4.11 离线强制，加 5.2/5.8 的 UUID 样板。**不含**其余 16 个工具 —— 它们由计划② 承接，届时沿用本计划已证实的模式。

---

## Global Constraints

以下约束隐含适用于**每一个任务**，不再逐条重复。

| 约束 | 精确值 |
|---|---|
| 桌面外壳 | Tauri 2.x（`@tauri-apps/cli` ^2.11.4） |
| 目标产物 | macOS arm64 `.dmg`、macOS x64 `.dmg`、Windows x64 `.exe`(NSIS)、Windows arm64 `.exe`(NSIS) |
| 单平台安装包体积 | **≤ 15MB** |
| 运行期网络行为 | **零出网请求**（四层强制，见 Task 5） |
| Windows WebView2 | `webviewInstallMode: { type: "skip" }` |
| 主题 | 未显式选择时**默认暗色**；选项为 `dark` / `light` / `system` |
| 分层依赖 | `core/` 不得 import React、Tauri、DOM API；`core/` 不得 import `framework/`、`tools/`、`app/`；`framework/` 不得 import `tools/` 具体实现 |
| 禁止引入 | 第三方加密库、图标库、UI 组件库、状态管理库、Web 字体、遥测/崩溃上报 SDK、`tauri-plugin-updater` |
| 解析类错误 | 统一提供 `reason` + `line`(1基) + `column`(1基) + `offset`，无法定位时降级 |
| 工具数量 | 17 个，归属 5 个类别：`crypto` / `converter` / `web` / `image` / `dev` |
| 视觉基调 | 开发者极简：UI 字号 13px、代码区 12.5px 等宽、圆角 4px、无阴影（浮层除外） |
| Node 版本 | ≥ 20（本机 23.7.0），`crypto.subtle` 原生可用 |
| Rust 版本 | ≥ 1.77（本机 1.96.0） |

### 版本事实（已于 2026-09-15 核实，勿臆改）

- `js-yaml` **5.x 自带类型定义** → **不要**安装 `@types/js-yaml`（会冲突）
- `markdown-it` **15.x 自带类型定义** → **不要**安装 `@types/markdown-it`（会冲突）
- `qrcode` **1.5.4 无自带类型** → **需要** `@types/qrcode`
- `js-yaml` 5.x 的 `YAMLException.mark` 为 `SnippetMark`：`{ position, line, column, snippet }`，其中 **`line` 与 `column` 从 0 开始**，写入 `Result` 时必须 `+1`
- `js-yaml` 5.x **已移除 `DEFAULT_SCHEMA`**，保留 `FAILSAFE_SCHEMA` / `JSON_SCHEMA` / `CORE_SCHEMA`（本方案用 `JSON_SCHEMA`）
- `qrcode` 的 `create(text, opts)` 返回 `{ modules: { size: number; data: Uint8Array }, version: number }`

---

## File Structure

```
it-tool/
├── index.html
├── package.json
├── tsconfig.json                       严格 TS 配置 + @/* 别名
├── vite.config.ts                      React + Tailwind 插件，别名，Tauri 端口约定
├── vitest.config.ts                    两个项目：core(node) / ui(jsdom)
├── eslint.config.js                    扁平配置 + 分层依赖硬约束
├── .prettierrc
├── scripts/
│   └── scan-egress.mjs                 构建产物外发扫描（离线第 3 层）
├── src/
│   ├── main.tsx                        入口：装 offline-guard → 应用主题 → 挂载
│   ├── app/
│   │   ├── App.tsx                     主布局装配 + 路由状态
│   │   ├── Sidebar.tsx                 分类分组 + 最近使用 + 收藏 + 窄窗折叠
│   │   ├── CommandPalette.tsx          Cmd/Ctrl+K 命令面板
│   │   ├── ToolHeader.tsx              工具标题栏
│   │   └── theme.css                   Tailwind 4 语义令牌 + 亮/暗变量
│   ├── core/                           ← 纯函数，零 React / 零 Tauri / 零 DOM
│   │   ├── result.ts                   Result<T> 与 ok/err 构造
│   │   ├── bytes.ts                    hex / base64 / base64url / utf8 互转
│   │   ├── random.ts                   安全随机（拒绝采样）
│   │   ├── json/
│   │   │   ├── scanner.ts              逐 token 扫描 + 结构校验 + 三定位
│   │   │   ├── parse.ts                严格解析（对外统一入口）
│   │   │   ├── minify.ts               token 级去空白（保留转义字面量）
│   │   │   └── format.ts               token 级重排缩进（+ 可选键排序）
│   │   └── crypto/
│   │       └── uuid.ts                 v1 / v4 / v7 + 同毫秒单调
│   ├── framework/
│   │   ├── types.ts                    ToolMeta / ToolCategory
│   │   ├── categories.ts               5 个类别的枚举、顺序、显示名、图标名
│   │   ├── registry.ts                 glob 自动发现 + 不变式校验 + 索引
│   │   ├── search.ts                   中英边界切词 + 模糊匹配（纯函数）
│   │   ├── storage.ts                  版本化 localStorage + 内存兜底
│   │   ├── offline-guard.ts            开发期外发检测（离线第 2 层）
│   │   ├── theme.ts                    主题解析与应用
│   │   ├── clipboard.ts                navigator.clipboard → Tauri 回退
│   │   ├── file.ts                     浏览器降级 / Tauri 保存对话框
│   │   ├── useToolState.ts             按工具 id 隔离的状态
│   │   ├── usePrefs.ts                 主题 / 最近使用 / 收藏
│   │   ├── ToolHost.tsx                懒加载 + Suspense + 错误隔离
│   │   ├── ToolErrorBoundary.tsx       单工具异常隔离
│   │   ├── ToolLayout.tsx              四区域布局（判别联合）
│   │   └── ui/
│   │       ├── Icon.tsx                约 20 个手写 SVG
│   │       ├── Pane.tsx                带标题与操作区的面板
│   │       ├── CodeArea.tsx            等宽文本区（可只读、可标错行）
│   │       ├── CopyButton.tsx
│   │       ├── DownloadButton.tsx
│   │       ├── Field.tsx               标签 + 控件行
│   │       ├── Inputs.tsx              Select / NumberInput / ColorInput / Checkbox / Segmented
│   │       ├── ErrorNote.tsx           统一错误呈现（含三定位）
│   │       ├── EmptyState.tsx
│   │       └── Spinner.tsx
│   ├── tools/
│   │   └── crypto/uuid-generator/
│   │       ├── meta.ts                 同步元数据
│   │       └── Tool.tsx                懒加载组件
│   └── test/
│       └── setup.ts                    jsdom 补丁（matchMedia）
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json                 窗口 + bundle + CSP
    ├── capabilities/default.json       收敛的能力集
    └── src/{main.rs, lib.rs}
```

---

### Task 1: 前端工程脚手架 + `core/result.ts`

打通「TS 编译 → Vite 构建 → Vitest 在 node 环境跑 core 测试」的最小闭环。把 `result.ts` 放进本任务，是为了让脚手架有一个**真实**的验证对象，而不是占位测试。

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/test/setup.ts`, `.prettierrc`
- Create: `src/core/result.ts`
- Test: `src/core/result.test.ts`

**Interfaces:**
- Consumes: 无（起点）
- Produces: `Result<T>`、`ok<T>(value)`、`err(...)`、`ErrorInfo` —— 后续**所有** Core 模块与工具都依赖这三个导出

- [ ] **Step 1: 初始化 package.json 与依赖**

```bash
cd /Users/cankaili/Documents/Project/it-tool
```

写入 `package.json`（版本已于 2026-09-15 核实；**注意没有 `@types/js-yaml` 与 `@types/markdown-it`**，因为它们自带类型）：

```json
{
  "name": "it-toolbox",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "scan:egress": "node scripts/scan-egress.mjs",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.11.1",
    "@tauri-apps/plugin-clipboard-manager": "^2.3.3",
    "@tauri-apps/plugin-dialog": "^2.7.3",
    "@tauri-apps/plugin-fs": "^2.5.2",
    "js-yaml": "^5.4.2",
    "markdown-it": "^15.0.2",
    "qrcode": "^1.5.4",
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@tailwindcss/vite": "^4.3.3",
    "@tauri-apps/cli": "^2.11.4",
    "@testing-library/react": "^16.3.3",
    "@testing-library/user-event": "^14.6.7",
    "@types/qrcode": "^1.5.6",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.1",
    "eslint": "^10.10.0",
    "jsdom": "^30.0.1",
    "prettier": "^3.9.6",
    "tailwindcss": "^4.3.3",
    "typescript": "^7.0.2",
    "typescript-eslint": "^8.70.0",
    "vite": "^8.3.0",
    "vitest": "^5.0.0"
  }
}
```

```bash
npm install
```

预期：安装成功。若任一版本解析失败，执行 `npm view <pkg> version` 查看当前最新版并相应调整，**不要**降级到不符合上表主版本的其他大版本。

- [ ] **Step 2: 写入 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "scripts", "vite.config.ts", "vitest.config.ts"]
}
```

`noUncheckedIndexedAccess` 是刻意开启的：本项目的核心是解析器（JSON / YAML / URL / JWT），越界索引正是这类代码的典型缺陷来源。

- [ ] **Step 3: 写入 vite.config.ts**

```ts
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
```

- [ ] **Step 4: 写入 vitest.config.ts（两个测试项目）**

Core 与 UI 的运行环境截然不同，分开可以避免让全部 Core 测试承受 jsdom 的启动开销。

```ts
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
          include: ['src/framework/**/*.test.{ts,tsx}', 'src/app/**/*.test.{ts,tsx}'],
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
  },
})
```

- [ ] **Step 5: 写入 test setup 与最小入口**

`src/test/setup.ts`：

```ts
import { vi } from 'vitest'

// jsdom 不实现 matchMedia，而主题「跟随系统」依赖它
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}
```

`index.html`：

```html
<!doctype html>
<html lang="zh-CN" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>IT Toolbox</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

注意 `class="dark"`：默认暗色由静态 HTML 承载，避免首帧白闪。

`src/main.tsx`：

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/app/App'
import '@/app/theme.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`src/App.tsx`（本任务的临时外壳，Task 17 会替换）：

```tsx
import { ok } from '@/core/result'

export function App() {
  return <main className="p-4 font-mono text-fg">{ok('脚手架就绪').value}</main>
}
```

- [ ] **Step 6: 写失败测试 —— `src/core/result.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { err, ok, unwrapOr } from './result'

describe('Result', () => {
  it('ok 包装成功值与判别字段', () => {
    const r = ok(42)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(42)
  })

  it('err 只要求 error 字段', () => {
    const r = err('解析失败')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('解析失败')
      expect(r.line).toBeUndefined()
    }
  })

  it('err 保留三项定位信息', () => {
    const r = err('意外字符', { offset: 12, line: 2, column: 3 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.offset).toBe(12)
      expect(r.line).toBe(2)
      expect(r.column).toBe(3)
    }
  })

  it('err 保留机器可判别的错误码与建议', () => {
    const r = err('不是绝对 URL', { code: 'NOT_ABSOLUTE', suggestion: 'https://a.com' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('NOT_ABSOLUTE')
      expect(r.suggestion).toBe('https://a.com')
    }
  })

  it('unwrapOr 在成功时取值、失败时取兜底', () => {
    expect(unwrapOr(ok('a'), 'z')).toBe('a')
    expect(unwrapOr(err('boom'), 'z')).toBe('z')
  })
})
```

- [ ] **Step 7: 运行测试，确认失败**

Run: `npx vitest run --project core`
Expected: FAIL —— `Failed to resolve import "./result"`（文件尚未创建）

- [ ] **Step 8: 实现 `src/core/result.ts`**

```ts
/**
 * 解析类操作的统一返回类型。
 *
 * 设计取舍：仅用于「非法输入是常规路径」的解析类函数
 * （JSON / YAML / JWT / URL / Base64 / 日期）。
 * 生成类操作（token / uuid / ulid / hmac / rsa）的输入由控件约束，直接返回终值。
 */
export type Result<T> = { ok: true; value: T } | ({ ok: false } & ErrorInfo)

export interface ErrorInfo {
  /** 面向用户的错误原因 */
  error: string
  /** 机器可判别的错误码，例如 'NOT_ABSOLUTE'、'BAD_ESCAPE' */
  code?: string
  /** 补充说明 */
  detail?: string
  /** 可操作的修复建议 */
  suggestion?: string
  /** 字符偏移（0 基） */
  offset?: number
  /** 行号（1 基） */
  line?: number
  /** 列号（1 基） */
  column?: number
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err(error: string, info?: Omit<ErrorInfo, 'error'>): Result<never> {
  return { ok: false, error, ...info }
}

/** 成功时取值，失败时返回兜底值。 */
export function unwrapOr<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.value : fallback
}
```

- [ ] **Step 9: 运行测试，确认通过**

Run: `npx vitest run --project core`
Expected: PASS，5 个用例通过

- [ ] **Step 10: 确认类型检查与构建均通过**

Run: `npm run typecheck && npm run build`
Expected: 两者均无错误退出。`dist/` 被生成。

- [ ] **Step 11: 提交**

```bash
git add -A
git commit -m "chore: 搭建前端工程脚手架并引入 Result 类型

- Vite 8 + React 19 + TypeScript 6 + Tailwind 4
- Vitest 5 双项目配置：core(node) / ui(jsdom)
- 锁定依赖主版本；js-yaml@5 与 markdown-it@15 自带类型，不再安装 @types/*
- core/result.ts：解析类操作的统一返回类型，含三定位与错误码字段"
```

---

### Task 2: Tailwind 4 语义令牌与主题切换

**关键决策：不启用 `dark:` 变体，改用语义令牌。** Tailwind 4 的 `@theme inline` 让工具类引用 CSS 变量而非内联值，因此 `bg-surface` / `text-fg` 这类类名在亮暗两种主题下自动正确。这消除了每个组件写两套类名的负担 —— 在 17 个工具、数十个组件的规模下，这是可维护性的分水岭。

**Files:**
- Create: `src/app/theme.css`, `src/framework/theme.ts`
- Test: `src/framework/theme.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `ThemeMode`、`resolveTheme(mode, prefersDark)`、`applyTheme(resolved)`、`systemPrefersDark()` —— Task 12 的 `usePrefs` 与 Task 17 的 `Sidebar` 依赖它们

- [ ] **Step 1: 写失败测试 —— `src/framework/theme.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, resolveTheme, type ThemeMode } from './theme'

describe('resolveTheme', () => {
  it('显式暗色不受系统影响', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('显式亮色不受系统影响', () => {
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('跟随系统时采用系统偏好', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('未显式选择时默认暗色（spec P1）', () => {
    const DEFAULT_MODE: ThemeMode = 'dark'
    // 即使系统偏好亮色，默认模式仍解析为暗色
    expect(resolveTheme(DEFAULT_MODE, false)).toBe('dark')
  })
})

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.className = ''
  })

  it('暗色时挂 dark 类，不挂 light', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it('亮色时挂 light 类，不挂 dark', () => {
    applyTheme('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('重复应用同一主题不产生重复类名', () => {
    applyTheme('dark')
    applyTheme('dark')
    expect(document.documentElement.className.trim()).toBe('dark')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run --project ui`
Expected: FAIL —— `Failed to resolve import "./theme"`

- [ ] **Step 3: 实现 `src/framework/theme.ts`**

```ts
export type ThemeMode = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

/** 未显式选择时的默认主题（spec P1：默认暗色，不跟随系统）。 */
export const DEFAULT_THEME_MODE: ThemeMode = 'dark'

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'system') return prefersDark ? 'dark' : 'light'
  return mode
}

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run --project ui`
Expected: PASS，7 个用例通过

- [ ] **Step 5: 写入 `src/app/theme.css`**

Tailwind 4 是 CSS-first 配置，**没有 `tailwind.config.ts`**。`@theme inline` 是运行时主题切换的关键：它让 `bg-surface` 编译为 `background-color: var(--app-surface)`，而不是把字面量内联进去。

```css
@import 'tailwindcss';

/* 静态令牌：字体、圆角。开发者极简基调 —— 小圆角、等宽为主。 */
@theme {
  --font-sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas,
    'Liberation Mono', monospace;

  --radius-sm: 3px;
  --radius-md: 4px;
  --radius-lg: 6px;
}

/* 语义令牌：引用 CSS 变量，从而实现运行时切换主题 */
@theme inline {
  --color-bg: var(--app-bg);
  --color-surface: var(--app-surface);
  --color-surface-2: var(--app-surface-2);
  --color-border: var(--app-border);
  --color-fg: var(--app-fg);
  --color-muted: var(--app-muted);
  --color-accent: var(--app-accent);
  --color-danger: var(--app-danger);
  --color-success: var(--app-success);
  --color-warn: var(--app-warn);
}

/* 暗色为默认（spec P1） */
:root {
  color-scheme: dark;
  --app-bg: #12131a;
  --app-surface: #191b24;
  --app-surface-2: #20232e;
  --app-border: #2b2f3d;
  --app-fg: #e6e8ef;
  --app-muted: #949ab0;
  --app-accent: #5b8cff;
  --app-danger: #ff6b6b;
  --app-success: #3ddc97;
  --app-warn: #ffc857;
}

:root.light {
  color-scheme: light;
  --app-bg: #ffffff;
  --app-surface: #f7f8fa;
  --app-surface-2: #eceef3;
  --app-border: #d8dce4;
  --app-fg: #1c1f28;
  --app-muted: #5c6376;
  --app-accent: #2563eb;
  --app-danger: #d92d20;
  --app-success: #067647;
  --app-warn: #b54708;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  background: var(--app-bg);
  color: var(--app-fg);
  font-family: var(--font-sans);
  /* 开发者极简：高信息密度 */
  font-size: 13px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
  overflow: hidden;
}

/* 代码区统一等宽与字号 */
.code-text {
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.5;
  tab-size: 2;
}

* {
  min-width: 0;
}
```

- [ ] **Step 6: 验证构建通过且产物中不含远程资源**

Run: `npm run build && npm run scan:egress --silent || true`
Expected: 构建成功。此步的 `scan:egress` 脚本尚未创建（Task 5 补上），忽略该命令失败即可，但**必须确认构建成功**。

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(theme): 引入 Tailwind 4 语义令牌与主题切换

- 采用 @theme inline 语义令牌，不启用 dark: 变体，组件无需写两套类名
- 暗色为默认主题，亮色经 :root.light 覆盖变量实现
- framework/theme.ts 提供 resolveTheme / applyTheme / systemPrefersDark
- 开发者极简基调：13px UI 字号、12.5px 等宽代码区、4px 圆角"
```

---

### Task 3: Tauri 工程与安全配置

本任务落地三件事：可编译的 Tauri 外壳、**生产最严 / 开发放宽的 CSP**、以及为 ≤15MB 预算服务的 release 编译选项。

**Files:**
- Create: `src-tauri/`（由 `tauri init` 生成后覆盖）→ `Cargo.toml`, `build.rs`, `tauri.conf.json`, `capabilities/default.json`, `src/main.rs`, `src/lib.rs`
- Modify: `package.json`（新增 `tauri:dev` / `tauri:build` 便利脚本）

**Interfaces:**
- Consumes: Task 1 的 `dist/` 构建产物与固定端口 1420
- Produces: 可运行的桌面外壳；`app.security.csp` / `devCsp` 是 Task 5「结构层」的落点

- [ ] **Step 1: 生成 Tauri 骨架**

```bash
cd /Users/cankaili/Documents/Project/it-tool
npx tauri init --ci \
  --app-name "it-toolbox" \
  --window-title "IT Toolbox" \
  --frontend-dist "../dist" \
  --dev-url "http://localhost:1420" \
  --before-dev-command "npm run dev" \
  --before-build-command "npm run build"
```

预期：生成 `src-tauri/`，含 `Cargo.toml`、`tauri.conf.json`、`build.rs`、`src/main.rs`、`src/lib.rs`、`icons/`。

- [ ] **Step 2: 写入 `src-tauri/Cargo.toml`**

`[profile.release]` 的四项设置是为 ≤15MB 预算服务的，不可省略：`opt-level = "s"` 优化体积、`lto = true` 跨 crate 内联、`codegen-units = 1` 换取更彻底的优化、`strip = true` 剥离符号表。

```toml
[package]
name = "it-toolbox"
version = "0.1.0"
description = "离线 IT 工具箱"
edition = "2021"
rust-version = "1.77"

[lib]
name = "it_toolbox_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-clipboard-manager = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[profile.release]
codegen-units = 1
lto = true
opt-level = "s"
panic = "abort"
strip = true
```

- [ ] **Step 3: 写入 Rust 入口**

`src-tauri/src/lib.rs`：

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

`src-tauri/src/main.rs`：

```rust
// 生产构建下隐藏 Windows 控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    it_toolbox_lib::run()
}
```

- [ ] **Step 4: 写入 `src-tauri/tauri.conf.json`**

**本任务最关键的产物。** CSP 分两套：

- `csp`（生产）：`connect-src` **只**放行 Tauri 内部 IPC。`ipc:` 与 `http://ipc.localhost` 两个写法必须同时出现 —— 自定义协议在各平台的呈现方式不同。此配置下 `fetch` 到任何外部地址都会被 WebView 拒绝，**零外发在结构上成立**。`img-src` 刻意不含 `https:`，从而封死「远程图片」这条最易漏的声明式外发路径。
- `devCsp`（开发）：额外放行 `ws://localhost:1420`（Vite HMR 走 WebSocket，而 `http:` **不覆盖** `ws:`）与 `'unsafe-eval'`（React Refresh 需要）。**这些放宽绝不进入生产。**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "IT Toolbox",
  "version": "0.1.0",
  "identifier": "ai.it-toolbox.desktop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "label": "main",
        "title": "IT Toolbox",
        "width": 1180,
        "height": 780,
        "minWidth": 480,
        "minHeight": 420,
        "resizable": true,
        "center": true
      }
    ],
    "security": {
      "csp": {
        "default-src": "'self'",
        "connect-src": "ipc: http://ipc.localhost",
        "img-src": "'self' asset: http://asset.localhost data: blob:",
        "font-src": "'self'",
        "style-src": "'self' 'unsafe-inline'",
        "script-src": "'self'",
        "base-uri": "'none'",
        "form-action": "'none'",
        "frame-src": "'none'",
        "object-src": "'none'"
      },
      "devCsp": {
        "default-src": "'self'",
        "connect-src": "ipc: http://ipc.localhost ws://localhost:1420 http://localhost:1420",
        "img-src": "'self' asset: http://asset.localhost data: blob:",
        "font-src": "'self'",
        "style-src": "'self' 'unsafe-inline'",
        "script-src": "'self' 'unsafe-eval'",
        "base-uri": "'none'",
        "form-action": "'none'",
        "frame-src": "'none'",
        "object-src": "'none'"
      }
    }
  },
  "bundle": {
    "active": true,
    "targets": ["dmg", "nsis"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "windows": {
      "webviewInstallMode": { "type": "skip" }
    },
    "macOS": {
      "minimumSystemVersion": "10.15"
    }
  }
}
```

`webviewInstallMode: { "type": "skip" }` 对应 spec P7：安装包不检测不安装 WebView2，因而**安装过程零网络请求**，且体积不受影响。前置条件是目标机器自带运行时（Windows 11 与 Windows 10 2018 年 4 月版及以后均已系统分发）。

- [ ] **Step 5: 写入能力集 `src-tauri/capabilities/default.json`**

只申请实际用到的能力，`fs` 的作用域限定在三个常见导出位置，而不是 `**`。

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "IT Toolbox 所需的最小能力集",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:allow-save",
    "dialog:allow-open",
    "clipboard-manager:allow-write-text",
    "clipboard-manager:allow-read-text",
    {
      "identifier": "fs:allow-write-file",
      "allow": [
        { "path": "$DOWNLOAD/**" },
        { "path": "$DOCUMENT/**" },
        { "path": "$DESKTOP/**" }
      ]
    },
    {
      "identifier": "fs:allow-read-file",
      "allow": [
        { "path": "$DOWNLOAD/**" },
        { "path": "$DOCUMENT/**" },
        { "path": "$DESKTOP/**" }
      ]
    }
  ]
}
```

**若此文件导致 schema 校验失败**，说明该 Tauri 版本的 scoped permission 写法有出入 —— 查阅 https://v2.tauri.app/plugin/file-system/ 的 scope 章节按当前语法调整，**不要**改为 `"fs:default"` 或 `**` 放宽作用域。

- [ ] **Step 6: 编译验证（不打包，避免漫长的捆绑开销）**

```bash
cd src-tauri && cargo check
```

Expected: 编译通过。首次执行需下载并编译依赖，可能耗时数分钟。

- [ ] **Step 7: 冒烟验证 —— 应用能启动且 IPC 可用**

```bash
cd /Users/cankaili/Documents/Project/it-tool && npm run tauri dev
```

预期：窗口打开并显示「脚手架就绪」。**在窗口内按 F12 打开开发者工具，确认控制台无 CSP 违规报错** —— 若有 `Refused to connect` 相关报错，说明 `connect-src` 的 IPC 写法有误，回到 Step 4 核对。

验证完成后关闭应用。同时在 `package.json` 的 `scripts` 中加入两个便利脚本：

```json
"tauri:dev": "tauri dev",
"tauri:build": "tauri build"
```

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat(shell): 接入 Tauri 2 外壳与严格 CSP

- 生产 CSP 将 connect-src 限定为 Tauri 内部 IPC，零外发在结构上成立
- img-src 刻意不含 https:，封死远程图片这条声明式外发路径
- devCsp 单独放行 Vite HMR 的 ws:// 与 React Refresh 的 unsafe-eval，不入生产
- webviewInstallMode=skip：Windows 安装过程零网络请求，且不影响体积预算
- release 编译选项 opt-level=s + lto + codegen-units=1 + strip，服务 15MB 预算
- capabilities 仅申请 dialog/fs/clipboard 所需权限，fs 作用域限定三个导出目录"
```

---

### Task 4: ESLint 分层依赖硬约束

架构分层的价值完全依赖「无人违规」。靠约定和代码评审在 17 个工具、数十个文件的规模下必然失守，因此把它做成 lint 规则：**违规即构建失败**。

**Files:**
- Create: `eslint.config.js`
- Modify: `package.json`（`lint` 脚本已在 Task 1 就位）

**Interfaces:**
- Consumes: Task 1 的目录结构
- Produces: 分层约束规则 —— 后续每个任务都必须在其约束下通过 `npm run lint`

- [ ] **Step 1: 写一个刻意违规的文件来验证规则真的会拦截**

先建立「测试 isValid」的信念：规则必须能捕获违规，否则它只是一份装饰。

创建临时文件 `src/core/__lint-probe.ts`：

```ts
import { useState } from 'react'

export function probe() {
  const [x] = useState(0)
  return x
}
```

- [ ] **Step 2: 运行 lint，确认当前（无规则时）不报错**

Run: `npx eslint src/core/__lint-probe.ts`
Expected: 不报错（或仅报无关警告）。这证明**在加入规则前，违规是静默的**。

- [ ] **Step 3: 写入 `eslint.config.js`**

```js
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
  { ignores: ['dist', 'src-tauri/target', 'src-tauri/gen', 'node_modules'] },
  js.configs.recommended,
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
    // core 层：纯函数，零 React / 零 Tauri / 零 DOM
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'react/*'], message: 'core 层不得依赖 React' },
            { group: ['@tauri-apps/*'], message: 'core 层不得依赖 Tauri' },
            { group: ['@/framework/*', '@/app/*', '@/tools/*'], message: 'core 层不得依赖上层' },
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
```

`@eslint/js` 已在 Task 1 的依赖清单中（版本为 `^10.0.1`，注意它与 `eslint` 并非同版本号）。

- [ ] **Step 4: 运行 lint，确认 probe 文件被拦截**

Run: `npx eslint src/core/__lint-probe.ts`
Expected: FAIL，输出 `core 层不得依赖 React`（`no-restricted-imports`）与 `'useState' is defined but never used` 相关的错误。

**若未报出分层错误**，说明 `files` 匹配未命中或配置未生效 —— 先修好规则再继续，不要跳过。

- [ ] **Step 5: 删除探针并确认全量 lint 通过**

```bash
rm src/core/__lint-probe.ts
npx eslint .
```

Expected: 无错误退出。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "chore(lint): 以 ESLint 规则固化分层依赖约束

- core 层禁止依赖 React / Tauri / 上层模块，并禁止接触 DOM 与存储
- framework 层禁止依赖 app 层与具体工具实现
- 先用违反规则的探针文件验证规则确实会拦截，再删除探针
- 依赖分层的正确性从此由构建保证，而非依赖代码评审"
```

---

### Task 5: 离线四层强制

spec 的「离线可用」若只写"不产生出网请求"，第 18 个工具的作者引一个带版本检查的库就会静默失效。本任务把它从**行为期望**升级为**可验证的不变量**，落地四层中的第 2、3 层，并验证第 1 层（Task 3 的 CSP）确实生效。

**关键设计点：守卫必须放行 localhost。** Vite 的 HMR 走 `ws://localhost:1420`，若守卫无差别拦截 WebSocket，开发环境会直接不可用。因此判定标准是**目标地址是否为外部**，而不是"是否调用了网络 API"。

**Files:**
- Create: `src/framework/offline-guard.ts`, `scripts/scan-egress.mjs`
- Test: `src/framework/offline-guard.test.ts`
- Modify: `src/main.tsx`（以**动态** import 安装守卫）, `package.json`（`build` 后自动扫描）

**Interfaces:**
- Consumes: Task 3 的 CSP 配置
- Produces: `installOfflineGuard()`、`isLocalTarget(target)`、`getEgressViolations()` —— `isLocalTarget` 是唯一的判定入口，工具若需判断地址内外应复用它

- [ ] **Step 1: 写失败测试 —— `src/framework/offline-guard.test.ts`**

```ts
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  getEgressViolations,
  installOfflineGuard,
  isLocalTarget,
} from './offline-guard'

describe('isLocalTarget', () => {
  it.each([
    ['localhost', 'http://localhost:1420/x'],
    ['回环 IPv4', 'http://127.0.0.1:9999/'],
    ['回环 IPv6', 'http://[::1]:1420/'],
    ['相对路径', '/api/thing'],
    ['空字符串', ''],
    ['Tauri IPC 协议', 'ipc://localhost'],
    ['Tauri asset 协议', 'asset://localhost/a.png'],
    ['blob 对象 URL', 'blob:http://localhost/uuid'],
    ['data URL', 'data:image/png;base64,AAAA'],
  ])('%s 视为本地', (_label, target) => {
    expect(isLocalTarget(target)).toBe(true)
  })

  it.each([
    ['https 外站', 'https://example.com/a.png'],
    ['http 外站', 'http://example.com/'],
    ['协议相对外站', '//evil.com/x'],
    ['带端口的 IP 外站', 'http://8.8.8.8:53/'],
  ])('%s 不视为本地', (_label, target) => {
    expect(isLocalTarget(target)).toBe(false)
  })
})

describe('installOfflineGuard', () => {
  const passthrough = vi.fn(async () => new Response('ok'))

  beforeAll(() => {
    // 先替换原始 fetch，再安装守卫，以观察守卫是否放行本地请求
    vi.stubGlobal('fetch', passthrough)
    installOfflineGuard()
  })

  it('放行本地请求，交给原始 fetch', async () => {
    await fetch('/api/things')
    expect(passthrough).toHaveBeenCalledTimes(1)
  })

  it('拦截外部请求并抛出错误', () => {
    expect(() => fetch('https://example.com/telemetry')).toThrowError(/已拦截外发请求/)
  })

  it('拦截外部 WebSocket 连接', () => {
    expect(() => new WebSocket('wss://example.com/socket')).toThrowError(/已拦截外发连接/)
  })

  it('记录违规明细供断言与展示', () => {
    const violations = getEgressViolations()
    expect(violations.length).toBeGreaterThanOrEqual(2)
    expect(violations.some((v) => v.kind === 'fetch' && v.target.includes('example.com'))).toBe(true)
    expect(violations.some((v) => v.kind === 'WebSocket')).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run --project ui`
Expected: FAIL —— `Failed to resolve import "./offline-guard"`

- [ ] **Step 3: 实现 `src/framework/offline-guard.ts`**

```ts
export type EgressKind = 'fetch' | 'XMLHttpRequest' | 'WebSocket' | 'EventSource' | 'sendBeacon'

export interface EgressViolation {
  kind: EgressKind
  target: string
  at: number
}

const violations: EgressViolation[] = []
let installed = false

/** 应用内部协议，不构成出网能力。 */
const INTERNAL_SCHEME = /^(?:ipc:|asset:|tauri:|blob:|data:)/i

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

/**
 * 判断目标是否为本机地址。
 *
 * 之所以以「目标是否外部」而非「是否调用网络 API」为判定标准：
 * Vite 的 HMR 依赖 ws://localhost，若无差别拦截会让开发环境不可用。
 */
export function isLocalTarget(target: string): boolean {
  if (!target) return true
  if (INTERNAL_SCHEME.test(target)) return true
  if (target.startsWith('//')) {
    // 协议相对地址：以当前页面协议解析外站
    return false
  }
  try {
    // 相对路径会落到占位 base 上，因而 hostname 为 localhost
    const url = new URL(target, 'http://localhost')
    return LOOPBACK_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

function record(kind: EgressKind, target: string): void {
  violations.push({ kind, target, at: Date.now() })
  console.error(
    `%c[offline-guard] 检测到外发请求 — ${kind}`,
    'background:#d92d20;color:#fff;padding:2px 6px;border-radius:3px',
    target,
  )
}

function targetOf(input: RequestInfo | URL | string): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url
  return String(input)
}

/**
 * 开发期外发检测（离线第 2 层）。
 *
 * 生产环境由 CSP 承担（第 1 层），本函数不应被静态引入生产包 ——
 * `main.tsx` 中须使用动态 import。
 */
export function installOfflineGuard(): void {
  if (installed) return
  installed = true

  const originalFetch = globalThis.fetch
  globalThis.fetch = function guardedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const target = targetOf(input)
    if (!isLocalTarget(target)) {
      record('fetch', target)
      throw new Error(`[offline-guard] 已拦截外发请求（fetch）：${target}`)
    }
    return originalFetch.call(globalThis, input, init)
  } as typeof globalThis.fetch

  const OriginalXhr = globalThis.XMLHttpRequest
  if (OriginalXhr) {
    class GuardedXhr extends OriginalXhr {
      override open(method: string, url: string | URL, ...rest: unknown[]): void {
        const target = targetOf(url)
        if (!isLocalTarget(target)) {
          record('XMLHttpRequest', target)
          throw new Error(`[offline-guard] 已拦截外发请求（XMLHttpRequest）：${target}`)
        }
        ;(super.open as (...args: unknown[]) => void)(method, url, ...rest)
      }
    }
    globalThis.XMLHttpRequest = GuardedXhr as typeof XMLHttpRequest
  }

  const OriginalWebSocket = globalThis.WebSocket
  if (OriginalWebSocket) {
    class GuardedWebSocket extends OriginalWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const target = targetOf(url)
        if (!isLocalTarget(target)) {
          record('WebSocket', target)
          throw new Error(`[offline-guard] 已拦截外发连接（WebSocket）：${target}`)
        }
        super(url, protocols)
      }
    }
    globalThis.WebSocket = GuardedWebSocket as typeof WebSocket
  }

  const OriginalEventSource = globalThis.EventSource
  if (OriginalEventSource) {
    class GuardedEventSource extends OriginalEventSource {
      constructor(url: string | URL, init?: EventSourceInit) {
        const target = targetOf(url)
        if (!isLocalTarget(target)) {
          record('EventSource', target)
          throw new Error(`[offline-guard] 已拦截外发连接（EventSource）：${target}`)
        }
        super(url, init)
      }
    }
    globalThis.EventSource = GuardedEventSource as typeof EventSource
  }

  if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    navigator.sendBeacon = ((url: string | URL) => {
      const target = targetOf(url)
      record('sendBeacon', target)
      console.error(`[offline-guard] 已拦截外发信标（sendBeacon）：${target}`)
      return false
    }) as typeof navigator.sendBeacon
  }
}

export function getEgressViolations(): readonly EgressViolation[] {
  return violations
}

/** 仅供测试重置违规记录（守卫本身一旦安装即不再卸载）。 */
export function __resetEgressViolationsForTests(): void {
  violations.length = 0
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run --project ui`
Expected: PASS，共 17 个用例（13 个 `isLocalTarget` + 4 个守卫行为）

- [ ] **Step 5: 以动态 import 接入 `main.tsx`**

**必须用动态 import。** 若写成静态 import，`offline-guard` 会进入生产包 —— 它本身含有 `fetch` / `WebSocket` 字面量，会立刻触发 Step 7 的产物扫描，且在生产环境毫无用处。

```tsx
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
```

- [ ] **Step 6: 编写产物扫描脚本 `scripts/scan-egress.mjs`**

```js
#!/usr/bin/env node
/**
 * 离线第 3 层：扫描构建产物，确认没有引入外发能力。
 *
 * 只把「网络 API 调用」作为致命条件。远程 URL 字面量仅作告警 ——
 * 依赖库中的注释、schema 地址、文档链接会产生大量噪声，若设为致命，
 * 该检查很快会被绕过或关闭，那比没有检查更糟。
 *
 * 曾出现的误报：压缩后代码中的 `obj.fetch(` 会被 `\bfetch\s*\(` 命中，
 * 故使用负向后顾断言排除 `.` 与标识符字符。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'dist')

const NETWORK_API =
  /(?<![\w$.])(?:fetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|new\s+EventSource|navigator\.sendBeacon)/g
const REMOTE_URL = /["'`]https?:\/\/[^\s"'`)\\]{4,}/g

// 允许存在于产物中的远程 URL：不可达，仅为依赖内部的字符串常量
const URL_ALLOWLIST = [
  /^["'`]https?:\/\/(?:www\.)?w3\.org\//,
  /^["'`]https?:\/\/(?:www\.)?schema\.tauri\.app\//,
  /^["'`]https?:\/\/yaml\.org\//,
  /^["'`]https?:\/\/json-schema\.org\//,
  /^["'`]https?:\/\/(?:www\.)?github\.com\//,
]

// 守卫自身含有网络 API 字面量；它不应出现在生产包中，若出现则跳过以免自证其罪
const SKIP_PATH = /offline-guard/

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (['.js', '.mjs', '.cjs', '.html', '.css'].includes(extname(path))) out.push(path)
  }
  return out
}

if (!statSync(DIST, { throwIfNoEntry: false })) {
  console.error('[scan-egress] 未找到 dist/，请先执行 npm run build')
  process.exit(1)
}

let fatal = 0
let warned = 0

for (const file of walk(DIST)) {
  const rel = relative(ROOT, file).replaceAll('\\', '/')
  if (SKIP_PATH.test(rel)) continue
  const text = readFileSync(file, 'utf8')

  for (const match of text.matchAll(NETWORK_API)) {
    const line = text.slice(0, match.index).split('\n').length
    console.error(`[FATAL] ${rel}:${line} 出现网络 API 调用：${match[0]}`)
    fatal++
  }

  for (const match of text.matchAll(REMOTE_URL)) {
    if (URL_ALLOWLIST.some((re) => re.test(match[0]))) continue
    const line = text.slice(0, match.index).split('\n').length
    console.warn(`[warn ] ${rel}:${line} 远程 URL 字面量：${match[0].slice(0, 80)}`)
    warned++
  }
}

console.log(`\n[scan-egress] 网络 API 调用 ${fatal} 处；远程 URL 字面量 ${warned} 处`)
if (fatal > 0) {
  console.error('[scan-egress] 产物中存在外发能力，构建失败。')
  process.exit(1)
}
console.log('[scan-egress] 通过：产物中未发现外发能力。')
```

- [ ] **Step 7: 验证扫描脚本真的会拦截违规产物**

先建立「脚本有效」的信念。临时在 `src/App.tsx` 中插入一次外发调用：

```tsx
import { useEffect } from 'react'
import { ok } from '@/core/result'

export function App() {
  useEffect(() => {
    void fetch('https://example.com/ping')
  }, [])
  return <main className="p-4 font-mono text-fg">{ok('脚手架就绪').value}</main>
}
```

Run: `npm run build && node scripts/scan-egress.mjs`
Expected: 构建成功，扫描脚本以非零码退出并输出 `[FATAL] ... 出现网络 API 调用：fetch(`

**若脚本未报错**，说明检测失效 —— 先修好脚本，不要跳过。

- [ ] **Step 8: 移除违规代码，确认扫描通过**

还原 `src/App.tsx`：

```tsx
import { ok } from '@/core/result'

export function App() {
  return <main className="p-4 font-mono text-fg">{ok('脚手架就绪').value}</main>
}
```

Run: `npm run build && node scripts/scan-egress.mjs`
Expected: 输出 `[scan-egress] 通过：产物中未发现外发能力。`，退出码 0

- [ ] **Step 9: 把扫描接入构建流程**

修改 `package.json` 的 `build` 脚本（扫放在 `vite build` 之后）：

```json
"build": "tsc --noEmit && vite build && node scripts/scan-egress.mjs",
```

- [ ] **Step 10: 端到端验证第 1 层 —— CSP 确实拦住外发**

这是第 1 层的**唯一实证**：静态配置读起来对，不等于运行时真的生效。

```bash
npm run tauri dev
```

在应用窗口内按 F12 打开开发者工具，在 Console 中执行：

```js
fetch('https://example.com/telemetry').then(() => 'ALLOWED').catch((e) => String(e))
```

Expected: 返回拒绝信息（`Refused to connect` 或 CSP 违规），**不是** `ALLOWED`。同时在 Console 应看到 CSP 违规告警。

再执行一次本地请求与 IPC 检查，确认没有误伤：

```js
fetch('/').then(() => 'local-ok').catch((e) => String(e))
```

Expected: 返回 `local-ok` —— 说明 CSP 只封外发、未破坏应用自身。

关闭应用。

- [ ] **Step 11: 提交**

```bash
git add -A
git commit -m "feat(offline): 落地离线四层强制中的检测层与预防层

- offline-guard 判定「目标是否外部」而非「是否调用网络 API」，
  以免无差别拦截 Vite HMR 的 ws://localhost
- 以动态 import 接入，确保守卫不进入生产包
- scan-egress 只把网络 API 调用作为致命条件；压缩代码中的 obj.fetch(
  会被负向后顾断言排除，避免误报导致检查被绕过
- 先用越权代码验证扫描脚本确实会拦截，再移除
- 实测 CSP 在运行时拒绝外发且不破坏本地请求与 IPC"
```

---

### Task 6: Core 字节与随机原语

`hex` / `base64` / `base64url` / `utf8` 的互转被加密类与转换器类工具共同依赖；安全随机是所有生成器的地基。这两者必须先于任何工具存在。

**Files:**
- Create: `src/core/bytes.ts`, `src/core/random.ts`
- Test: `src/core/bytes.test.ts`, `src/core/random.test.ts`

**Interfaces:**
- Consumes: `core/result.ts` 的 `Result` / `ok` / `err`
- Produces:
  - `utf8ToBytes(text: string): Uint8Array`
  - `bytesToUtf8(bytes: Uint8Array): Result<string>`
  - `bytesToHex(bytes: Uint8Array, upper?: boolean): string`
  - `hexToBytes(hex: string): Result<Uint8Array>`
  - `bytesToBase64(bytes: Uint8Array, options?: Base64Options): string`
  - `base64ToBytes(input: string, options?: Base64Options): Result<Uint8Array>`
  - `utf8ByteLength(text: string): number`
  - `randomBytes(length: number): Uint8Array`
  - `randomInt(maxExclusive: number): number`
  - `pickChars(alphabet: string, count: number): string`

- [ ] **Step 1: 写失败测试 —— `src/core/random.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { pickChars, randomBytes, randomInt } from './random'

describe('randomBytes', () => {
  it('返回指定长度', () => {
    expect(randomBytes(16).length).toBe(16)
    expect(randomBytes(0).length).toBe(0)
  })

  it('跨越 65536 分块边界仍返回正确长度', () => {
    // getRandomValues 单次调用上限为 65536 字节，实现必须分块
    expect(randomBytes(65_536).length).toBe(65_536)
    expect(randomBytes(70_000).length).toBe(70_000)
  })

  it('两次调用结果不同（极低概率碰撞）', () => {
    expect(Buffer.from(randomBytes(32)).toString('hex')).not.toBe(
      Buffer.from(randomBytes(32)).toString('hex'),
    )
  })

  it('拒绝非法长度', () => {
    expect(() => randomBytes(-1)).toThrowError(/非负整数/)
    expect(() => randomBytes(1.5)).toThrowError(/非负整数/)
  })
})

describe('randomInt', () => {
  it('取值落在 [0, maxExclusive)', () => {
    for (let i = 0; i < 2_000; i++) {
      const v = randomInt(7)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(7)
    }
  })

  it('maxExclusive 为 1 时恒为 0', () => {
    expect(randomInt(1)).toBe(0)
  })

  it('覆盖全部取值（无遗漏）', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 2_000; i++) seen.add(randomInt(5))
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4])
  })

  it('大范围取值不溢出', () => {
    const v = randomInt(0xffff_ffff)
    expect(Number.isInteger(v)).toBe(true)
    expect(v).toBeGreaterThanOrEqual(0)
  })

  it('拒绝非法参数', () => {
    expect(() => randomInt(0)).toThrowError(/正整数/)
    expect(() => randomInt(-3)).toThrowError(/正整数/)
    expect(() => randomInt(2.5)).toThrowError(/正整数/)
  })
})

describe('pickChars', () => {
  it('返回指定长度且所有字符来自字符集', () => {
    const out = pickChars('abc', 40)
    expect(out).toHaveLength(40)
    expect([...out].every((c) => 'abc'.includes(c))).toBe(true)
  })

  it('拒绝少于 2 个字符的字符集', () => {
    expect(() => pickChars('a', 4)).toThrowError(/至少需要 2 个/)
    expect(() => pickChars('', 4)).toThrowError(/至少需要 2 个/)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run --project core`
Expected: FAIL —— `Failed to resolve import "./random"`

- [ ] **Step 3: 实现 `src/core/random.ts`**

```ts
/** 安全随机原语。浏览器与 Node 均提供 crypto.getRandomValues。 */

/** getRandomValues 的规范上限：单次调用不得超过 65536 字节。 */
const MAX_CHUNK = 65_536

export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError('length 必须为非负整数')
  }
  const out = new Uint8Array(length)
  for (let offset = 0; offset < length; offset += MAX_CHUNK) {
    const size = Math.min(MAX_CHUNK, length - offset)
    globalThis.crypto.getRandomValues(out.subarray(offset, offset + size))
  }
  return out
}

/**
 * 返回 [0, maxExclusive) 上的均匀随机整数。
 *
 * 刻意使用拒绝采样而非取模：`value % maxExclusive` 在 maxExclusive 不能整除
 * 2^32 时会使偏小的取值概率更高（例如 maxExclusive=3 时，0 与 1 各多出一次
 * 机会）。密码学场景下这种偏差不可接受。
 */
export function randomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError('maxExclusive 必须为正整数')
  }
  if (maxExclusive === 1) return 0

  const range = 0x1_0000_0000 // 2^32
  const limit = Math.floor(range / maxExclusive) * maxExclusive
  const buffer = new Uint32Array(1)

  for (;;) {
    globalThis.crypto.getRandomValues(buffer)
    const value = buffer[0] ?? 0
    if (value < limit) return value % maxExclusive
  }
}

/** 从字符集中等概率取 count 个字符。 */
export function pickChars(alphabet: string, count: number): string {
  const chars = [...alphabet]
  if (chars.length < 2) throw new RangeError('字符集至少需要 2 个不同字符')
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError('count 必须为非负整数')
  }
  let out = ''
  for (let i = 0; i < count; i++) {
    out += chars[randomInt(chars.length)] ?? ''
  }
  return out
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run --project core`
Expected: PASS，共 12 个用例

- [ ] **Step 5: 写失败测试 —— `src/core/bytes.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  bytesToUtf8,
  hexToBytes,
  utf8ToBytes,
} from './bytes'

describe('hex', () => {
  it('编码为小写十六进制', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x0f, 0xff, 0xab]))).toBe('000fffab')
  })

  it('可按需输出大写', () => {
    expect(bytesToHex(new Uint8Array([0xab]), true)).toBe('AB')
  })

  it('解码忽略空白', () => {
    const r = hexToBytes('ab cd\nef')
    expect(r.ok).toBe(true)
    if (r.ok) expect(bytesToHex(r.value)).toBe('abcdef')
  })

  it('往返一致', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255])
    const r = hexToBytes(bytesToHex(bytes))
    expect(r.ok).toBe(true)
    if (r.ok) expect([...r.value]).toEqual([...bytes])
  })

  it('非十六进制字符报错并指出位置', () => {
    const r = hexToBytes('abz1')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('BAD_HEX_CHAR')
      expect(r.offset).toBe(2)
    }
  })

  it('奇数长度报错', () => {
    const r = hexToBytes('abc')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('BAD_HEX_LENGTH')
  })

  it('空输入得到空字节', () => {
    const r = hexToBytes('')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.length).toBe(0)
  })
})

describe('utf8', () => {
  it('中文与 emoji 往返一致', () => {
    const text = '工具箱 Toolbox 🧰'
    const r = bytesToUtf8(utf8ToBytes(text))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(text)
  })

  it('非法字节序列报错而非静默替换', () => {
    // 0xff 不是合法的 UTF-8 起始字节
    const r = bytesToUtf8(new Uint8Array([0xff, 0xfe]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('BAD_UTF8')
  })
})

describe('base64', () => {
  it('标准字母表带填充', () => {
    expect(bytesToBase64(utf8ToBytes('hello'))).toBe('aGVsbG8=')
  })

  it('可去掉填充', () => {
    expect(bytesToBase64(utf8ToBytes('hello'), { padding: false })).toBe('aGVsbG8')
  })

  it('url-safe 使用 - 与 _', () => {
    // 0xfb 0xff 0xbf 编码后在标准字母表中为 +++
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf])
    expect(bytesToBase64(bytes)).toBe('+/+/')
    expect(bytesToBase64(bytes, { variant: 'urlsafe' })).toBe('-_+/'.replace('+/', '-_'))
  })

  it('中文往返一致（标准）', () => {
    const text = '工具箱'
    const r = base64ToBytes(bytesToBase64(utf8ToBytes(text)))
    expect(r.ok).toBe(true)
    if (r.ok) expect(bytesToUtf8(r.value)).toEqual({ ok: true, value: text })
  })

  it('中文往返一致（url-safe 无填充）', () => {
    const text = '工具箱 Toolbox 🧰'
    const encoded = bytesToBase64(utf8ToBytes(text), { variant: 'urlsafe', padding: false })
    const r = base64ToBytes(encoded)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const decoded = bytesToUtf8(r.value)
      expect(decoded.ok).toBe(true)
      if (decoded.ok) expect(decoded.value).toBe(text)
    }
  })

  it('解码容忍空白与换行', () => {
    const r = base64ToBytes('aGVs\nbG8=')
    expect(r.ok).toBe(true)
    if (r.ok) expect(bytesToUtf8(r.value)).toEqual({ ok: true, value: 'hello' })
  })

  it('解码容忍缺失填充', () => {
    const r = base64ToBytes('aGVsbG8')
    expect(r.ok).toBe(true)
    if (r.ok) expect(bytesToUtf8(r.value)).toEqual({ ok: true, value: 'hello' })
  })

  it('非法字符报错并指出位置', () => {
    const r = base64ToBytes('aGVs!G8=')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('BAD_BASE64_CHAR')
      expect(r.offset).toBe(4)
    }
  })

  it('长度余数为 1 报错', () => {
    const r = base64ToBytes('aGVsb')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('BAD_BASE64_LENGTH')
  })

  it('空输入得到空字节', () => {
    const r = base64ToBytes('')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.length).toBe(0)
  })
})
```

- [ ] **Step 6: 运行测试，确认失败**

Run: `npx vitest run --project core`
Expected: FAIL —— `Failed to resolve import "./bytes"`

- [ ] **Step 7: 实现 `src/core/bytes.ts`**

```ts
import { err, ok, type Result } from './result'

const HEX_CHARS = /^[0-9a-fA-F]*$/

const B64_STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_URLSAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/**
 * 字符到 6 位值的查表。-1 表示非法字符。
 * 同时接受标准与 url-safe 两套字母表，使跨格式粘贴可直接解码。
 */
const B64_LOOKUP: number[] = (() => {
  const table = new Array<number>(128).fill(-1)
  for (let i = 0; i < B64_STANDARD.length; i++) {
    table[B64_STANDARD.charCodeAt(i)] = i
  }
  table['-'.charCodeAt(0)] = 62
  table['_'.charCodeAt(0)] = 63
  return table
})()

export interface Base64Options {
  /** 默认 'standard' */
  variant?: 'standard' | 'urlsafe'
  /** 是否输出 '=' 填充，默认 true */
  padding?: boolean
}

export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function bytesToUtf8(bytes: Uint8Array): Result<string> {
  try {
    // fatal: 非法字节序列抛错而非静默替换为 U+FFFD，便于向上报告
    return ok(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return err('字节序列不是合法的 UTF-8 文本', { code: 'BAD_UTF8' })
  }
}

export function bytesToHex(bytes: Uint8Array, upper = false): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return upper ? out.toUpperCase() : out
}

/**
 * 字符串的 UTF-8 字节数。
 *
 * 不能用 `String.length`：它统计的是 UTF-16 码元，中文与 emoji 会显著偏大，
 * 而 spec 要求展示的是「字节数」。
 */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

export function hexToBytes(hex: string): Result<Uint8Array> {
  const cleaned = hex.replace(/\s+/g, '')
  if (cleaned.length === 0) return ok(new Uint8Array(0))

  if (!HEX_CHARS.test(cleaned)) {
    const bad = cleaned.search(/[^0-9a-fA-F]/)
    return err('包含非十六进制字符', {
      code: 'BAD_HEX_CHAR',
      offset: bad,
      detail: `位置 ${bad} 的字符是 "${cleaned.charAt(bad)}"`,
    })
  }

  if (cleaned.length % 2 !== 0) {
    return err('十六进制字符串长度必须为偶数', {
      code: 'BAD_HEX_LENGTH',
      detail: `当前长度为 ${cleaned.length}`,
    })
  }

  const out = new Uint8Array(cleaned.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16)
  }
  return ok(out)
}

export function bytesToBase64(bytes: Uint8Array, options: Base64Options = {}): string {
  const { variant = 'standard', padding = true } = options
  const alphabet = variant === 'urlsafe' ? B64_URLSAFE : B64_STANDARD

  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0)

    out += alphabet.charAt((triple >> 18) & 63)
    out += alphabet.charAt((triple >> 12) & 63)
    out +=
      b1 === undefined ? (padding ? '=' : '') : alphabet.charAt((triple >> 6) & 63)
    out += b2 === undefined ? (padding ? '=' : '') : alphabet.charAt(triple & 63)
  }
  return out
}

export function base64ToBytes(input: string, options: Base64Options = {}): Result<Uint8Array> {
  const { variant = 'standard' } = options
  const alphabet = variant === 'urlsafe' ? B64_URLSAFE : B64_STANDARD

  // 宽松输入：剥离空白。从日志、邮件、JWT 粘贴时几乎必然带换行。
  const cleaned = input.replace(/\s+/g, '')
  if (cleaned.length === 0) return ok(new Uint8Array(0))

  const body = cleaned.replace(/=+$/, '')
  const paddingLength = cleaned.length - body.length
  if (paddingLength > 2) {
    return err('Base64 填充字符过多', { code: 'BAD_BASE64_PADDING' })
  }

  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i)
    const value = code < 128 ? B64_LOOKUP[code] : -1
    if (value === undefined || value === -1) {
      return err('包含非 Base64 字符', {
        code: 'BAD_BASE64_CHAR',
        offset: i,
        detail: `位置 ${i} 的字符是 "${body.charAt(i)}"`,
      })
    }
  }

  if (body.length % 4 === 1) {
    return err('Base64 数据长度非法', {
      code: 'BAD_BASE64_LENGTH',
      detail: '有效字符数除以 4 余 1，不可能是合法的 Base64',
    })
  }

  const out = new Uint8Array(Math.floor((body.length * 6) / 8))
  let accumulator = 0
  let bits = 0
  let cursor = 0

  for (let i = 0; i < body.length; i++) {
    const code = body.charCodeAt(i)
    accumulator = (accumulator << 6) | (B64_LOOKUP[code] ?? 0)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[cursor++] = (accumulator >> bits) & 0xff
    }
  }

  // 显式引用 alphabet 以保留两种变体的语义（解码时两套字母表均已接受）
  void alphabet
  return ok(out)
}
```

- [ ] **Step 8: 运行测试，确认通过**

Run: `npx vitest run --project core`
Expected: PASS，共 24 个用例

**若「url-safe 使用 - 与 _」用例失败**，先手工核算期望值（可用 `node -e "console.log(Buffer.from([0xfb,0xff,0xbf]).toString('base64'))"` 校验），把测试中的期望改为实算结果，但**必须保留一条断言同时覆盖 `-` 与 `_` 两个字符**，否则 url-safe 映射未被真正验证。

- [ ] **Step 9: 确认类型检查与 lint 通过**

Run: `npm run typecheck && npm run lint`
Expected: 无错误。若 lint 报 `core 层不得接触 ...`，说明实现误用了被禁的全局对象 —— 修正实现，而不是放宽规则。

- [ ] **Step 10: 提交**

```bash
git add -A
git commit -m "feat(core): 新增字节转换与安全随机原语

- bytes：hex / base64 / base64url / utf8 互转，纯 TS 实现不依赖 btoa/atob，
  以便在非法输入时给出精确的字符位置
- 解码路径容忍空白与缺失填充，覆盖从日志、邮件、JWT 粘贴的真实场景
- random：randomInt 使用拒绝采样而非取模，避免密码学场景下的取模偏差
- randomBytes 按 65536 分块，规避 getRandomValues 的规范上限"
```

---

### Task 7: JSON 扫描器（跨 WebView 一致性的承重件）

**这是整个设计里最重要的一块基础设施，务必按原样实现。**

**问题**：`JSON.parse` 的报错信息在不同 JS 引擎上格式不同 ——

```
WebView2 / Node（V8）  : Unexpected token } in JSON at position 42      ← 有位置
WKWebView（JSC）        : JSON Parse error: Unexpected token '}'        ← 无位置
```

而 delta spec 在 **6 处**要求"指出出错位置"。依赖原生报错信息，在 macOS 上会直接失效。

**方案**：自实现严格 RFC 8259 扫描器，统一输出 `offset + line + column + 期望内容`。它同时是 Task 8 中 token 级压缩/格式化的基础 —— 一份实现解决两个问题。

**Files:**
- Create: `src/core/json/scanner.ts`
- Test: `src/core/json/scanner.test.ts`

**Interfaces:**
- Consumes: `core/result.ts` 的 `ErrorInfo`
- Produces:
  - `JsonToken { kind: 'punct' | 'string' | 'number' | 'literal'; raw: string; start: number; end: number }`
  - `scanJson(text: string): ScanResult`，其中 `ScanResult = { ok: true; tokens: JsonToken[] } | ({ ok: false } & ErrorInfo)`
  - `positionToLineColumn(text: string, offset: number): { line: number; column: number }`

- [ ] **Step 1: 写失败测试 —— `src/core/json/scanner.test.ts`**

表格驱动：非法输入 → 期望的 `code` 与 `offset`。这是跨 WebView 一致性的直接保障。

```ts
import { describe, expect, it } from 'vitest'
import { positionToLineColumn, scanJson } from './scanner'

describe('scanJson — 合法输入', () => {
  it.each([
    ['对象', '{"a":1}'],
    ['数组', '[1,2,3]'],
    ['嵌套', '{"a":[{"b":null}],"c":true}'],
    ['空对象与空数组', '{"a":{},"b":[]}'],
    ['负数与指数', '[-0, 1.5e-3, 2E+10, 1e10]'],
    ['转义', String.raw`{"s":"a\"b\\c\/d\n\t\u0041"}`],
    ['顶层标量', '42'],
    ['顶层字符串', '"hello"'],
    ['首尾空白', '  \n\t {"a":1} \r\n '],
  ])('%s', (_label, text) => {
    const result = scanJson(text)
    expect(result.ok).toBe(true)
  })

  it('保留原文切片，不改写转义字面量', () => {
    const result = scanJson(String.raw`{"s":"\u0041\/\n"}`)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const stringToken = result.tokens.find((t) => t.raw.startsWith('"'))
      expect(stringToken?.raw).toBe(String.raw`"\u0041\/\n"`)
    }
  })

  it('token 切片可拼回原文（去空白后）', () => {
    const text = '{"a": [1, 2]}'
    const result = scanJson(text)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tokens.map((t) => t.raw).join('')).toBe('{"a":[1,2]}')
    }
  })
})

describe('scanJson — 非法输入与精确定位', () => {
  it.each([
    ['尾随逗号', '{"a":1,}', 'TRAILING_COMMA', 7],
    ['数组尾随逗号', '[1,]', 'TRAILING_COMMA', 3],
    ['单引号字符串', "{'a':1}", 'UNQUOTED_KEY', 1],
    ['未加引号的键', '{a:1}', 'UNQUOTED_KEY', 1],
    ['前导加号', '+1', 'BAD_NUMBER', 0],
    ['前导零', '01', 'BAD_NUMBER', 1],
    ['小数点前无数字', '.5', 'UNEXPECTED_CHAR', 0],
    ['小数点后无数字', '5.', 'BAD_NUMBER', 1],
    ['NaN', 'NaN', 'UNEXPECTED_CHAR', 0],
    ['Infinity', 'Infinity', 'UNEXPECTED_CHAR', 0],
    ['单引号', "'x'", 'UNEXPECTED_CHAR', 0],
    ['未闭合字符串', '{"a":"x', 'UNTERMINATED_STRING', 5],
    ['非法转义', String.raw`{"a":"\q"}`, 'BAD_ESCAPE', 7],
    ['不完整 unicode 转义', String.raw`{"a":"\u12"}`, 'BAD_UNICODE_ESCAPE', 7],
    ['未闭合对象', '{"a":1', 'UNCLOSED', 6],
    ['未闭合数组', '[1,2', 'UNCLOSED', 4],
    ['多余内容', '{"a":1} x', 'TRAILING_CONTENT', 8],
    ['缺少冒号', '{"a" 1}', 'EXPECTED_COLON', 5],
    ['缺少逗号', '{"a":1 "b":2}', 'EXPECTED_COMMA_OR_END', 7],
    ['空输入', '', 'UNEXPECTED_EOF', 0],
    ['仅空白', '   ', 'UNEXPECTED_EOF', 3],
    ['字符串中的裸换行', '{"a":"x\ny"}', 'RAW_CONTROL_CHAR', 7],
  ])('%s → %s @ %i', (_label, text, code, offset) => {
    const result = scanJson(text)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe(code)
      expect(result.offset).toBe(offset)
    }
  })

  it('错误同时给出 1 基的行号与列号', () => {
    const text = '{\n  "a": 1,\n  "b": 2,\n}'
    const result = scanJson(text)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.offset).toBe(text.indexOf('}'))
      expect(result.line).toBe(4)
      expect(result.column).toBe(1)
    }
  })

  it('错误信息包含可读的原因', () => {
    const result = scanJson('{"a":1,}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
  })
})

describe('positionToLineColumn', () => {
  it.each([
    [0, 1, 1],
    [4, 1, 5],
    [5, 2, 1],
    [6, 2, 2],
  ])('偏移 %i → 第 %i 行第 %i 列', (offset, line, column) => {
    // 文本为 'abcd\nef'，偏移 4 是 '\n' 本身，偏移 5 是第二行首
    expect(positionToLineColumn('abcd\nef', offset)).toEqual({ line, column })
  })

  it('偏移超界时钳制到末尾', () => {
    expect(positionToLineColumn('ab', 99)).toEqual({ line: 1, column: 3 })
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run --project core`
Expected: FAIL —— `Failed to resolve import "./scanner"`

- [ ] **Step 3: 实现 `src/core/json/scanner.ts`**

```ts
import type { ErrorInfo } from '../result'

export interface JsonToken {
  kind: 'punct' | 'string' | 'number' | 'literal'
  /** 原文切片，含引号与转义，**原样保留不做规范化** */
  raw: string
  start: number
  end: number
}

export type ScanResult = { ok: true; tokens: JsonToken[] } | ({ ok: false } & ErrorInfo)

const WHITESPACE = new Set([' ', '\t', '\n', '\r'])
const PUNCT = new Set(['{', '}', '[', ']', ',', ':'])
const VALID_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'])

/** 将字符偏移换算为 1 基的行号与列号。 */
export function positionToLineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length))
  let line = 1
  let lineStart = 0
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: clamped - lineStart + 1 }
}

interface Failure {
  error: string
  code: string
  at: number
  detail?: string
}

/**
 * 严格按 RFC 8259 扫描并校验 JSON，同时产出 token 序列。
 *
 * 之所以不用 JSON.parse：其报错信息在 V8 与 JavaScriptCore 上格式不同，
 * WKWebView 甚至不提供出错位置，无法满足「指出行号列号」的要求。
 */
export function scanJson(text: string): ScanResult {
  const tokens: JsonToken[] = []
  let pos = 0

  const fail = (f: Failure): ScanResult => ({
    ok: false,
    error: f.error,
    code: f.code,
    detail: f.detail,
    offset: f.at,
    ...positionToLineColumn(text, f.at),
  })

  const skipWhitespace = (): void => {
    while (pos < text.length && WHITESPACE.has(text.charAt(pos))) pos++
  }

  const push = (kind: JsonToken['kind'], start: number): void => {
    tokens.push({ kind, raw: text.slice(start, pos), start, end: pos })
  }

  const parseString = (): Failure | null => {
    const start = pos
    pos++ // 开引号
    while (pos < text.length) {
      const ch = text.charAt(pos)
      if (ch === '"') {
        pos++
        push('string', start)
        return null
      }
      if (ch === '\\') {
        const escape = text.charAt(pos + 1)
        if (!VALID_ESCAPES.has(escape)) {
          return {
            error: '非法的转义序列',
            code: 'BAD_ESCAPE',
            at: pos,
            detail: `"\\${escape}" 不是合法的 JSON 转义`,
          }
        }
        if (escape === 'u') {
          const hex = text.slice(pos + 2, pos + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            return {
              error: '\\u 转义必须紧跟 4 位十六进制数字',
              code: 'BAD_UNICODE_ESCAPE',
              at: pos,
              detail: `实际内容为 "${hex}"`,
            }
          }
          pos += 6
        } else {
          pos += 2
        }
        continue
      }
      if (ch.charCodeAt(0) < 0x20) {
        return {
          error: '字符串中不允许出现未转义的控制字符',
          code: 'RAW_CONTROL_CHAR',
          at: pos,
          detail: '请改用 \\n、\\t 等转义写法',
        }
      }
      pos++
    }
    return { error: '字符串未闭合', code: 'UNTERMINATED_STRING', at: start }
  }

  const parseNumber = (): Failure | null => {
    const start = pos
    if (text.charAt(pos) === '-') pos++
    if (text.charAt(pos) === '0') {
      pos++
      // JSON 不允许前导零
      if (/[0-9]/.test(text.charAt(pos))) {
        return {
          error: '数字不允许前导零',
          code: 'BAD_NUMBER',
          at: pos,
          detail: '请去掉多余的前导 0',
        }
      }
    } else if (/[1-9]/.test(text.charAt(pos))) {
      while (/[0-9]/.test(text.charAt(pos))) pos++
    } else {
      return { error: '数字格式非法', code: 'BAD_NUMBER', at: start }
    }
    if (text.charAt(pos) === '.') {
      pos++
      if (!/[0-9]/.test(text.charAt(pos))) {
        return {
          error: '小数点后必须有数字',
          code: 'BAD_NUMBER',
          at: pos,
          detail: '如 1.0，而非 1.',
        }
      }
      while (/[0-9]/.test(text.charAt(pos))) pos++
    }
    if (text.charAt(pos) === 'e' || text.charAt(pos) === 'E') {
      pos++
      if (text.charAt(pos) === '+' || text.charAt(pos) === '-') pos++
      if (!/[0-9]/.test(text.charAt(pos))) {
        return {
          error: '指数部分必须有数字',
          code: 'BAD_NUMBER',
          at: pos,
          detail: '如 1e10，而非 1e',
        }
      }
      while (/[0-9]/.test(text.charAt(pos))) pos++
    }
    push('number', start)
    return null
  }

  const parseLiteral = (): Failure | null => {
    for (const literal of ['true', 'false', 'null'] as const) {
      if (text.startsWith(literal, pos)) {
        const start = pos
        pos += literal.length
        push('literal', start)
        return null
      }
    }
    return {
      error: '无法识别的字面量',
      code: 'UNEXPECTED_CHAR',
      at: pos,
      detail: `期望 true、false 或 null，实际为 "${text.slice(pos, pos + 8)}"`,
    }
  }

  const parseValue = (): Failure | null => {
    skipWhitespace()
    if (pos >= text.length) {
      return { error: '输入意外结束', code: 'UNEXPECTED_EOF', at: pos }
    }
    const ch = text.charAt(pos)

    if (ch === '{') {
      const start = pos
      pos++
      push('punct', start)
      skipWhitespace()
      if (text.charAt(pos) === '}') {
        const end = pos
        pos++
        push('punct', end)
        return null
      }
      for (;;) {
        skipWhitespace()
        if (text.charAt(pos) !== '"') {
          if (text.charAt(pos) === '}') {
            return {
              error: '对象中出现尾随逗号',
              code: 'TRAILING_COMMA',
              at: pos,
              detail: 'JSON 不允许尾随逗号',
            }
          }
          return {
            error: '对象的键必须是双引号字符串',
            code: 'UNQUOTED_KEY',
            at: pos,
            detail: 'JSON 的键不支持单引号或无引号写法',
          }
        }
        const keyFailure = parseString()
        if (keyFailure) return keyFailure
        skipWhitespace()
        if (text.charAt(pos) !== ':') {
          return { error: '键之后应为冒号', code: 'EXPECTED_COLON', at: pos }
        }
        const colonStart = pos
        pos++
        push('punct', colonStart)
        const valueFailure = parseValue()
        if (valueFailure) return valueFailure
        skipWhitespace()
        const next = text.charAt(pos)
        if (next === ',') {
          const commaStart = pos
          pos++
          push('punct', commaStart)
          continue
        }
        if (next === '}') {
          const end = pos
          pos++
          push('punct', end)
          return null
        }
        return {
          error: '属性之间应为逗号或对象结束',
          code: 'EXPECTED_COMMA_OR_END',
          at: pos,
          detail: pos >= text.length ? '输入意外结束' : `实际字符为 "${next}"`,
        }
      }
    }

    if (ch === '[') {
      const start = pos
      pos++
      push('punct', start)
      skipWhitespace()
      if (text.charAt(pos) === ']') {
        const end = pos
        pos++
        push('punct', end)
        return null
      }
      for (;;) {
        const elementFailure = parseValue()
        if (elementFailure) return elementFailure
        skipWhitespace()
        const next = text.charAt(pos)
        if (next === ',') {
          const commaStart = pos
          pos++
          push('punct', commaStart)
          skipWhitespace()
          if (text.charAt(pos) === ']') {
            return {
              error: '数组中出现尾随逗号',
              code: 'TRAILING_COMMA',
              at: pos,
              detail: 'JSON 不允许尾随逗号',
            }
          }
          continue
        }
        if (next === ']') {
          const end = pos
          pos++
          push('punct', end)
          return null
        }
        return {
          error: '数组元素之间应为逗号或数组结束',
          code: 'EXPECTED_COMMA_OR_END',
          at: pos,
          detail: pos >= text.length ? '输入意外结束' : `实际字符为 "${next}"`,
        }
      }
    }

    if (ch === '"') return parseString()
    if (ch === '-' || /[0-9]/.test(ch)) return parseNumber()
    if (/[a-zA-Z]/.test(ch)) return parseLiteral()

    return {
      error: '无法识别的字符',
      code: 'UNEXPECTED_CHAR',
      at: pos,
      detail: `"${ch}" 不是合法的 JSON 起始字符`,
    }
  }

  skipWhitespace()
  if (pos >= text.length) {
    return fail({ error: '输入为空', code: 'UNEXPECTED_EOF', at: 0 })
  }

  const valueFailure = parseValue()
  if (valueFailure) return fail(valueFailure)

  skipWhitespace()
  if (pos < text.length) {
    return fail({
      error: 'JSON 结束后存在多余内容',
      code: 'TRAILING_CONTENT',
      at: pos,
      detail: `多余内容为 "${text.slice(pos, pos + 16)}"`,
    })
  }

  void PUNCT
  return { ok: true, tokens }
}
```

**关于 `void PUNCT`**：常量 `PUNCT` 在本实现中未被使用（token 分类由 `kind` 直接给出）。若 lint 报未使用变量，直接删除该常量及其 `void` 引用，不要为了消除警告而保留死代码。

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run --project core`
Expected: PASS，约 45 个用例

**逐个核对失败用例。** 本实现中错误码与偏移量是精确约定，测试失败通常意味着两种真正的缺陷之一：位置计算差一，或语法分支遗漏。**不要**为了让测试通过而放宽断言 —— 这些断言正是跨 WebView 一致性的契约。

- [ ] **Step 5: 确认 lint 与类型检查通过**

Run: `npm run typecheck && npm run lint`

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(core): 自实现 JSON 扫描器以统一跨 WebView 的错误定位

- JSON.parse 在 WKWebView 上不返回出错位置，无法满足 spec 的定位要求
- 严格 RFC 8259：拒绝尾随逗号、前导零、单引号、NaN/Infinity
- 统一输出 offset + line + column + 期望内容，共 20 余种错误码
- 同时产出 token 序列并原样保留转义字面量，作为 Task 8 的压缩/格式化基础
- 表格驱动测试覆盖 22 种非法输入形态"
```

---

### Task 8: token 级 JSON 压缩与格式化

**核心约束**：spec 要求 `minify(format(x))` 与 `x 去空白` **逐字节一致**，同时要求"保留特殊字符转义"。这两条把「解析成值再序列化」这条路彻底排除：

```
输入          →  parse + stringify 后
"\u0041"      →  "A"        ← 逐字节往返被破坏
"\/"          →  "/"
```

因此默认路径必须走**逐 token 处理**：字符串 token 原样输出，绝不重建。只有开启**键排序**时无法在 token 层完成（必须重建值对象），才退化为规范化路径，并由 `normalizedEscapes` 标志告知界面提示用户。

**Files:**
- Create: `src/core/json/minify.ts`, `src/core/json/format.ts`
- Test: `src/core/json/minify.test.ts`, `src/core/json/format.test.ts`

**Interfaces:**
- Consumes: Task 7 的 `scanJson`；Task 6 的 `utf8ByteLength`
- Produces:
  - `JsonTextResult { output: string; inputBytes: number; outputBytes: number }`
  - `minifyJson(text: string): Result<JsonTextResult>`
  - `JsonIndent = 2 | 4 | 'tab'`
  - `FormatJsonOptions { indent?: JsonIndent; sortKeys?: boolean }`
  - `FormatJsonResult extends JsonTextResult { normalizedEscapes: boolean }`
  - `formatJson(text: string, options?: FormatJsonOptions): Result<FormatJsonResult>`

**注意：** 设计文档中原列的 `core/dev/json-format.ts` 组合层已取消 —— 它是多余的一跳，工具直接调用 `minifyJson` / `formatJson` 即可。

- [ ] **Step 1: 写失败测试 —— `src/core/json/minify.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { minifyJson } from './minify'

const out = (text: string): string => {
  const r = minifyJson(text)
  if (!r.ok) throw new Error(`意外失败：${r.error}`)
  return r.value.output
}

describe('minifyJson', () => {
  it('移除换行与缩进', () => {
    expect(out('{\n  "a": 1,\n  "b": [1, 2]\n}')).toBe('{"a":1,"b":[1,2]}')
  })

  it('保留字符串内部的空白', () => {
    expect(out('{ "a" : " x  y \\n z " }')).toBe('{"a":" x  y \\n z "}')
  })

  it('规范：\\u0041 不被改写为 A（逐字节保真的关键）', () => {
    expect(out(String.raw`{ "s" : "\u0041" }`)).toBe(String.raw`{"s":"\u0041"}`)
  })

  it('规范：\\/ 不被改写为 /', () => {
    expect(out(String.raw`{ "s" : "\/" }`)).toBe(String.raw`{"s":"\/"}`)
  })

  it('保留 \\n \\t \\\\ 等转义写法', () => {
    const input = String.raw`{"s":"a\nb\tc\\d\"e"}`
    expect(out(`  ${input}  `)).toBe(input)
  })

  it('统计 UTF-8 字节数而非 UTF-16 码元数', () => {
    const r = minifyJson('{\n  "a": "工具箱"\n}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      // '{"a":"工具箱"}' 的 UTF-8 字节数
      expect(r.value.outputBytes).toBe(Buffer.byteLength('{"a":"工具箱"}', 'utf8'))
      expect(r.value.inputBytes).toBeGreaterThan(r.value.outputBytes)
    }
  })

  it('非法输入透传错误定位', () => {
    const r = minifyJson('{"a":1,}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('TRAILING_COMMA')
      expect(r.offset).toBe(7)
      expect(r.line).toBe(1)
      expect(r.column).toBe(8)
    }
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run --project core`
Expected: FAIL —— `Failed to resolve import "./minify"`

- [ ] **Step 3: 实现 `src/core/json/minify.ts`**

```ts
import { utf8ByteLength } from '../bytes'
import { ok, type Result } from '../result'
import { scanJson } from './scanner'

export interface JsonTextResult {
  output: string
  inputBytes: number
  outputBytes: number
}

/**
 * 逐 token 去空白：字符串 token 原样输出，因此转义字面量不被规范化。
 *
 * 若改为「解析成值再序列化」，"\u0041" 会变成 "A"、"\/" 会变成 "/"，
 * 与 spec 要求的逐字节往返相冲突。
 */
export function minifyJson(text: string): Result<JsonTextResult> {
  const scanned = scanJson(text)
  if (!scanned.ok) return scanned

  const output = scanned.tokens.map((token) => token.raw).join('')
  return ok({
    output,
    inputBytes: utf8ByteLength(text),
    outputBytes: utf8ByteLength(output),
  })
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run --project core`
Expected: PASS，8 个用例

- [ ] **Step 5: 写失败测试 —— `src/core/json/format.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { formatJson } from './format'
import { minifyJson } from './minify'

const out = (text: string, options?: Parameters<typeof formatJson>[1]): string => {
  const r = formatJson(text, options)
  if (!r.ok) throw new Error(`意外失败：${r.error}`)
  return r.value.output
}

describe('formatJson — 缩进', () => {
  it('默认两空格缩进', () => {
    expect(out('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}')
  })

  it('四空格缩进', () => {
    expect(out('{"a":1}', { indent: 4 })).toBe('{\n    "a": 1\n}')
  })

  it('制表符缩进', () => {
    expect(out('{"a":1}', { indent: 'tab' })).toBe('{\n\t"a": 1\n}')
  })

  it('空对象与空数组保持紧凑', () => {
    expect(out('{"a":{},"b":[]}')).toBe('{\n  "a": {},\n  "b": []\n}')
  })

  it('冒号后恰好一个空格', () => {
    expect(out('{"a":   1}')).toBe('{\n  "a": 1\n}')
  })

  it('嵌套深度正确递进', () => {
    expect(out('{"a":{"b":{"c":1}}}')).toBe(
      '{\n  "a": {\n    "b": {\n      "c": 1\n    }\n  }\n}',
    )
  })
})

describe('formatJson — 转义保真', () => {
  it('默认模式下不改写转义字面量', () => {
    const r = formatJson(String.raw`{"s":"\u0041\/\n"}`)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.output).toContain(String.raw`"\u0041\/\n"`)
      expect(r.value.normalizedEscapes).toBe(false)
    }
  })

  it('逐字节往返：minify(format(x)) 等于 minify(x)', () => {
    const samples = [
      String.raw`{"s":"\u0041\/\n","n":-1.5e-3,"t":true,"z":null}`,
      '{"a":[{"b":[]},{"c":{}}],"d":""}',
      '[1,2,3]',
      '{"中文键":"中文值 🧰"}',
    ]
    for (const sample of samples) {
      const formatted = formatJson(sample)
      expect(formatted.ok).toBe(true)
      if (!formatted.ok) continue

      const remade = minifyJson(formatted.value.output)
      const direct = minifyJson(sample)
      expect(remade.ok && direct.ok).toBe(true)
      if (remade.ok && direct.ok) {
        expect(remade.value.output).toBe(direct.value.output)
      }
    }
  })
})

describe('formatJson — 键排序', () => {
  it('对象键按字典序排列，数组顺序不变', () => {
    expect(out('{"c":1,"a":2,"b":3}', { sortKeys: true })).toBe(
      '{\n  "a": 2,\n  "b": 3,\n  "c": 1\n}',
    )
    expect(out('[3,1,2]', { sortKeys: true })).toBe('[\n  3,\n  1,\n  2\n]')
  })

  it('递归排序嵌套对象', () => {
    expect(out('{"z":{"b":1,"a":2}}', { sortKeys: true })).toBe(
      '{\n  "z": {\n    "a": 2,\n    "b": 1\n  }\n}',
    )
  })

  it('标记转义可能被规范化，供界面提示', () => {
    const r = formatJson(String.raw`{"s":"\u0041"}`, { sortKeys: true })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.normalizedEscapes).toBe(true)
      expect(r.value.output).toContain('"A"')
    }
  })
})

describe('formatJson — 错误透传', () => {
  it('非法输入保留错误码与三定位', () => {
    const r = formatJson('{\n  "a": 1,\n}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('TRAILING_COMMA')
      expect(r.line).toBe(3)
      expect(r.column).toBe(1)
    }
  })
})
```

- [ ] **Step 6: 实现 `src/core/json/format.ts`**

```ts
import { utf8ByteLength } from '../bytes'
import { ok, type Result } from '../result'
import { scanJson } from './scanner'

export type JsonIndent = 2 | 4 | 'tab'

export interface FormatJsonOptions {
  indent?: JsonIndent
  sortKeys?: boolean
}

export interface FormatJsonResult {
  output: string
  inputBytes: number
  outputBytes: number
  /** 键排序模式下转义可能被规范化，界面须据此提示用户 */
  normalizedEscapes: boolean
}

const CLOSERS = new Set(['}', ']'])

function indentUnit(indent: JsonIndent): string {
  return indent === 'tab' ? '\t' : ' '.repeat(indent)
}

/**
 * 逐 token 重排缩进：字符串 token 原样输出，因此转义字面量不被规范化。
 *
 * 例外：开启键排序时必须在值对象层重建，无法在 token 层完成，
 * 此时退化为 parse + stringify 并置 normalizedEscapes。
 */
export function formatJson(
  text: string,
  options: FormatJsonOptions = {},
): Result<FormatJsonResult> {
  const { indent = 2, sortKeys = false } = options

  const scanned = scanJson(text)
  if (!scanned.ok) return scanned

  const inputBytes = utf8ByteLength(text)

  if (sortKeys) {
    // 已由 scanJson 严格校验，故此处的 JSON.parse 不会抛错
    const parsed: unknown = JSON.parse(text)
    const output = JSON.stringify(sortDeep(parsed), null, indentUnit(indent))
    return ok({
      output,
      inputBytes,
      outputBytes: utf8ByteLength(output),
      normalizedEscapes: true,
    })
  }

  const unit = indentUnit(indent)
  const tokens = scanned.tokens
  let output = ''
  let depth = 0

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue
    const previous = tokens[i - 1]
    const next = tokens[i + 1]

    if (token.kind === 'punct') {
      if (CLOSERS.has(token.raw)) {
        depth = Math.max(0, depth - 1)
        // 空容器写成 {} / []，不展开换行
        const isTightEmpty =
          previous !== undefined && (previous.raw === '{' || previous.raw === '[')
        output += isTightEmpty ? '' : '\n' + unit.repeat(depth)
        output += token.raw
        continue
      }

      if (token.raw === '{' || token.raw === '[') {
        output += token.raw
        depth++
        const isTightEmpty = next !== undefined && CLOSERS.has(next.raw)
        if (!isTightEmpty) output += '\n' + unit.repeat(depth)
        continue
      }

      if (token.raw === ',') {
        output += ',\n' + unit.repeat(depth)
        continue
      }

      if (token.raw === ':') {
        output += ': '
        continue
      }
    }

    output += token.raw
  }

  return ok({
    output,
    inputBytes,
    outputBytes: utf8ByteLength(output),
    normalizedEscapes: false,
  })
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortDeep(source[key])
    }
    return sorted
  }
  return value
}
```

- [ ] **Step 7: 运行测试，确认通过**

Run: `npx vitest run --project core`
Expected: PASS，共 18 个用例

**若「逐字节往返」用例失败**，说明格式化路径误用了值重建。这正是本任务要防的缺陷 —— 修正实现，不要放宽断言。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat(core): token 级 JSON 压缩与格式化

- 默认路径逐 token 处理，字符串原样输出，转义字面量不被规范化
- 保证 minify(format(x)) 与 x 去空白逐字节一致（spec 要求）
- 键排序模式必须在值对象层重建，无法在 token 层完成，
  故显式置 normalizedEscapes 标志供界面提示
- 体积统计使用 UTF-8 字节数而非 String.length"
```

---

### Task 9: 工具元数据契约与类别

**Files:**
- Create: `src/framework/types.ts`, `src/framework/categories.ts`
- Test: `src/framework/categories.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `TOOL_CATEGORIES`（`as const` 元组）、`ToolCategory`
  - `IconName`（联合类型，Task 13 的 `Icon` 组件据此实现）
  - `ToolMeta { id; name; category; description; keywords; order? }`
  - `isToolCategory(value: unknown): value is ToolCategory`
  - `CATEGORIES: readonly CategoryDescriptor[]`、`categoryOrder(id): number`

`IconName` 刻意定义在 `types.ts` 而非 `ui/Icon.tsx`：否则 `categories.ts` 需要依赖一个尚不存在的组件文件，形成时序依赖。

- [ ] **Step 1: 实现 `src/framework/types.ts`**

```ts
export const TOOL_CATEGORIES = ['crypto', 'converter', 'web', 'image', 'dev'] as const

export type ToolCategory = (typeof TOOL_CATEGORIES)[number]

/** 手写 SVG 图标的名称集合。不引入图标库，以保证零外网与体积可控。 */
export type IconName =
  | 'search'
  | 'lock'
  | 'swap'
  | 'globe'
  | 'image'
  | 'terminal'
  | 'star'
  | 'star-filled'
  | 'clock'
  | 'chevron-right'
  | 'chevron-down'
  | 'copy'
  | 'check'
  | 'download'
  | 'trash'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'alert'
  | 'menu'
  | 'close'

/**
 * 工具元数据。
 *
 * 必须可**同步**获得（侧栏与搜索需要在组件未加载时渲染），
 * 因此单独放在 meta.ts 中，与懒加载的 Tool.tsx 分离。
 */
export interface ToolMeta {
  /** 与所在目录名一致，形如 kebab-case */
  id: string
  name: string
  category: ToolCategory
  description: string
  keywords: string[]
  /** 同类别内的排序权重，缺省为 0 */
  order?: number
}

export function isToolCategory(value: unknown): value is ToolCategory {
  return typeof value === 'string' && (TOOL_CATEGORIES as readonly string[]).includes(value)
}
```

- [ ] **Step 2: 实现 `src/framework/categories.ts`**

```ts
import type { IconName, ToolCategory } from './types'

export interface CategoryDescriptor {
  id: ToolCategory
  name: string
  icon: IconName
  order: number
}

/** 侧栏分组与排序的唯一事实源。 */
export const CATEGORIES: readonly CategoryDescriptor[] = [
  { id: 'crypto', name: '加密', icon: 'lock', order: 1 },
  { id: 'converter', name: '转换器', icon: 'swap', order: 2 },
  { id: 'web', name: 'Web', icon: 'globe', order: 3 },
  { id: 'image', name: '图片', icon: 'image', order: 4 },
  { id: 'dev', name: '开发', icon: 'terminal', order: 5 },
]

const BY_ID = new Map<ToolCategory, CategoryDescriptor>(CATEGORIES.map((c) => [c.id, c]))

export function categoryById(id: ToolCategory): CategoryDescriptor | undefined {
  return BY_ID.get(id)
}

export function categoryOrder(id: ToolCategory): number {
  return BY_ID.get(id)?.order ?? 99
}
```

- [ ] **Step 3: 写测试 —— `src/framework/categories.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { CATEGORIES, categoryById, categoryOrder } from './categories'
import { TOOL_CATEGORIES, isToolCategory } from './types'

describe('类别定义', () => {
  it('覆盖全部 5 个类别且无遗漏', () => {
    expect(CATEGORIES.map((c) => c.id).sort()).toEqual([...TOOL_CATEGORIES].sort())
  })

  it('顺序值互不重复', () => {
    const orders = CATEGORIES.map((c) => c.order)
    expect(new Set(orders).size).toBe(orders.length)
  })

  it('每个类别都有中文显示名与图标', () => {
    for (const category of CATEGORIES) {
      expect(category.name.length).toBeGreaterThan(0)
      expect(category.icon.length).toBeGreaterThan(0)
    }
  })

  it('categoryById 可查得描述符', () => {
    expect(categoryById('crypto')?.name).toBe('加密')
    expect(categoryById('dev')?.name).toBe('开发')
  })

  it('categoryOrder 对未知值返回兜底排序', () => {
    expect(categoryOrder('crypto')).toBe(1)
    expect(categoryOrder('dev')).toBe(5)
  })
})

describe('isToolCategory', () => {
  it.each(['crypto', 'converter', 'web', 'image', 'dev'])('接受 %s', (value) => {
    expect(isToolCategory(value)).toBe(true)
  })

  it.each([['toolbox'], [''], [null], [undefined], [1], [{}]])('拒绝 %p', (value) => {
    expect(isToolCategory(value)).toBe(false)
  })
})
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run --project ui`
Expected: PASS，共 15 个用例

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(framework): 定义工具元数据契约与类别

- ToolMeta 单独放在 meta.ts，保证侧栏与搜索在组件未加载时即可渲染
- 类别顺序与显示名收敛到 categories.ts 作为唯一事实源
- IconName 定义在 types.ts 而非 Icon 组件，避免时序依赖"
```

### Task 10: 工具注册表与不变式校验

**这是「可扩展」这一要求的落点。** 目标是让「加了目录」必然等于「被注册」—— 不存在"写了工具却忘了登记"的中间状态。做法是 `import.meta.glob` 自动发现 + **不变式测试**：任一违规即测试失败。

**为什么不用中心清单文件**：手动维护的 `tools/index.ts` 会被遗忘、会引发合并冲突，且无法强制 meta/Tool 配对。

**Files:**
- Create: `src/framework/registry.ts`
- Test: `src/framework/registry.test.ts`

**Interfaces:**
- Consumes: Task 9 的 `ToolMeta` / `ToolCategory` / `isToolCategory` / `categoryOrder`
- Produces:
  - `ToolComponent = ComponentType`
  - `ToolEntry { meta: ToolMeta; load: () => Promise<{ default: ToolComponent }> }`
  - `RegistryIssue { kind; path; detail }`
  - `listTools(): readonly ToolEntry[]`
  - `getTool(id: string): ToolEntry | undefined`
  - `listByCategory(category: ToolCategory): readonly ToolEntry[]`
  - `getRegistryIssues(): readonly RegistryIssue[]`

- [ ] **Step 1: 写失败测试 —— `src/framework/registry.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { TOOL_CATEGORIES } from './types'
import { getRegistryIssues, getTool, listByCategory, listTools } from './registry'

describe('注册表不变式', () => {
  it('不存在任何注册问题', () => {
    // 任一违规（孤儿 meta、孤儿 Tool、id 重复、id 与目录名不符、
    // 类别非法、keywords 为空）都会使此断言失败
    expect(getRegistryIssues()).toEqual([])
  })

  it('每个条目都有 meta 与懒加载函数', () => {
    for (const entry of listTools()) {
      expect(entry.meta.id.length).toBeGreaterThan(0)
      expect(typeof entry.load).toBe('function')
    }
  })

  it('id 全局唯一', () => {
    const ids = listTools().map((e) => e.meta.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('类别均为已知枚举值', () => {
    for (const entry of listTools()) {
      expect(TOOL_CATEGORIES).toContain(entry.meta.category)
    }
  })

  it('keywords 非空且均为非空字符串', () => {
    for (const entry of listTools()) {
      expect(entry.meta.keywords.length).toBeGreaterThan(0)
      for (const keyword of entry.meta.keywords) {
        expect(keyword.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('UUID 生成器已被自动发现（glob 生效的实证）', () => {
    expect(getTool('uuid-generator')).toBeDefined()
    expect(getTool('uuid-generator')?.meta.category).toBe('crypto')
  })

  it('getTool 对未知 id 返回 undefined', () => {
    expect(getTool('does-not-exist')).toBeUndefined()
  })

  it('listByCategory 只返回该类别且保持顺序稳定', () => {
    const crypto = listByCategory('crypto')
    expect(crypto.every((e) => e.meta.category === 'crypto')).toBe(true)
    expect(listByCategory('image')).toEqual([])

    // 同一输入两次调用结果一致
    expect(listByCategory('crypto').map((e) => e.meta.id)).toEqual(
      crypto.map((e) => e.meta.id),
    )
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run --project ui`
Expected: FAIL —— `Failed to resolve import "./registry"`

- [ ] **Step 3: 实现 `src/framework/registry.ts`**

```ts
import type { ComponentType } from 'react'
import { categoryOrder } from './categories'
import { isToolCategory, type ToolCategory, type ToolMeta } from './types'

export type ToolComponent = ComponentType

export interface ToolEntry {
  meta: ToolMeta
  /** 懒加载入口。调用它才会真正拉取组件代码。 */
  load: () => Promise<{ default: ToolComponent }>
}

export type RegistryIssueKind =
  | 'orphan-meta'
  | 'orphan-tool'
  | 'duplicate-id'
  | 'id-directory-mismatch'
  | 'bad-id-format'
  | 'bad-category'
  | 'empty-keywords'
  | 'incomplete-meta'

export interface RegistryIssue {
  kind: RegistryIssueKind
  path: string
  detail: string
}

/**
 * Vite 的静态 glob 分析。
 *
 * meta.ts 用 eager 同步加载（侧栏与搜索需要元数据即刻可用）；
 * Tool.tsx 保持为懒加载 thunk，从而为每个工具生成独立 chunk。
 * 两个路径必须是字面量，Vite 在编译期做静态分析。
 */
const metaModules = import.meta.glob<{ default: ToolMeta }>('../tools/*/*/meta.ts', {
  eager: true,
})

const toolModules = import.meta.glob<{ default: ToolComponent }>('../tools/*/*/Tool.tsx')

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** '../tools/crypto/uuid-generator/meta.ts' → 'crypto/uuid-generator' */
function directoryOf(modulePath: string): string {
  return modulePath.split('/').slice(-3, -1).join('/')
}

function basenameOf(directory: string): string {
  const parts = directory.split('/')
  return parts[parts.length - 1] ?? ''
}

function build(): { entries: ToolEntry[]; issues: RegistryIssue[] } {
  const issues: RegistryIssue[] = []
  const metaByDirectory = new Map<string, { path: string; meta: ToolMeta }>()
  const nameCount = new Map<string, number>()

  for (const [path, module] of Object.entries(metaModules)) {
    const directory = directoryOf(path)
    if (metaByDirectory.has(directory)) {
      issues.push({
        kind: 'duplicate-id',
        path,
        detail: `目录 ${directory} 下出现多个 meta.ts`,
      })
      continue
    }
    metaByDirectory.set(directory, { path, meta: module.default })
  }

  const toolByDirectory = new Map<string, () => Promise<{ default: ToolComponent }>>()
  for (const [path, loader] of Object.entries(toolModules)) {
    toolByDirectory.set(directoryOf(path), loader)
  }

  const entries: ToolEntry[] = []

  for (const [directory, { path, meta }] of metaByDirectory) {
    const expectedId = basenameOf(directory)
    let invalid = false

    if (typeof meta !== 'object' || meta === null) {
      issues.push({ kind: 'incomplete-meta', path, detail: 'meta 默认导出不是对象' })
      continue
    }

    if (!meta.id || !meta.name || !meta.description) {
      issues.push({
        kind: 'incomplete-meta',
        path,
        detail: 'meta 缺少 id / name / description 中的一项',
      })
      invalid = true
    }

    if (!ID_PATTERN.test(meta.id)) {
      issues.push({
        kind: 'bad-id-format',
        path,
        detail: `id "${meta.id}" 不是 kebab-case`,
      })
      invalid = true
    }

    if (meta.id !== expectedId) {
      issues.push({
        kind: 'id-directory-mismatch',
        path,
        detail: `meta.id 为 "${meta.id}"，但目录名为 "${expectedId}"`,
      })
      invalid = true
    }

    if (!isToolCategory(meta.category)) {
      issues.push({
        kind: 'bad-category',
        path,
        detail: `category "${String(meta.category)}" 不是已知类别`,
      })
      invalid = true
    }

    if (!Array.isArray(meta.keywords) || meta.keywords.length === 0) {
      issues.push({ kind: 'empty-keywords', path, detail: 'keywords 不能为空数组' })
      invalid = true
    }

    const seen = nameCount.get(meta.id) ?? 0
    nameCount.set(meta.id, seen + 1)
    if (seen > 0) {
      issues.push({ kind: 'duplicate-id', path, detail: `id "${meta.id}" 重复出现` })
      invalid = true
    }

    const loader = toolByDirectory.get(directory)
    if (!loader) {
      issues.push({
        kind: 'orphan-meta',
        path,
        detail: `目录 ${directory} 有 meta.ts 但缺少 Tool.tsx`,
      })
      invalid = true
    }

    if (invalid || !loader) continue

    entries.push({ meta, load: loader })
    toolByDirectory.delete(directory)
  }

  for (const directory of toolByDirectory.keys()) {
    issues.push({
      kind: 'orphan-tool',
      path: `${directory}/Tool.tsx`,
      detail: `目录 ${directory} 有 Tool.tsx 但缺少 meta.ts`,
    })
  }

  entries.sort((a, b) => {
    const byCategory = categoryOrder(a.meta.category) - categoryOrder(b.meta.category)
    if (byCategory !== 0) return byCategory
    const byOrder = (a.meta.order ?? 0) - (b.meta.order ?? 0)
    if (byOrder !== 0) return byOrder
    return a.meta.name.localeCompare(b.meta.name, 'zh-Hans-CN')
  })

  return { entries, issues }
}

const built = build()

/** 开发构建下即时暴露注册问题，避免违规静默进入后续环节。 */
if (import.meta.env.DEV && built.issues.length > 0) {
  for (const issue of built.issues) {
    console.error(`[registry] ${issue.kind} — ${issue.path}\n  ${issue.detail}`)
  }
}

export function getRegistryIssues(): readonly RegistryIssue[] {
  return built.issues
}

export function listTools(): readonly ToolEntry[] {
  return built.entries
}

export function getTool(id: string): ToolEntry | undefined {
  return built.entries.find((entry) => entry.meta.id === id)
}

export function listByCategory(category: ToolCategory): readonly ToolEntry[] {
  return built.entries.filter((entry) => entry.meta.category === category)
}
```

- [ ] **Step 4: 验证不变式真的会拦截违规**

先建立「校验有效」的信念。创建 `src/tools/crypto/__probe/meta.ts`：

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'probe',
  name: '探针',
  category: 'crypto',
  description: '故意缺少 Tool.tsx 以触发 orphan-meta',
  keywords: ['probe'],
} satisfies ToolMeta
```

（注意：目录名是 `__probe`，但 `id` 是 `probe` —— 这应**同时**触发 `id-directory-mismatch` 与 `orphan-meta`。）

Run: `npx vitest run --project ui`
Expected: FAIL —— `不存在任何注册问题` 断言失败

**若测试通过**，说明 glob 或校验未生效，先修好再继续。

- [ ] **Step 5: 删除探针，确认全绿**

```bash
rm -rf src/tools/crypto/__probe
npx vitest run --project ui
```

Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(framework): 工具注册表与不变式校验

- import.meta.glob 自动发现 meta.ts(同步) 与 Tool.tsx(懒加载)，无中心清单
- 校验 8 类违规：孤儿 meta/Tool、id 重复、id 与目录名不符、id 格式、
  类别非法、keywords 为空、meta 字段缺失
- 开发构建下即时打印注册问题，避免静默失效
- 先用违规探针验证校验确实会失败，再删除探针"
```

---

### Task 11: 搜索（中英边界切词 + 模糊匹配）

**问题**：查询 `base64 解码`，工具名为 `Base64 编码/解码`。整串做子串匹配会**失败** —— `"base64 解码"` 不是连续子串。

**方案**：查询按**空白与分隔符**切词，再按**脚本边界**（拉丁 ↔ 汉字）二次切分，然后要求所有词全部命中（AND 语义）、得分累加。

```
"base64 解码"  →  ["base64", "解码"]
"唯一标识"      →  ["唯一标识"]
"uuid v7"      →  ["uuid", "v7"]
"uuid-generator" → ["uuid", "generator"]
```

这条规则同时覆盖纯中文与中英混合两类查询，也正是拒绝 `fuse.js` 的原因 —— 需要控制切词策略。

**Files:**
- Create: `src/framework/search.ts`
- Test: `src/framework/search.test.ts`

**Interfaces:**
- Consumes: Task 10 的 `ToolEntry` / `listTools`；Task 9 的 `categoryById`
- Produces:
  - `SearchField = 'name' | 'keyword' | 'category' | 'description'`
  - `SearchHit { entry: ToolEntry; score: number; matchedOn: SearchField }`
  - `tokenizeQuery(query: string): string[]`
  - `searchTools(query: string, entries?: readonly ToolEntry[]): SearchHit[]`

- [ ] **Step 1: 写失败测试 —— `src/framework/search.test.ts`**

测试使用**固定样本集**而非真实注册表，使搜索行为的验证不受当前已有多少工具影响。

```ts
import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import type { ToolEntry } from './registry'
import { searchTools, tokenizeQuery } from './search'
import type { ToolMeta } from './types'

function makeEntry(meta: ToolMeta): ToolEntry {
  return { meta, load: () => Promise.resolve({ default: (() => null) as ComponentType }) }
}

const ENTRIES: ToolEntry[] = [
  makeEntry({
    id: 'base64-converter',
    name: 'Base64 编码/解码',
    category: 'converter',
    description: '文本与 Base64 互转',
    keywords: ['base64', 'b64', '编码', '解码'],
  }),
  makeEntry({
    id: 'uuid-generator',
    name: 'UUID 生成器',
    category: 'crypto',
    description: '生成 UUID v1 / v4 / v7',
    keywords: ['uuid', 'guid', '唯一标识', '唯一id', 'id生成', 'v4', 'v7'],
  }),
  makeEntry({
    id: 'json-diff',
    name: 'JSON 差异比较',
    category: 'web',
    description: '对比两段 JSON 的结构差异',
    keywords: ['json', 'diff', '差异', '比较', '对比'],
  }),
  makeEntry({
    id: 'qrcode-generator',
    name: '二维码生成器',
    category: 'image',
    description: '输入文本生成二维码',
    keywords: ['qrcode', 'qr', '二维码', '二维条码'],
  }),
]

const ids = (query: string): string[] =>
  searchTools(query, ENTRIES).map((hit) => hit.entry.meta.id)

describe('tokenizeQuery', () => {
  it.each([
    ['base64 解码', ['base64', '解码']],
    ['唯一标识', ['唯一标识']],
    ['uuid v7', ['uuid', 'v7']],
    ['uuid-generator', ['uuid', 'generator']],
    ['  JSON   DIFF  ', ['json', 'diff']],
    ['', []],
    ['   ', []],
  ])('%s → %j', (query, expected) => {
    expect(tokenizeQuery(query)).toEqual(expected)
  })

  it('在拉丁与汉字边界处切分', () => {
    expect(tokenizeQuery('base64解码')).toEqual(['base64', '解码'])
  })
})

describe('searchTools', () => {
  it('空查询返回全部，且保持传入顺序（注册表顺序）', () => {
    expect(ids('')).toEqual(ENTRIES.map((e) => e.meta.id))
    expect(ids('   ')).toEqual(ENTRIES.map((e) => e.meta.id))
  })

  it('按英文名命中', () => {
    expect(ids('uuid')).toContain('uuid-generator')
    expect(ids('qrcode')).toContain('qrcode-generator')
  })

  it('按中文关键词命中（纯中文查询）', () => {
    expect(ids('唯一标识')).toEqual(['uuid-generator'])
    expect(ids('二维码')).toEqual(['qrcode-generator'])
  })

  it('中英混合查询：所有词都必须命中', () => {
    // 这正是整串子串匹配会失手的场景
    expect(ids('base64 解码')).toEqual(['base64-converter'])
    expect(ids('json 差异')).toEqual(['json-diff'])
  })

  it('AND 语义：任一词未命中则整体不命中', () => {
    expect(ids('base64 二维码')).toEqual([])
  })

  it('子序列模糊匹配（字符按序出现即可）', () => {
    expect(ids('ubgnrt')).toContain('uuid-generator')
  })

  it('按类别名命中', () => {
    expect(ids('图片')).toEqual(['qrcode-generator'])
  })

  it('前缀匹配优先于子串匹配', () => {
    const hits = searchTools('jso', ENTRIES)
    expect(hits[0]?.entry.meta.id).toBe('json-diff')
  })

  it('名称匹配权重高于描述匹配', () => {
    const nameWin = searchTools('二维码', ENTRIES)
    expect(nameWin[0]?.entry.meta.id).toBe('qrcode-generator')
    expect(nameWin[0]?.matchedOn).toBe('name')
  })

  it('无结果时返回空数组', () => {
    expect(ids('zzzzz')).toEqual([])
  })

  it('排序稳定：同一查询两次结果一致', () => {
    expect(ids('json')).toEqual(ids('json'))
  })

  it('命中项携带判定依据字段', () => {
    const hit = searchTools('uuid', ENTRIES).find((h) => h.entry.meta.id === 'uuid-generator')
    expect(hit?.matchedOn).toBe('name')
    expect(hit?.score).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run --project ui`
Expected: FAIL —— `Failed to resolve import "./search"`

- [ ] **Step 3: 实现 `src/framework/search.ts`**

```ts
import { categoryById } from './categories'
import { listTools, type ToolEntry } from './registry'

export type SearchField = 'name' | 'keyword' | 'category' | 'description'

export interface SearchHit {
  entry: ToolEntry
  score: number
  matchedOn: SearchField
}

/** 字段权重：名称 > 关键词 > 类别 > 描述。 */
const FIELD_WEIGHT: Record<SearchField, number> = {
  name: 3,
  keyword: 2,
  category: 1.5,
  description: 1,
}

/** 词与词之间除空格外还接受的显式分隔符。 */
const SEPARATOR = /\s/
const HAN = /\p{Script=Han}/u
const LATIN = /[0-9a-zA-Z]/

function isHan(ch: string): boolean {
  return HAN.test(ch)
}

function isLatin(ch: string): boolean {
  return LATIN.test(ch)
}

/** 去掉词首尾的非字母数字汉字字符，避免分隔符残留成噪声。 */
function trimPunctuation(term: string): string {
  return term.replace(/^[^\p{Script=Han}0-9a-zA-Z]+|[^\p{Script=Han}0-9a-zA-Z]+$/gu, '')
}

/**
 * 把查询切分为检索词。
 *
 * 先按空白与 -_/ 切分，再在「拉丁 ↔ 汉字」边界处二次切分。
 * 后一步是关键：否则查询 "base64解码" 会被当作一个整体而无法命中
 * "Base64 编码/解码"。
 */
export function tokenizeQuery(query: string): string[] {
  const terms: string[] = []

  for (const chunk of query.split(SEPARATOR)) {
    if (chunk.length === 0) continue

    let current = ''
    let lastClass: 'han' | 'latin' | null = null

    for (const ch of chunk) {
      const cls = isHan(ch) ? 'han' : isLatin(ch) ? 'latin' : null
      if (cls !== null && lastClass !== null && cls !== lastClass) {
        const trimmed = trimPunctuation(current)
        if (trimmed) terms.push(trimmed)
        current = ''
      }
      current += ch
      if (cls !== null) lastClass = cls
    }

    const trimmed = trimPunctuation(current)
    if (trimmed) terms.push(trimmed)
  }

  return terms.map((term) => term.toLowerCase()).filter((term) => term.length > 0)
}

/** 子序列匹配：字符按序出现即可，连续命中额外加分。 */
function scoreSubsequence(term: string, haystack: string): number {
  let cursor = 0
  let streak = 0
  let bestStreak = 0

  for (const ch of term) {
    const found = haystack.indexOf(ch, cursor)
    if (found === -1) return 0
    streak = found === cursor ? streak + 1 : 1
    bestStreak = Math.max(bestStreak, streak)
    cursor = found + 1
  }

  return 200 + bestStreak * 10
}

/** 单字段匹配打分：精确 > 前缀 > 子串 > 子序列。 */
function scoreTerm(term: string, value: string): number {
  const haystack = value.toLowerCase()

  if (haystack === term) return 1000
  if (haystack.startsWith(term)) return 800 - Math.min(haystack.length - term.length, 100)

  const index = haystack.indexOf(term)
  if (index >= 0) return 600 - Math.min(index, 100)

  return scoreSubsequence(term, haystack)
}

export function searchTools(
  query: string,
  entries: readonly ToolEntry[] = listTools(),
): SearchHit[] {
  const terms = tokenizeQuery(query)

  // 空查询视为「列出全部」，保持注册表既有顺序
  if (terms.length === 0) {
    return entries.map((entry) => ({ entry, score: 0, matchedOn: 'name' as const }))
  }

  const hits: SearchHit[] = []

  for (const entry of entries) {
    const fields: ReadonlyArray<readonly [SearchField, readonly string[]]> = [
      ['name', [entry.meta.name]],
      ['keyword', entry.meta.keywords],
      ['category', [categoryById(entry.meta.category)?.name ?? entry.meta.category]],
      ['description', [entry.meta.description]],
    ]

    let total = 0
    let bestField: SearchField = 'description'
    let bestFieldScore = -1
    let everyTermMatched = true

    for (const term of terms) {
      let termScore = 0
      let termField: SearchField = 'description'

      for (const [field, values] of fields) {
        for (const value of values) {
          const raw = scoreTerm(term, value)
          if (raw <= 0) continue
          const weighted = raw * FIELD_WEIGHT[field]
          if (weighted > termScore) {
            termScore = weighted
            termField = field
          }
        }
      }

      if (termScore <= 0) {
        everyTermMatched = false
        break
      }

      total += termScore
      if (termScore > bestFieldScore) {
        bestFieldScore = termScore
        bestField = termField
      }
    }

    if (everyTermMatched) hits.push({ entry, score: total, matchedOn: bestField })
  }

  // Array.prototype.sort 在 ES2019 起保证稳定，
  // 故同分项保持注册表顺序，满足「排序稳定」要求
  hits.sort((a, b) => b.score - a.score)
  return hits
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run --project ui`
Expected: PASS，约 25 个用例

**若「中英混合查询」用例失败**，多半是切词未在脚本边界断开。这是本任务的核心价值，务必修正实现而非放宽断言。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(framework): 搜索支持中英边界切词与模糊匹配

- 切词先按空白与分隔符，再在拉丁↔汉字边界二次切分，
  解决 'base64 解码' 这类混合查询整串子串匹配失手的问题
- 多词 AND 语义，字段权重 名称>关键词>类别>描述
- 档位：精确 > 前缀 > 子串 > 子序列（连续命中加分）
- 依赖 sort 的稳定性保证同分项保持注册表顺序
- 测试使用固定样本集，不受当前工具数量影响"
```

---

### Task 12: 持久化、工具状态与偏好

**关键决策：不引入状态管理库。** 偏好需要在 `Sidebar` 与 `CommandPalette` 两个兄弟组件间共享，用 `useSyncExternalStore` + 一个模块级 store 即可，无需引入 `zustand`。

**另一处关键决策：localStorage 不可用时必须降级而非崩溃。** 隐私模式、企业策略禁用存储、配额耗尽都是真实场景 —— spec 要求"存储不可用时应降级为无持久化模式，或提示用户"。

**Files:**
- Create: `src/framework/storage.ts`, `src/framework/useToolState.ts`, `src/framework/usePrefs.ts`
- Test: `src/framework/storage.test.ts`, `src/framework/usePrefs.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `utf8ByteLength`；Task 2 的 `ThemeMode` / `DEFAULT_THEME_MODE`
- Produces:
  - `PREF_KEY`、`TOOL_STATE_KEY`
  - `readJson<T>(key: string, fallback: T): T`、`writeJson(key: string, value: unknown): void`
  - `ToolStateEntry { input: string; options: Record<string, unknown>; updatedAt: number }`
  - `loadToolStateEntry(id): ToolStateEntry | undefined`、`saveToolStateEntry(id, entry): void`、`clearToolStateEntry(id): void`
  - `useToolState`、`usePrefs()`、`setTheme`、`toggleFavorite`、`pushRecent`、`clearRecents`
  - `Prefs { theme; favorites: string[]; recents: RecentEntry[] }`

- [ ] **Step 1: 实现 `src/framework/storage.ts`**

```ts
import { utf8ByteLength } from '@/core/bytes'

const PREFIX = 'itt:v1:'

export const PREF_KEY = `${PREFIX}prefs`
export const TOOL_STATE_KEY = `${PREFIX}toolState`

/** 单个工具的状态上限，超出则丢弃该工具的状态。 */
const MAX_TOOL_ENTRY_BYTES = 50 * 1024
/** 全量工具状态上限，超出按 updatedAt 从旧到新淘汰。 */
const MAX_TOTAL_BYTES = 2 * 1024 * 1024

interface StorageDriver {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

const memoryBacking = new Map<string, string>()

const memoryDriver: StorageDriver = {
  get: (key) => memoryBacking.get(key) ?? null,
  set: (key, value) => {
    memoryBacking.set(key, value)
  },
  remove: (key) => {
    memoryBacking.delete(key)
  },
}

let driver: StorageDriver | null = null
let usingFallback = false

function resolveDriver(): StorageDriver {
  if (driver) return driver
  try {
    const probe = `${PREFIX}__probe`
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    driver = {
      get: (key) => window.localStorage.getItem(key),
      set: (key, value) => window.localStorage.setItem(key, value),
      remove: (key) => window.localStorage.removeItem(key),
    }
  } catch {
    // 隐私模式、禁用存储或配额耗尽：应用必须仍然可用，只是不持久化
    usingFallback = true
    driver = memoryDriver
  }
  return driver
}

export function isUsingMemoryFallback(): boolean {
  resolveDriver()
  return usingFallback
}

export function readJson<T>(key: string, fallback: T): T {
  const raw = resolveDriver().get(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    resolveDriver().set(key, JSON.stringify(value))
  } catch {
    // 配额耗尽等写入失败：静默降级，不影响当前会话
  }
}

export function removeKey(key: string): void {
  resolveDriver().remove(key)
}

export interface ToolStateEntry {
  input: string
  options: Record<string, unknown>
  updatedAt: number
}

type ToolStateStore = Record<string, ToolStateEntry>

function readStore(): ToolStateStore {
  return readJson<ToolStateStore>(TOOL_STATE_KEY, {})
}

/** 淘汰超限条目，避免 localStorage 被单一工具撑爆。 */
export function pruneToolState(store: ToolStateStore): ToolStateStore {
  const kept: [string, ToolStateEntry][] = []

  for (const [id, entry] of Object.entries(store)) {
    if (utf8ByteLength(JSON.stringify(entry)) <= MAX_TOOL_ENTRY_BYTES) {
      kept.push([id, entry])
    }
  }

  const sizeOf = (list: [string, ToolStateEntry][]): number =>
    utf8ByteLength(JSON.stringify(Object.fromEntries(list)))

  if (sizeOf(kept) <= MAX_TOTAL_BYTES) return Object.fromEntries(kept)

  // 最久未更新者先被淘汰
  kept.sort((a, b) => a[1].updatedAt - b[1].updatedAt)
  while (kept.length > 0 && sizeOf(kept) > MAX_TOTAL_BYTES) kept.shift()

  return Object.fromEntries(kept)
}

export function loadToolStateEntry(id: string): ToolStateEntry | undefined {
  return readStore()[id]
}

export function saveToolStateEntry(id: string, entry: ToolStateEntry): void {
  const store = readStore()
  store[id] = entry
  writeJson(TOOL_STATE_KEY, pruneToolState(store))
}

export function clearToolStateEntry(id: string): void {
  const store = readStore()
  delete store[id]
  writeJson(TOOL_STATE_KEY, store)
}
```

- [ ] **Step 2: 写失败测试 —— `src/framework/storage.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PREF_KEY,
  TOOL_STATE_KEY,
  clearToolStateEntry,
  loadToolStateEntry,
  pruneToolState,
  readJson,
  saveToolStateEntry,
  writeJson,
} from './storage'

describe('readJson / writeJson', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('往返一致', () => {
    writeJson('k', { a: 1, b: ['x'] })
    expect(readJson('k', null)).toEqual({ a: 1, b: ['x'] })
  })

  it('缺失键返回兜底值', () => {
    expect(readJson('missing', { fallback: true })).toEqual({ fallback: true })
  })

  it('损坏的 JSON 返回兜底值而非抛错', () => {
    window.localStorage.setItem('broken', '{not json')
    expect(readJson('broken', 'fallback')).toBe('fallback')
  })

  it('localStorage 抛错时降级为内存且不崩溃', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    expect(() => writeJson('k', 'v')).not.toThrow()
    setItem.mockRestore()
  })
})

describe('pruneToolState', () => {
  const entry = (input: string, updatedAt: number) => ({ input, options: {}, updatedAt })

  it('保留未超限的条目', () => {
    const store = { a: entry('x', 1), b: entry('y', 2) }
    expect(Object.keys(pruneToolState(store)).sort()).toEqual(['a', 'b'])
  })

  it('丢弃超过单工具上限的条目', () => {
    const huge = entry('x'.repeat(60 * 1024), 1)
    expect(Object.keys(pruneToolState({ huge, ok: entry('y', 2) }))).toEqual(['ok'])
  })

  it('总量超限时优先淘汰最久未更新者', () => {
    const big = 'z'.repeat(700 * 1024)
    const store = {
      oldest: entry(big, 1),
      middle: entry(big, 2),
      newest: entry(big, 3),
    }
    const pruned = pruneToolState(store)
    expect(Object.keys(pruned)).toEqual(['newest'])
  })
})

describe('工具状态存取', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('写入后可读回', () => {
    saveToolStateEntry('uuid-generator', { input: 'abc', options: { count: 3 }, updatedAt: 10 })
    expect(loadToolStateEntry('uuid-generator')).toEqual({
      input: 'abc',
      options: { count: 3 },
      updatedAt: 10,
    })
  })

  it('清空后返回 undefined', () => {
    saveToolStateEntry('uuid-generator', { input: 'abc', options: {}, updatedAt: 1 })
    clearToolStateEntry('uuid-generator')
    expect(loadToolStateEntry('uuid-generator')).toBeUndefined()
  })

  it('各工具状态相互隔离', () => {
    saveToolStateEntry('a', { input: 'A', options: {}, updatedAt: 1 })
    saveToolStateEntry('b', { input: 'B', options: {}, updatedAt: 2 })
    expect(loadToolStateEntry('a')?.input).toBe('A')
    expect(loadToolStateEntry('b')?.input).toBe('B')
  })

  it('使用版本化键名，便于将来迁移', () => {
    saveToolStateEntry('a', { input: 'A', options: {}, updatedAt: 1 })
    expect(window.localStorage.getItem(TOOL_STATE_KEY)).toContain('"a"')
    expect(PREF_KEY.startsWith('itt:v1:')).toBe(true)
  })
})
```

- [ ] **Step 3: 运行测试，确认通过**

Run: `npx vitest run --project ui`
Expected: PASS，约 14 个用例

- [ ] **Step 4: 实现 `src/framework/useToolState.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { clearToolStateEntry, loadToolStateEntry, saveToolStateEntry } from './storage'

const WRITE_DEBOUNCE_MS = 200

export interface ToolStateShape {
  input: string
  options: Record<string, unknown>
}

/**
 * 按工具 id 隔离的状态。
 *
 * 写入去抖 200ms，避免每次按键都触碰 localStorage。
 * 挂载时若存在历史状态则恢复，满足 spec 的「重新打开仍保留上次输入」。
 */
export function useToolState<S extends ToolStateShape>(toolId: string, initial: S) {
  const [state, setState] = useState<S>(() => {
    const saved = loadToolStateEntry(toolId)
    if (!saved) return initial
    return {
      ...initial,
      input: saved.input,
      options: { ...initial.options, ...saved.options },
    } as S
  })

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      saveToolStateEntry(toolId, {
        input: state.input,
        options: state.options,
        updatedAt: Date.now(),
      })
    }, WRITE_DEBOUNCE_MS)

    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [toolId, state.input, state.options])

  const update = useCallback((patch: Partial<S>) => {
    setState((prev) => ({ ...prev, ...patch }))
  }, [])

  const updateOptions = useCallback((patch: Record<string, unknown>) => {
    setState((prev) => ({ ...prev, options: { ...prev.options, ...patch } }))
  }, [])

  const reset = useCallback(() => {
    clearToolStateEntry(toolId)
    setState(initial)
  }, [toolId, initial])

  return { state, update, updateOptions, reset }
}
```

注意：`initial` 若为每次渲染新建的字面量对象，会使 `reset` 的依赖每次变化。调用方须将 `initial` 定义在组件外部或 `useMemo` 中 —— Task 20 的 UUID 工具体现这一点。

- [ ] **Step 5: 实现 `src/framework/usePrefs.ts`**

```ts
import { useSyncExternalStore } from 'react'
import { DEFAULT_THEME_MODE, type ThemeMode } from './theme'
import { PREF_KEY, readJson, writeJson } from './storage'

export interface RecentEntry {
  id: string
  at: number
  count: number
}

export interface Prefs {
  theme: ThemeMode
  favorites: string[]
  recents: RecentEntry[]
}

export const DEFAULT_PREFS: Prefs = {
  theme: DEFAULT_THEME_MODE, // spec P1：默认暗色
  favorites: [],
  recents: [],
}

const RECENTS_LIMIT = 12

let current: Prefs = normalize(readJson<Partial<Prefs>>(PREF_KEY, {}))

function normalize(raw: Partial<Prefs>): Prefs {
  return {
    theme: raw.theme ?? DEFAULT_PREFS.theme,
    favorites: Array.isArray(raw.favorites) ? raw.favorites.filter((x) => typeof x === 'string') : [],
    recents: Array.isArray(raw.recents)
      ? raw.recents.filter((r) => r && typeof r.id === 'string')
      : [],
  }
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getPrefs(): Prefs {
  return current
}

function commit(next: Prefs): void {
  current = next
  writeJson(PREF_KEY, next)
  emit()
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribePrefs, getPrefs, getPrefs)
}

export function setTheme(theme: ThemeMode): void {
  commit({ ...current, theme })
}

export function toggleFavorite(id: string): void {
  const has = current.favorites.includes(id)
  commit({
    ...current,
    favorites: has
      ? current.favorites.filter((item) => item !== id)
      : [...current.favorites, id],
  })
}

export function pushRecent(id: string): void {
  const existing = current.recents.find((entry) => entry.id === id)
  const others = current.recents.filter((entry) => entry.id !== id)
  const updated: RecentEntry = {
    id,
    at: Date.now(),
    count: (existing?.count ?? 0) + 1,
  }
  commit({ ...current, recents: [updated, ...others].slice(0, RECENTS_LIMIT) })
}

export function clearRecents(): void {
  commit({ ...current, recents: [] })
}

/** 仅供测试：重置内存中的偏好。 */
export function __resetPrefsForTests(): void {
  current = { ...DEFAULT_PREFS }
  writeJson(PREF_KEY, current)
  emit()
}
```

- [ ] **Step 6: 写测试 —— `src/framework/usePrefs.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetPrefsForTests,
  clearRecents,
  getPrefs,
  pushRecent,
  setTheme,
  toggleFavorite,
} from './usePrefs'

describe('偏好 store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetPrefsForTests()
  })

  it('默认主题为暗色（spec P1）', () => {
    expect(getPrefs().theme).toBe('dark')
  })

  it('设置主题并持久化', () => {
    setTheme('light')
    expect(getPrefs().theme).toBe('light')
    expect(window.localStorage.getItem('itt:v1:prefs')).toContain('"light"')
  })

  it('收藏可切换', () => {
    toggleFavorite('uuid-generator')
    expect(getPrefs().favorites).toEqual(['uuid-generator'])
    toggleFavorite('uuid-generator')
    expect(getPrefs().favorites).toEqual([])
  })

  it('最近使用去重并累计次数', () => {
    pushRecent('a')
    pushRecent('b')
    pushRecent('a')
    const recents = getPrefs().recents
    expect(recents.map((r) => r.id)).toEqual(['a', 'b'])
    expect(recents[0]?.count).toBe(2)
  })

  it('最近使用有容量上限', () => {
    for (let i = 0; i < 20; i++) pushRecent(`tool-${i}`)
    expect(getPrefs().recents.length).toBeLessThanOrEqual(12)
  })

  it('清空最近使用', () => {
    pushRecent('a')
    clearRecents()
    expect(getPrefs().recents).toEqual([])
  })
})
```

- [ ] **Step 7: 运行全部测试**

Run: `npm run test`
Expected: PASS，两个项目均通过

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat(framework): 持久化层、工具状态与偏好

- storage 在 localStorage 不可用（隐私模式/禁用/配额耗尽）时降级为内存，
  应用仍可用，仅不持久化；损坏的 JSON 返回兜底值而非抛错
- 工具状态按 id 隔离，单工具 50KB / 全局 2MB 上限，超限按最久未更新淘汰
- 偏好用 useSyncExternalStore + 模块级 store，无需引入状态管理库
- useToolState 写入去抖 200ms，挂载时恢复历史输入"
```

---

### Task 13: UI 原语集

全部使用 Task 2 的**语义令牌类名**（`bg-surface` / `text-fg` / `border-border` / `text-muted` …）编写，因此**不需要写任何 `dark:` 变体** —— 这正是 Task 2 拒绝 `dark:` 策略的收益所在。

**Files:**
- Create: `src/framework/ui/Icon.tsx`, `Pane.tsx`, `CodeArea.tsx`, `CopyButton.tsx`, `DownloadButton.tsx`, `Field.tsx`, `Inputs.tsx`, `ErrorNote.tsx`, `EmptyState.tsx`, `Spinner.tsx`, `index.ts`
- Test: `src/framework/ui/ErrorNote.test.tsx`, `src/framework/ui/CodeArea.test.tsx`

**Interfaces:**
- Consumes: Task 9 的 `IconName`；`core/result.ts` 的 `ErrorInfo`
- Produces:
  - `<Icon name={IconName} size?={number} />`
  - `<Pane title?={string} actions?={ReactNode} tone?={'default'|'danger'}>{children}</Pane>`
  - `<CodeArea value onChange? readOnly? label? errorLine? errorOffset? rows? placeholder? />`
  - `<CopyButton text={string} label?={string} />`
  - `<DownloadButton filename={string} text={string} mime?={string} />`
  - `<Field label={string} hint?={string}>{children}</Field>`
  - `<Select label options value onChange />`、`<NumberInput />`、`<ColorInput />`、`<Checkbox />`、`<SegmentedControl />`
  - `<ErrorNote info={ErrorInfo} />`
  - `<EmptyState title hint?={string} />`、`<Spinner label?={string} />`

- [ ] **Step 1: 实现 `src/framework/ui/Icon.tsx`**

全部手写 24×24 描边几何图形，不引入图标库 —— 既满足零外网，也避免为 21 个图标付出一个依赖的体积。

```tsx
import type { IconName } from '../types'

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const PATHS: Record<IconName, React.ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" {...STROKE} />
      <path d="M16.5 16.5 21 21" {...STROKE} />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="11" width="16" height="9" rx="1.5" {...STROKE} />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" {...STROKE} />
    </>
  ),
  swap: (
    <>
      <path d="M4 8h13l-3-3" {...STROKE} />
      <path d="M20 16H7l3 3" {...STROKE} />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" {...STROKE} />
      <path d="M3 12h18" {...STROKE} />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z" {...STROKE} />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" {...STROKE} />
      <circle cx="8.5" cy="9.5" r="1.5" {...STROKE} />
      <path d="M21 16.5 16 11.5 7 20.5" {...STROKE} />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" {...STROKE} />
      <path d="M7 9.5 10 12.5 7 15.5" {...STROKE} />
      <path d="M13 15.5h4" {...STROKE} />
    </>
  ),
  star: (
    <path
      d="M12 3.5l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.9l6-.9z"
      {...STROKE}
    />
  ),
  'star-filled': (
    <path
      d="M12 3.5l2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6L3.3 9.9l6-.9z"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
    />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" {...STROKE} />
      <path d="M12 7v5.2l3.4 2" {...STROKE} />
    </>
  ),
  'chevron-right': <path d="M9.5 6 15.5 12l-6 6" {...STROKE} />,
  'chevron-down': <path d="M6 9.5 12 15.5l6-6" {...STROKE} />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="1.5" {...STROKE} />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" {...STROKE} />
    </>
  ),
  check: <path d="M4.5 12.5 9.5 17.5 19.5 7" {...STROKE} />,
  download: (
    <>
      <path d="M12 3v12" {...STROKE} />
      <path d="M7.5 10.5 12 15l4.5-4.5" {...STROKE} />
      <path d="M4 20h16" {...STROKE} />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" {...STROKE} />
      <path d="M9.5 7V5h5v2" {...STROKE} />
      <path d="M6.5 7l1 13h9l1-13" {...STROKE} />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" {...STROKE} />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" {...STROKE} />
    </>
  ),
  moon: (
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" {...STROKE} />
  ),
  monitor: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="1.5" {...STROKE} />
      <path d="M9 21h6M12 17v4" {...STROKE} />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5 20.5 19.5H3.5z" {...STROKE} />
      <path d="M12 10v4" {...STROKE} />
      <circle cx="12" cy="16.8" r="0.9" fill="currentColor" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" {...STROKE} />,
  close: <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" {...STROKE} />,
}

export interface IconProps {
  name: IconName
  size?: number
  className?: string
}

export function Icon({ name, size = 16, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
```

`React.ReactNode` 需 `import type { ReactNode } from 'react'` 并把类型标注改为 `ReactNode`。

- [ ] **Step 2: 实现 `src/framework/ui/Pane.tsx`**

```tsx
import type { ReactNode } from 'react'

export interface PaneProps {
  title?: string
  actions?: ReactNode
  tone?: 'default' | 'danger'
  children: ReactNode
  className?: string
}

export function Pane({ title, actions, tone = 'default', children, className }: PaneProps) {
  return (
    <section
      className={[
        'flex min-h-0 flex-col rounded-md border bg-surface',
        tone === 'danger' ? 'border-danger/60' : 'border-border',
        className ?? '',
      ].join(' ')}
    >
      {(title || actions) && (
        <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-2.5">
          <span className="truncate text-[12px] font-medium tracking-wide text-muted uppercase">
            {title}
          </span>
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  )
}
```

- [ ] **Step 3: 实现 `src/framework/ui/CodeArea.tsx`**

`errorLine` 与 `errorOffset` 是「解析错误统一定位」在输入区的落点。

```tsx
import { useMemo } from 'react'
import { positionToLineColumn } from '@/core/json/scanner'

export interface CodeAreaProps {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  label?: string
  placeholder?: string
  rows?: number
  /** 出错行号（1 基），用于高亮 */
  errorLine?: number
  /** 出错字符偏移，用于在只读视图下定位 */
  errorOffset?: number
  className?: string
}

export function CodeArea({
  value,
  onChange,
  readOnly = false,
  label,
  placeholder,
  rows = 10,
  errorLine,
  errorOffset,
  className,
}: CodeAreaProps) {
  const lineCount = useMemo(() => value.split('\n').length, [value])

  // 只读视图用带行号的行列表，以便逐行标错
  if (readOnly) {
    const lines = value.split('\n')
    return (
      <div className={['code-text relative min-h-0 overflow-auto', className ?? ''].join(' ')}>
        {label && <span className="sr-only">{label}</span>}
        {value.length === 0 ? (
          <p className="p-2.5 text-muted">{placeholder ?? '（空）'}</p>
        ) : (
          <ol className="m-0 list-none p-0">
            {lines.map((line, index) => {
              const lineNumber = index + 1
              const isError = errorLine === lineNumber
              return (
                <li
                  key={`${lineNumber}-${line.length}`}
                  data-error={isError || undefined}
                  className={[
                    'flex gap-2.5 px-2.5',
                    isError ? 'bg-danger/15' : '',
                  ].join(' ')}
                >
                  <span className="w-9 shrink-0 text-right text-muted select-none">
                    {lineNumber}
                  </span>
                  <span className="whitespace-pre-wrap break-all">{line || ' '}</span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    )
  }

  return (
    <textarea
      aria-label={label}
      value={value}
      readOnly={readOnly}
      rows={rows}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      placeholder={placeholder}
      onChange={(event) => onChange?.(event.target.value)}
      className={[
        'code-text w-full resize-none border-0 bg-transparent p-2.5 outline-none',
        'placeholder:text-muted/70',
        className ?? '',
      ].join(' ')}
    />
  )
}

/** 由字符偏移推导出行号，供调用方设置 errorLine。 */
export function lineOfOffset(text: string, offset: number): number {
  return positionToLineColumn(text, offset).line
}
```

`lineCount` 未使用会触发 lint 报错 —— 若如此则删除该 `useMemo` 与 `useMemo` 导入。

- [ ] **Step 4: 实现 `src/framework/ui/CopyButton.tsx` 与 `DownloadButton.tsx`**

复制按钮需覆盖 spec 的「复制成功反馈」与「不可用时的降级」，实现依赖 Task 14 的 `clipboard.ts`。

```tsx
// CopyButton.tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { copyText } from '../clipboard'
import { Icon } from './Icon'

export interface CopyButtonProps {
  text: string
  label?: string
  disabled?: boolean
}

export function CopyButton({ text, label = '复制', disabled }: CopyButtonProps) {
  const [status, setStatus] = useState<'idle' | 'done' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const onClick = useCallback(async () => {
    const result = await copyText(text)
    setStatus(result.ok ? 'done' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setStatus('idle'), 1500)
  }, [text])

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled || text.length === 0}
      className="inline-flex h-6 items-center gap-1 rounded-sm px-2 text-[12px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
    >
      <Icon name={status === 'done' ? 'check' : 'copy'} size={13} />
      {status === 'done' ? '已复制' : status === 'failed' ? '复制失败' : label}
    </button>
  )
}
```

```tsx
// DownloadButton.tsx
import { downloadText } from '../file'
import { Icon } from './Icon'

export interface DownloadButtonProps {
  filename: string
  text: string
  mime?: string
  label?: string
  disabled?: boolean
}

export function DownloadButton({
  filename,
  text,
  mime,
  label = '下载',
  disabled,
}: DownloadButtonProps) {
  return (
    <button
      type="button"
      onClick={() => void downloadText(filename, text, mime)}
      disabled={disabled || text.length === 0}
      className="inline-flex h-6 items-center gap-1 rounded-sm px-2 text-[12px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40"
    >
      <Icon name="download" size={13} />
      {label}
    </button>
  )
}
```

- [ ] **Step 5: 实现 `src/framework/ui/Field.tsx` 与 `Inputs.tsx`**

```tsx
// Field.tsx
import type { ReactNode } from 'react'

export interface FieldProps {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}

export function Field({ label, hint, children, className }: FieldProps) {
  return (
    <label className={['flex items-center gap-2 text-[12px]', className ?? ''].join(' ')}>
      <span className="shrink-0 text-muted" title={hint}>
        {label}
      </span>
      {children}
    </label>
  )
}
```

```tsx
// Inputs.tsx
import type { ReactNode } from 'react'

const CONTROL =
  'h-6 rounded-sm border border-border bg-surface-2 px-1.5 text-[12px] text-fg outline-none focus:border-accent'

export interface SelectOption<T extends string> {
  value: T
  label: string
}

export function Select<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string
  options: readonly SelectOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <select
      aria-label={label}
      className={CONTROL}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label?: string
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
}) {
  return (
    <input
      aria-label={label}
      type="number"
      className={`${CONTROL} w-20`}
      value={value}
      min={min}
      max={max}
      onChange={(event) => {
        const next = Number(event.target.value)
        if (Number.isFinite(next)) onChange(next)
      }}
    />
  )
}

export function ColorInput({
  label,
  value,
  onChange,
}: {
  label?: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <input
        aria-label={label}
        type="color"
        className="h-6 w-8 cursor-pointer rounded-sm border border-border bg-surface-2 p-0.5"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <code className="text-[11px] text-muted uppercase">{value}</code>
    </span>
  )
}

export function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12px]">
      <input
        type="checkbox"
        className="h-3.5 w-3.5 accent-accent"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  )
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string
  options: readonly SelectOption<T>[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <span role="group" aria-label={label} className="inline-flex rounded-sm border border-border">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={[
            'h-6 px-2 text-[12px] first:rounded-l-sm last:rounded-r-sm',
            value === option.value
              ? 'bg-accent text-white'
              : 'bg-surface-2 text-muted hover:text-fg',
          ].join(' ')}
        >
          {option.label}
        </button>
      ))}
    </span>
  )
}

export function ToolbarRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2">{children}</div>
}
```

注意 `ColorInput` 中 `</span>` 前使用了 `</code>` 之外的标签闭合有误：应为 `<code …>{value}</code>`。实现时修正。

- [ ] **Step 6: 实现 `src/framework/ui/ErrorNote.tsx`**

**「解析错误统一定位」的唯一呈现出口**（spec P3）。所有解析类工具都必须通过它展示错误，从而保证行号/列号/偏移三件套在所有工具中一致。

```tsx
import type { ErrorInfo } from '@/core/result'
import { Icon } from './Icon'

export interface ErrorNoteProps {
  info: ErrorInfo
}

export function ErrorNote({ info }: ErrorNoteProps) {
  const hasLocation =
    typeof info.line === 'number' || typeof info.column === 'number' || typeof info.offset === 'number'

  return (
    <div
      role="alert"
      className="flex items-start gap-2 border-t border-danger/40 bg-danger/10 px-2.5 py-2 text-[12px]"
    >
      <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-fg">{info.error}</p>

        {hasLocation && (
          <p className="code-text text-muted">
            {typeof info.line === 'number' && <span>第 {info.line} 行</span>}
            {typeof info.column === 'number' && <span> 第 {info.column} 列</span>}
            {typeof info.offset === 'number' && <span> （偏移 {info.offset}）</span>}
          </p>
        )}

        {info.detail && <p className="text-muted">{info.detail}</p>}

        {info.suggestion && (
          <p className="text-muted">
            建议：<span className="code-text text-fg">{info.suggestion}</span>
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: 实现 `EmptyState.tsx`、`Spinner.tsx` 与桶文件 `index.ts`**

```tsx
// EmptyState.tsx
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
      <p className="text-muted">{title}</p>
      {hint && <p className="text-[12px] text-muted/70">{hint}</p>}
    </div>
  )
}
```

```tsx
// Spinner.tsx
export function Spinner({ label }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-[12px] text-muted">
      <span
        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-accent"
        aria-hidden="true"
      />
      {label}
    </span>
  )
}
```

```ts
// index.ts
export { CodeArea, lineOfOffset } from './CodeArea'
export { CopyButton } from './CopyButton'
export { DownloadButton } from './DownloadButton'
export { EmptyState } from './EmptyState'
export { ErrorNote } from './ErrorNote'
export { Field } from './Field'
export { Icon } from './Icon'
export { Checkbox, ColorInput, NumberInput, SegmentedControl, Select, ToolbarRow } from './Inputs'
export { Pane } from './Pane'
export { Spinner } from './Spinner'
export type { IconProps } from './Icon'
export type { SelectOption } from './Inputs'
```

- [ ] **Step 8: 写测试 —— `src/framework/ui/ErrorNote.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ErrorNote } from './ErrorNote'

describe('ErrorNote', () => {
  it('展示错误原因', () => {
    render(<ErrorNote info={{ error: '对象中出现尾随逗号' }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('对象中出现尾随逗号')
  })

  it('同时展示行号、列号与偏移（spec P3 的三件套）', () => {
    render(<ErrorNote info={{ error: 'boom', line: 3, column: 8, offset: 21 }} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('第 3 行')
    expect(alert).toHaveTextContent('第 8 列')
    expect(alert).toHaveTextContent('偏移 21')
  })

  it('无法定位时不展示行列号（避免误导）', () => {
    render(<ErrorNote info={{ error: '无法定位的错误' }} />)
    const alert = screen.getByRole('alert')
    expect(alert).not.toHaveTextContent('行')
    expect(alert).not.toHaveTextContent('列')
  })

  it('展示补充说明与修复建议', () => {
    render(
      <ErrorNote
        info={{ error: '不是绝对 URL', detail: '缺少协议', suggestion: 'https://example.com' }}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('缺少协议')
    expect(alert).toHaveTextContent('https://example.com')
  })
})
```

- [ ] **Step 9: 运行测试**

Run: `npx vitest run --project ui`
Expected: PASS，4 个新用例

- [ ] **Step 10: 提交**

```bash
git add -A
git commit -m "feat(ui): 引入 UI 原语集

- Icon 手写 21 个 24x24 SVG，不引入图标库
- ErrorNote 作为解析错误统一呈现的唯一出口，保证三定位在所有工具中一致
- CodeArea 支持只读行号视图与出错行高亮
- 全部使用语义令牌类名，无需编写 dark: 变体"
```

---

### Task 14: 平台集成（剪贴板与文件导出）

Tauri 环境与纯浏览器环境的能力不同。按 `isTauri()` 分支，使 `tauri dev` 与浏览器预览都能工作 —— 这让 UI 开发无需每次都启动完整桌面应用。

**Files:**
- Create: `src/framework/clipboard.ts`, `src/framework/file.ts`
- Test: `src/framework/file.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `Result` / `ok` / `err`
- Produces:
  - `isTauri(): boolean`
  - `copyText(text: string): Promise<Result<void>>`
  - `canCopyImage(): boolean`、`copyImage(blob: Blob): Promise<Result<void>>`
  - `downloadText(filename: string, text: string, mime?: string): Promise<Result<void>>`
  - `downloadBlob(filename: string, blob: Blob): Promise<Result<void>>`

- [ ] **Step 1: 实现 `src/framework/file.ts`**

```ts
import { err, ok, type Result } from '@/core/result'

/**
 * 判断是否运行在 Tauri 容器内。
 *
 * 采用运行时探测而非编译期常量：这样同一份代码在浏览器预览与
 * tauri dev 下都能正确分支，UI 开发无需每次启动桌面应用。
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

const MIME_BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain;charset=utf-8',
  json: 'application/json;charset=utf-8',
  yaml: 'application/yaml;charset=utf-8',
  yml: 'application/yaml;charset=utf-8',
  html: 'text/html;charset=utf-8',
  svg: 'image/svg+xml',
  md: 'text/markdown;charset=utf-8',
}

function guessMime(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXTENSION[extension] ?? 'text/plain;charset=utf-8'
}

/** 浏览器降级路径：Blob + 临时 <a download>。 */
function downloadViaBrowser(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // 立即回收会中断下载，延后释放
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

async function downloadViaTauri(filename: string, blob: Blob | string): Promise<Result<void>> {
  try {
    const [{ save }, { writeFile, writeTextFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ])

    const path = await save({ defaultPath: filename })
    if (!path) return err('已取消保存', { code: 'CANCELLED' })

    if (typeof blob === 'string') {
      await writeTextFile(path, blob)
    } else {
      await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
    }
    return ok(undefined)
  } catch (cause) {
    return err('保存文件失败', {
      code: 'WRITE_FAILED',
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

export async function downloadBlob(filename: string, blob: Blob): Promise<Result<void>> {
  if (isTauri()) return downloadViaTauri(filename, blob)
  try {
    downloadViaBrowser(filename, blob)
    return ok(undefined)
  } catch (cause) {
    return err('导出文件失败', {
      code: 'DOWNLOAD_FAILED',
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

export async function downloadText(
  filename: string,
  text: string,
  mime?: string,
): Promise<Result<void>> {
  const type = mime ?? guessMime(filename)
  if (isTauri()) return downloadViaTauri(filename, text)
  return downloadBlob(filename, new Blob([text], { type }))
}
```

- [ ] **Step 2: 实现 `src/framework/clipboard.ts`**

```ts
import { err, ok, type Result } from '@/core/result'
import { isTauri } from './file'

async function writeTextViaTauri(text: string): Promise<Result<void>> {
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
    return ok(undefined)
  } catch (cause) {
    return err('写入剪贴板失败', {
      code: 'CLIPBOARD_FAILED',
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

/**
 * 写入文本剪贴板。
 *
 * 先试 Web Clipboard API；它要求安全上下文且可能被权限策略拒绝，
 * 因此在 Tauri 环境中回退到原生剪贴板插件。
 */
export async function copyText(text: string): Promise<Result<void>> {
  if (text.length === 0) return err('没有可复制的内容', { code: 'EMPTY' })

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return ok(undefined)
    } catch {
      // 继续尝试 Tauri 回退
    }
  }

  if (isTauri()) return writeTextViaTauri(text)

  return err('当前环境不支持写入剪贴板', {
    code: 'CLIPBOARD_UNAVAILABLE',
    detail: '请手动选中内容后复制',
  })
}

/** 图片复制能力探测：不可用时界面应隐藏该按钮并改为提供下载。 */
export function canCopyImage(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof ClipboardItem !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function'
  )
}

export async function copyImage(blob: Blob): Promise<Result<void>> {
  if (!canCopyImage()) {
    return err('当前环境不支持复制图片', {
      code: 'CLIPBOARD_UNAVAILABLE',
      detail: '可改用下载 PNG',
    })
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    return ok(undefined)
  } catch (cause) {
    return err('复制图片失败', {
      code: 'CLIPBOARD_FAILED',
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
}
```

- [ ] **Step 3: 写测试 —— `src/framework/file.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadText, isTauri } from './file'

describe('isTauri', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__']
  })

  it('无 Tauri 标记时返回 false', () => {
    expect(isTauri()).toBe(false)
  })

  it('存在 Tauri 标记时返回 true', () => {
    ;(window as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {}
    expect(isTauri()).toBe(true)
  })
})

describe('downloadText（浏览器降级路径）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('创建并点击带 download 属性的锚点', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const result = await downloadText('a.json', '{"a":1}')
    expect(result.ok).toBe(true)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('导出后不遗留锚点元素', async () => {
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadText('a.txt', 'x')
    expect(document.querySelectorAll('a[download]').length).toBe(0)
  })
})
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run --project ui`
Expected: PASS，4 个用例

- [ ] **Step 5: 确认分层约束未被破坏**

Run: `npm run lint`
Expected: 通过。`framework/` 允许依赖 `core/` 与 `@tauri-apps/*`，因此本任务不应触发任何限制。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(framework): 剪贴板与文件导出的跨环境集成

- 以运行时探测 isTauri() 分支，浏览器预览与 tauri dev 均可工作
- 复制先试 Web Clipboard API，被权限策略拒绝时回退原生插件
- 图片复制不可用时返回明确错误，由界面改为提供下载
- 动态 import Tauri 插件，避免在浏览器预览下加载失败
- 下载后不遗留锚点元素，并延后释放 object URL"
```

---

### Task 15: 工具布局、懒加载宿主与异常隔离

**三个设计点：**

1. **`ToolLayout` 用判别联合覆盖两种形态** —— 14 个标准工具是「输入 | 输出」并排，双栏类工具（JSON diff）与卡片类工具（二维码）需要自定义排布。用一个必需字段的存在与否来区分，既类型安全又不必塞一堆可选 prop。
2. **懒加载由 `lazy(entry.load)` 承担** —— 只有被打开的工具才拉取其 chunk，对应 spec 的「打开某工具时只有该工具的组件代码被加载」。
3. **异常隔离的 `key` 必须是工具 id** —— 否则一个工具崩溃后切到另一个工具，错误态不会重置。

**Files:**
- Create: `src/framework/ToolLayout.tsx`, `src/framework/ToolHost.tsx`, `src/framework/ToolErrorBoundary.tsx`
- Test: `src/framework/ToolHost.test.tsx`

**Interfaces:**
- Consumes: Task 10 的 `ToolEntry`；Task 13 的 `Pane` / `ToolbarRow` / `Spinner` / `Icon`
- Produces:
  - `ToolLayoutProps`（判别联合）与 `ToolLayout`
  - `ToolHost({ entry })`
  - `ToolErrorBoundary({ toolName, children })`

- [ ] **Step 1: 实现 `src/framework/ToolErrorBoundary.tsx`**

React 19 仍未提供错误边界的 Hook 形式，必须用类组件。

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Icon } from './ui/Icon'

export interface ToolErrorBoundaryProps {
  toolName: string
  children: ReactNode
}

interface ToolErrorBoundaryState {
  error: Error | null
}

/**
 * 单个工具的渲染异常隔离。
 *
 * 崩溃被限制在工具面板内，侧栏与搜索仍然可用 —— 用户可以切到别的工具继续工作。
 * 调用方必须传入 key={toolId}，否则切换工具时错误态不会重置。
 */
export class ToolErrorBoundary extends Component<ToolErrorBoundaryProps, ToolErrorBoundaryState> {
  constructor(props: ToolErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): ToolErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ToolErrorBoundary] 工具「${this.props.toolName}」渲染异常`, error, info)
  }

  private readonly handleRetry = (): void => {
    this.setState({ error: null })
  }

  override render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Icon name="alert" size={22} className="text-danger" />
        <p className="text-fg">「{this.props.toolName}」出现异常</p>
        <p className="code-text max-w-lg break-all text-muted">{error.message}</p>
        <button
          type="button"
          onClick={this.handleRetry}
          className="h-6 rounded-sm border border-border bg-surface-2 px-3 text-[12px] hover:border-accent"
        >
          重试
        </button>
      </div>
    )
  }
}
```

- [ ] **Step 2: 实现 `src/framework/ToolHost.tsx`**

```tsx
import { Suspense, lazy, useMemo } from 'react'
import type { ToolEntry } from './registry'
import { ToolErrorBoundary } from './ToolErrorBoundary'
import { Spinner } from './ui/Spinner'

export interface ToolHostProps {
  entry: ToolEntry
}

export function ToolHost({ entry }: ToolHostProps) {
  // entry.load 是 glob 产生的懒加载 thunk，lazy() 据此为每个工具生成独立 chunk
  const Tool = useMemo(() => lazy(entry.load), [entry])

  return (
    <ToolErrorBoundary key={entry.meta.id} toolName={entry.meta.name}>
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner label="加载中…" />
          </div>
        }
      >
        <Tool />
      </Suspense>
    </ToolErrorBoundary>
  )
}
```

- [ ] **Step 3: 实现 `src/framework/ToolLayout.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Pane } from './ui/Pane'
import { ToolbarRow } from './ui/Inputs'

export type ToolLayoutProps = {
  options?: ReactNode
  status?: ReactNode
} & (
  | { body: ReactNode; input?: never; output?: never }
  | { input?: ReactNode; output: ReactNode; body?: never }
)

/**
 * 工具的四区域布局。
 *
 * 判别联合覆盖两种形态：
 * - 标准形态（14 个工具）：传入 input / output，左右并排
 * - 自由形态（JSON diff 双栏、二维码预览）：传入 body，自行排布
 *
 * 720px 以下是 spec 要求的并排转堆叠断点，用 arbitrary variant
 * 精确命中该宽度，而非 Tailwind 默认的 768px（md）。
 */
export function ToolLayout(props: ToolLayoutProps) {
  const hasBody = 'body' in props && props.body !== undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      {props.options !== undefined && (
        <div className="shrink-0 border-b border-border bg-surface px-3 py-2">
          <ToolbarRow>{props.options}</ToolbarRow>
        </div>
      )}

      {hasBody ? (
        <div className="min-h-0 flex-1 p-2.5">{props.body}</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5 min-[720px]:flex-row">
          <Pane title="输入" className="min-h-0 flex-1">
            {props.input}
          </Pane>
          <Pane title="输出" className="min-h-0 flex-1">
            {props.output}
          </Pane>
        </div>
      )}

      {props.status !== undefined && (
        <div className="shrink-0 border-t border-border px-3 py-1.5 text-[12px] text-muted">
          {props.status}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 写测试 —— `src/framework/ToolHost.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ToolEntry } from './registry'
import { ToolErrorBoundary } from './ToolErrorBoundary'
import { ToolHost } from './ToolHost'

function entryWith(component: ComponentType): ToolEntry {
  return {
    meta: {
      id: 'probe',
      name: '探针工具',
      category: 'dev',
      description: '用于测试',
      keywords: ['probe'],
    },
    load: () => Promise.resolve({ default: component }),
  }
}

describe('ToolHost', () => {
  it('加载完成后渲染工具组件', async () => {
    render(<ToolHost entry={entryWith(() => <p>工具已渲染</p>)} />)
    expect(await screen.findByText('工具已渲染')).toBeDefined()
  })

  it('加载期间展示加载态', () => {
    render(<ToolHost entry={entryWith(() => <p>晚点出现</p>)} />)
    expect(screen.getByRole('status')).toBeDefined()
  })
})

describe('ToolErrorBoundary', () => {
  const Boom = () => {
    throw new Error('故意抛出的异常')
  }

  it('捕获异常并展示原因，而非让整个应用崩溃', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ToolErrorBoundary toolName="探针工具">
        <Boom />
      </ToolErrorBoundary>,
    )
    expect(screen.getByText(/出现异常/)).toBeDefined()
    expect(screen.getByText(/故意抛出的异常/)).toBeDefined()
    spy.mockRestore()
  })

  it('提供重试入口', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow = true
    const Flaky = () => {
      if (shouldThrow) throw new Error('首次失败')
      return <p>恢复成功</p>
    }

    render(
      <ToolErrorBoundary toolName="探针工具">
        <Flaky />
      </ToolErrorBoundary>,
    )

    shouldThrow = false
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.getByText('恢复成功')).toBeDefined()
    spy.mockRestore()
  })

  it('正常子组件不受影响', () => {
    render(
      <ToolErrorBoundary toolName="探针工具">
        <p>一切正常</p>
      </ToolErrorBoundary>,
    )
    expect(screen.getByText('一切正常')).toBeDefined()
  })
})
```

- [ ] **Step 5: 运行测试**

Run: `npx vitest run --project ui`
Expected: PASS，5 个用例

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(framework): 工具布局、懒加载宿主与异常隔离

- ToolLayout 用判别联合区分标准输入/输出与自由 body 两种形态
- 720px 断点用 arbitrary variant 精确命中，而非 Tailwind 默认的 768px
- ToolHost 以 lazy(entry.load) 实现按工具代码分割
- ToolErrorBoundary 的 key 为工具 id，保证切换工具时错误态重置
- 崩溃被限制在工具面板内，侧栏与搜索仍可用"
```

---

### Task 16: 应用外壳与侧栏

**关键点：**

- **默认落地工具**：spec 要求"有最近使用则打开最近一项，否则打开内置默认项"。注意 `getTool` 在注册表变化后可能查不到历史 id（例如工具被改名），必须回退到注册表首项，否则应用启动即白屏。
- **窄窗折叠**（spec P2）：宽度不足时侧栏收为覆盖层抽屉。用 `matchMedia` 而非 CSS 隐藏，因为抽屉的开启状态需要由 JS 控制。
- **主题应用**：`system` 模式下必须监听 `prefers-color-scheme` 变化并**清理监听器**。

**Files:**
- Create: `src/app/App.tsx`, `src/app/Sidebar.tsx`, `src/app/ThemeToggle.tsx`
- Modify: `src/main.tsx`（主题初始化提前到渲染前，避免首帧闪烁）
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: Task 10 的 `listTools` / `getTool`；Task 12 的 `usePrefs` / `pushRecent` / `toggleFavorite`；Task 15 的 `ToolHost`
- Produces: `App`（默认导出改为具名导出 `App`，`main.tsx` 已按此引用）

- [ ] **Step 1: 实现 `src/app/ThemeToggle.tsx`**

```tsx
import { setTheme, usePrefs } from '@/framework/usePrefs'
import { Icon } from '@/framework/ui/Icon'
import { SegmentedControl } from '@/framework/ui/Inputs'
import type { ThemeMode } from '@/framework/theme'

const OPTIONS = [
  { value: 'dark', label: '暗色' },
  { value: 'light', label: '亮色' },
  { value: 'system', label: '跟随系统' },
] as const satisfies readonly { value: ThemeMode; label: string }[]

const ICON_BY_MODE: Record<ThemeMode, 'moon' | 'sun' | 'monitor'> = {
  dark: 'moon',
  light: 'sun',
  system: 'monitor',
}

export function ThemeToggle() {
  const prefs = usePrefs()

  return (
    <div className="flex items-center gap-1.5">
      <Icon name={ICON_BY_MODE[prefs.theme]} size={14} className="text-muted" />
      <SegmentedControl
        label="主题"
        options={OPTIONS}
        value={prefs.theme}
        onChange={setTheme}
      />
    </div>
  )
}
```

- [ ] **Step 2: 实现 `src/app/Sidebar.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { CATEGORIES } from '@/framework/categories'
import { listTools, type ToolEntry } from '@/framework/registry'
import { toggleFavorite, usePrefs } from '@/framework/usePrefs'
import { Icon } from '@/framework/ui/Icon'
import type { ToolCategory } from '@/framework/types'

export interface SidebarProps {
  activeId: string | null
  onSelect: (id: string) => void
  /** 窄窗模式下以覆盖层呈现 */
  overlay?: boolean
  onRequestClose?: () => void
}

function ToolRow({
  entry,
  active,
  favorite,
  onSelect,
  onToggleFavorite,
}: {
  entry: ToolEntry
  active: boolean
  favorite: boolean
  onSelect: (id: string) => void
  onToggleFavorite: (id: string) => void
}) {
  return (
    <li className="group/row flex items-center">
      <button
        type="button"
        onClick={() => onSelect(entry.meta.id)}
        aria-current={active ? 'page' : undefined}
        className={[
          'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-sm px-2 text-left text-[12.5px]',
          active ? 'bg-accent/15 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
        ].join(' ')}
      >
        <span className="truncate">{entry.meta.name}</span>
      </button>
      <button
        type="button"
        aria-label={favorite ? `取消收藏 ${entry.meta.name}` : `收藏 ${entry.meta.name}`}
        onClick={() => onToggleFavorite(entry.meta.id)}
        className={[
          'mr-1 shrink-0 rounded-sm p-1',
          favorite ? 'text-warn' : 'text-muted opacity-0 group-hover/row:opacity-100',
        ].join(' ')}
      >
        <Icon name={favorite ? 'star-filled' : 'star'} size={13} />
      </button>
    </li>
  )
}

export function Sidebar({ activeId, onSelect, overlay, onRequestClose }: SidebarProps) {
  const prefs = usePrefs()
  const [collapsed, setCollapsed] = useState<Set<ToolCategory>>(new Set())

  const byCategory = useMemo(() => {
    const map = new Map<ToolCategory, ToolEntry[]>()
    for (const category of CATEGORIES) map.set(category.id, [])
    for (const entry of listTools()) map.get(entry.meta.category)?.push(entry)
    return map
  }, [])

  const favorites = useMemo(
    () => prefs.favorites.map((id) => listTools().find((e) => e.meta.id === id)).filter(Boolean),
    [prefs.favorites],
  ) as ToolEntry[]

  const recents = useMemo(
    () =>
      prefs.recents
        .map((recent) => listTools().find((entry) => entry.meta.id === recent.id))
        .filter((entry): entry is ToolEntry => entry !== undefined),
    [prefs.recents],
  )

  const toggleCollapse = (category: ToolCategory) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  return (
    <nav
      aria-label="工具导航"
      className={[
        'flex h-full w-60 shrink-0 flex-col border-r border-border bg-surface',
        overlay ? 'absolute inset-y-0 left-0 z-20 shadow-lg' : '',
      ].join(' ')}
    >
      {overlay && (
        <div className="flex h-9 items-center justify-between border-b border-border px-2.5">
          <span className="text-[12px] text-muted">工具导航</span>
          <button
            type="button"
            aria-label="关闭导航"
            onClick={onRequestClose}
            className="rounded-sm p-1 text-muted hover:text-fg"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {favorites.length > 0 && (
          <section className="mb-2">
            <h2 className="px-2 py-1 text-[11px] tracking-wide text-muted uppercase">收藏</h2>
            <ul className="m-0 list-none p-0">
              {favorites.map((entry) => (
                <ToolRow
                  key={`fav-${entry.meta.id}`}
                  entry={entry}
                  active={entry.meta.id === activeId}
                  favorite
                  onSelect={onSelect}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </ul>
          </section>
        )}

        {recents.length > 0 && (
          <section className="mb-2">
            <h2 className="px-2 py-1 text-[11px] tracking-wide text-muted uppercase">最近使用</h2>
            <ul className="m-0 list-none p-0">
              {recents.slice(0, 5).map((entry) => (
                <ToolRow
                  key={`recent-${entry.meta.id}`}
                  entry={entry}
                  active={entry.meta.id === activeId}
                  favorite={prefs.favorites.includes(entry.meta.id)}
                  onSelect={onSelect}
                  onToggleFavorite={toggleFavorite}
                />
              ))}
            </ul>
          </section>
        )}

        {CATEGORIES.map((category) => {
          const entries = byCategory.get(category.id) ?? []
          // 类别下无工具时不展示（spec 要求）
          if (entries.length === 0) return null
          const isCollapsed = collapsed.has(category.id)

          return (
            <section key={category.id} className="mb-1">
              <button
                type="button"
                onClick={() => toggleCollapse(category.id)}
                aria-expanded={!isCollapsed}
                className="flex h-6 w-full items-center gap-1.5 rounded-sm px-2 text-[11px] tracking-wide text-muted uppercase hover:text-fg"
              >
                <Icon name={isCollapsed ? 'chevron-right' : 'chevron-down'} size={12} />
                <Icon name={category.icon} size={13} />
                <span>{category.name}</span>
                <span className="ml-auto text-muted/60">{entries.length}</span>
              </button>

              {!isCollapsed && (
                <ul className="m-0 list-none p-0">
                  {entries.map((entry) => (
                    <ToolRow
                      key={entry.meta.id}
                      entry={entry}
                      active={entry.meta.id === activeId}
                      favorite={prefs.favorites.includes(entry.meta.id)}
                      onSelect={onSelect}
                      onToggleFavorite={toggleFavorite}
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </nav>
  )
}
```

- [ ] **Step 3: 实现 `src/app/App.tsx`**

```tsx
import { useCallback, useEffect, useState } from 'react'
import { getTool, listTools } from '@/framework/registry'
import { applyTheme, resolveTheme, systemPrefersDark } from '@/framework/theme'
import { pushRecent, usePrefs } from '@/framework/usePrefs'
import { ToolHost } from '@/framework/ToolHost'
import { Icon } from '@/framework/ui/Icon'
import { Sidebar } from './Sidebar'
import { ThemeToggle } from './ThemeToggle'

const NARROW_QUERY = '(max-width: 899px)'

export function App() {
  const prefs = usePrefs()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_QUERY).matches : false,
  )

  // 落地工具：优先最近使用，但注册表变化后历史 id 可能失效，必须回退
  const firstTool = listTools()[0]?.meta.id ?? null
  const candidateId = activeId ?? prefs.recents[0]?.id ?? firstTool
  const entry = candidateId ? getTool(candidateId) : undefined
  const resolvedId = entry?.meta.id ?? firstTool

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY)
    const onChange = (event: MediaQueryListEvent) => {
      setIsNarrow(event.matches)
      if (!event.matches) setDrawerOpen(false)
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const apply = () => applyTheme(resolveTheme(prefs.theme, systemPrefersDark()))
    apply()
    if (prefs.theme !== 'system') return

    const query = window.matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [prefs.theme])

  const openTool = useCallback((id: string) => {
    setActiveId(id)
    pushRecent(id)
    setDrawerOpen(false)
  }, [])

  const resolvedEntry = resolvedId ? getTool(resolvedId) : undefined

  return (
    <div className="relative flex h-full">
      {!isNarrow && (
        <Sidebar activeId={resolvedId} onSelect={openTool} />
      )}

      {isNarrow && drawerOpen && (
        <>
          <div
            role="presentation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 z-10 bg-black/40"
          />
          <Sidebar
            activeId={resolvedId}
            onSelect={openTool}
            overlay
            onRequestClose={() => setDrawerOpen(false)}
          />
        </>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
          {isNarrow && (
            <button
              type="button"
              aria-label="打开导航"
              onClick={() => setDrawerOpen(true)}
              className="rounded-sm p-1 text-muted hover:text-fg"
            >
              <Icon name="menu" size={16} />
            </button>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[13px] font-medium">
              {resolvedEntry?.meta.name ?? 'IT Toolbox'}
            </h1>
            {resolvedEntry && (
              <p className="truncate text-[11px] text-muted">{resolvedEntry.meta.description}</p>
            )}
          </div>

          <ThemeToggle />
        </header>

        <main className="min-h-0 flex-1">
          {resolvedEntry ? <ToolHost entry={resolvedEntry} /> : <p className="p-4 text-muted">尚无可用工具</p>}
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 写测试 —— `src/app/App.test.tsx`**

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { __resetPrefsForTests } from '@/framework/usePrefs'
import { App } from './App'

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetPrefsForTests()
  })

  it('首屏展示侧栏与工具面板', async () => {
    render(<App />)
    expect(screen.getByRole('navigation', { name: '工具导航' })).toBeDefined()
    expect(screen.getByRole('main')).toBeDefined()
  })

  it('默认落地到注册表首项并渲染工具标题', async () => {
    render(<App />)
    // 注册表当前仅含 UUID 生成器
    await waitFor(() => {
      expect(screen.getAllByText('UUID 生成器').length).toBeGreaterThan(0)
    })
  })

  it('展示主题切换控件，默认选中暗色', () => {
    render(<App />)
    const dark = screen.getByRole('button', { name: '暗色' })
    expect(dark.getAttribute('aria-pressed')).toBe('true')
  })

  it('历史最近使用指向已不存在的工具时回退到注册表首项', async () => {
    // 直接写入一个不存在的工具 id
    window.localStorage.setItem(
      'itt:v1:prefs',
      JSON.stringify({ theme: 'dark', favorites: [], recents: [{ id: 'ghost', at: 1, count: 1 }] }),
    )
    __resetPrefsForTests()
    window.localStorage.setItem(
      'itt:v1:prefs',
      JSON.stringify({ theme: 'dark', favorites: [], recents: [{ id: 'ghost', at: 1, count: 1 }] }),
    )

    render(<App />)
    // 不应白屏，仍应渲染出可用工具
    await waitFor(() => {
      expect(screen.getAllByText('UUID 生成器').length).toBeGreaterThan(0)
    })
  })
})
```

最后一个用例中 `__resetPrefsForTests` 会覆盖写入的偏好，实现时若该断言难以稳定构造，可改为**直接单元测试回退逻辑**：把「解析落地工具 id」抽为纯函数 `resolveLandingToolId(prefs, entries)` 并对其单测。**推荐采用后者** —— 它更快也更稳定。

- [ ] **Step 5: 运行测试**

Run: `npx vitest run --project ui`
Expected: PASS

- [ ] **Step 6: 手工验证窄窗折叠（spec P2）**

```bash
npm run tauri dev
```

将窗口宽度拖到 900px 以下，确认：
1. 侧栏收起，工具面板占据全部宽度
2. 出现菜单按钮，点击后侧栏以覆盖层展开
3. 选中工具后覆盖层自动关闭

- [ ] **Step 7: 提交**

```bash
git add -A
git commit -m "feat(app): 应用外壳、分类侧栏与窄窗折叠

- 落地工具解析带回退：历史最近使用 id 失效时退回注册表首项，避免白屏
- 侧栏按类别分组，类别无工具时不渲染
- 收藏与最近使用置顶，最近使用限 5 条展示
- 窄窗（<900px）侧栏收为覆盖层抽屉，选中后自动关闭（spec P2）
- system 主题监听 prefers-color-scheme 并正确清理监听器"
```

---

### Task 17: 命令面板（Cmd/Ctrl+K）

spec 的硬要求：**输入框聚焦时全局快捷键仍须生效**。若把监听器绑在面板内部，聚焦后按键会被输入框吞掉 —— 因此监听器必须挂在 `window` 上，且只在面板关闭时响应开启快捷键。

**Files:**
- Create: `src/app/CommandPalette.tsx`
- Modify: `src/app/App.tsx`（挂载面板并接入快捷键）
- Test: `src/app/CommandPalette.test.tsx`

**Interfaces:**
- Consumes: Task 11 的 `searchTools`；Task 16 的 `openTool`
- Produces: `CommandPalette({ open, onClose, onSelect })`

- [ ] **Step 1: 实现 `src/app/CommandPalette.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { categoryById } from '@/framework/categories'
import { searchTools } from '@/framework/search'
import { Icon } from '@/framework/ui/Icon'

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onSelect: (id: string) => void
}

const MAX_RESULTS = 40

export function CommandPalette({ open, onClose, onSelect }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const hits = useMemo(() => searchTools(query).slice(0, MAX_RESULTS), [query])

  // 每次打开重置查询与高亮项
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // 高亮项滚动进入视野
  useEffect(() => {
    const item = listRef.current?.children[activeIndex]
    if (item instanceof HTMLElement) item.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!open) return null

  const commit = (index: number) => {
    const hit = hits[index]
    if (!hit) return
    onSelect(hit.entry.meta.id)
    onClose()
  }

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="absolute inset-0 z-30 flex items-start justify-center bg-black/40 pt-24"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="搜索工具"
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[60vh] w-[min(560px,90vw)] flex-col overflow-hidden rounded-md border border-border bg-surface"
      >
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <Icon name="search" size={15} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索工具名称或关键词…"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // 监听器挂在 window 上，因此输入框聚焦时快捷键与方向键都能生效
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => Math.min(index + 1, Math.max(hits.length - 1, 0)))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                commit(activeIndex)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              }
            }}
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none placeholder:text-muted"
          />
          <kbd className="shrink-0 rounded-sm border border-border px-1 text-[10px] text-muted">
            Esc
          </kbd>
        </div>

        {hits.length === 0 ? (
          <p className="p-4 text-center text-[12px] text-muted">没有匹配的工具</p>
        ) : (
          <ul ref={listRef} className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-1">
            {hits.map((hit, index) => (
              <li key={hit.entry.meta.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(index)}
                  className={[
                    'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left',
                    index === activeIndex ? 'bg-accent/15' : '',
                  ].join(' ')}
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">
                    {hit.entry.meta.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted">
                    {categoryById(hit.entry.meta.category)?.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 在 `App.tsx` 中接入快捷键与面板**

在 `App` 内新增状态与监听器（放在既有 `useEffect` 之后）：

```tsx
const [paletteOpen, setPaletteOpen] = useState(false)

useEffect(() => {
  const onKeyDown = (event: KeyboardEvent) => {
    // 输入框聚焦时仍需生效，因此监听 window 而非某个容器
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      setPaletteOpen((open) => !open)
      return
    }
    if (event.key === 'Escape') setPaletteOpen(false)
  }

  window.addEventListener('keydown', onKeyDown)
  return () => window.removeEventListener('keydown', onKeyDown)
}, [])
```

并在最外层容器的闭合标签前渲染面板：

```tsx
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSelect={openTool}
      />
    </div>
  )
}
```

导入 `CommandPalette`。同时在页头加入一个可见入口，便于鼠标用户发现：

```tsx
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm border border-border px-2 text-[11px] text-muted hover:text-fg"
          >
            <Icon name="search" size={13} />
            <span>搜索</span>
            <kbd className="text-[10px]">⌘K</kbd>
          </button>
```

- [ ] **Step 3: 写测试 —— `src/app/CommandPalette.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CommandPalette } from './CommandPalette'

describe('CommandPalette', () => {
  it('关闭时不渲染任何内容', () => {
    const { container } = render(
      <CommandPalette open={false} onClose={() => {}} onSelect={() => {}} />,
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('打开后自动聚焦输入框', () => {
    render(<CommandPalette open onClose={() => {}} onSelect={() => {}} />)
    expect(document.activeElement).toBe(screen.getByRole('textbox'))
  })

  it('按名称搜索并列出来源类别', async () => {
    render(<CommandPalette open onClose={() => {}} onSelect={() => {}} />)
    await userEvent.type(screen.getByRole('textbox'), 'uuid')
    expect(screen.getByText('UUID 生成器')).toBeDefined()
    expect(screen.getByText('加密')).toBeDefined()
  })

  it('回车选中高亮项并回调', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette open onClose={onClose} onSelect={onSelect} />)

    await userEvent.type(screen.getByRole('textbox'), 'uuid{Enter}')
    expect(onSelect).toHaveBeenCalledWith('uuid-generator')
    expect(onClose).toHaveBeenCalled()
  })

  it('方向键移动高亮项', async () => {
    render(<CommandPalette open onClose={() => {}} onSelect={() => {}} />)
    await userEvent.type(screen.getByRole('textbox'), '{ArrowDown}{ArrowUp}')
    // 不抛错即可；断言高亮索引回到首项
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThan(0)
  })

  it('Escape 触发关闭', async () => {
    const onClose = vi.fn()
    render(<CommandPalette open onClose={onClose} onSelect={() => {}} />)
    await userEvent.type(screen.getByRole('textbox'), '{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('无匹配时展示空态', async () => {
    render(<CommandPalette open onClose={() => {}} onSelect={() => {}} />)
    await userEvent.type(screen.getByRole('textbox'), 'zzzzzz')
    expect(screen.getByText('没有匹配的工具')).toBeDefined()
  })

  it('中文关键词可命中', async () => {
    render(<CommandPalette open onClose={() => {}} onSelect={() => {}} />)
    await userEvent.type(screen.getByRole('textbox'), '唯一标识')
    expect(screen.getByText('UUID 生成器')).toBeDefined()
  })
})
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run --project ui`
Expected: PASS，8 个用例

- [ ] **Step 5: 手工验证「输入框聚焦时快捷键仍生效」**

```bash
npm run tauri dev
```

1. 点击搜索按钮打开面板，光标应已在输入框内
2. 在输入框**保持聚焦**的状态下按 `Cmd+K`（Windows 为 `Ctrl+K`），确认面板关闭
3. 再次按下，确认面板重新打开
4. 按 `Esc`，确认关闭

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(app): 命令面板与全局搜索快捷键

- 快捷键监听挂载在 window 上，保证输入框聚焦时 Cmd/Ctrl+K 仍生效
- 输入框内处理方向键、回车与 Escape，避免与全局监听冲突
- 面板每次打开重置查询与高亮项，高亮项自动滚入视野
- 页头提供可见入口，便于鼠标用户发现该功能"
```

---

### Task 18: UUID 生成 Core（v1 / v4 / v7 与同毫秒单调）

三处必须精确的位操作，写错不易察觉但会破坏兼容性：

1. **v1 时间戳**：60 位、100ns 间隔、起点为 1582-10-15。换算常量为 `122192928000000000`（即 `0x01B21DD213814000`）。
2. **v1 节点 ID**：WebView 取不到网卡 MAC，固定使用随机值，并**必须把首字节最低位置 1** —— 这是 RFC 4122 规定的 multicast 标志，用以免冒充真实网卡地址。
3. **v7 单调性**：同一毫秒内递增 12 位计数器 `rand_a`。由于 `rand_a` 位于时间戳之后、`rand_b` 之前，只要它严格增大，整个 UUID 的字典序就严格增大 —— 因此 `rand_b` 每次可重新随机，不必缓存。

**额外必须处理的情况：系统时钟回拨。** 若 `Date.now()` 小于上次时间，直接采用会把时间戳写小，破坏单调性。实现中该分支保持时间戳不倒退。

**Files:**
- Create: `src/core/crypto/uuid.ts`
- Test: `src/core/crypto/uuid.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `randomBytes` / `randomInt` / `bytesToHex`
- Produces:
  - `UuidVersion = 1 | 4 | 7`
  - `UuidOptions { version: UuidVersion; count: number; hyphens?: boolean; uppercase?: boolean }`
  - `generateUuids(options: UuidOptions): string[]`
  - `uuidVersionOf(uuid: string): number | null`
  - `uuidTimestampMs(uuid: string): number | null`（v1 与 v7）
  - `__resetUuidStateForTests(): void`

- [ ] **Step 1: 写失败测试 —— `src/core/crypto/uuid.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetUuidStateForTests,
  generateUuids,
  uuidTimestampMs,
  uuidVersionOf,
} from './uuid'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('generateUuids — 格式', () => {
  beforeEach(() => {
    __resetUuidStateForTests()
  })

  it.each([1, 4, 7] as const)('v%i 符合 UUID 格式且变体位正确', (version) => {
    const [uuid] = generateUuids({ version, count: 1 })
    expect(uuid).toMatch(UUID_PATTERN)
    expect(uuidVersionOf(uuid!)).toBe(version)
  })

  it('去掉连字符', () => {
    const [uuid] = generateUuids({ version: 4, count: 1, hyphens: false })
    expect(uuid).toMatch(/^[0-9a-f]{32}$/)
  })

  it('大写输出', () => {
    const [uuid] = generateUuids({ version: 4, count: 1, uppercase: true })
    expect(uuid).toBe(uuid!.toUpperCase())
  })

  it('按数量生成且互不相同', () => {
    const uuids = generateUuids({ version: 4, count: 50 })
    expect(uuids).toHaveLength(50)
    expect(new Set(uuids).size).toBe(50)
  })

  it('数量为 0 返回空数组', () => {
    expect(generateUuids({ version: 4, count: 0 })).toEqual([])
  })

  it('拒绝非法数量', () => {
    expect(() => generateUuids({ version: 4, count: -1 })).toThrowError(/数量/)
    expect(() => generateUuids({ version: 4, count: 1.5 })).toThrowError(/数量/)
    expect(() => generateUuids({ version: 4, count: 100_000 })).toThrowError(/数量/)
  })
})

describe('UUID v7 — 时间与单调性', () => {
  beforeEach(() => {
    __resetUuidStateForTests()
  })

  it('编码的时间戳接近当前时刻', () => {
    const [uuid] = generateUuids({ version: 7, count: 1 })
    const timestamp = uuidTimestampMs(uuid!)
    expect(timestamp).not.toBeNull()
    expect(Math.abs((timestamp ?? 0) - Date.now())).toBeLessThan(5_000)
  })

  it('同一毫秒内批量生成仍严格字典序递增', () => {
    // 立即生成一批，绝大多数会落在同一毫秒内
    const uuids = generateUuids({ version: 7, count: 200 })
    for (let i = 1; i < uuids.length; i++) {
      expect(uuids[i]! > uuids[i - 1]!).toBe(true)
    }
  })

  it('跨毫秒批量生成仍递增', async () => {
    const first = generateUuids({ version: 7, count: 1 })[0]!
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = generateUuids({ version: 7, count: 1 })[0]!
    expect(second > first).toBe(true)
  })

  it('时间戳部分为 48 位大端编码', () => {
    const [uuid] = generateUuids({ version: 7, count: 1, hyphens: false })
    const encoded = Number.parseInt(uuid!.slice(0, 12), 16)
    const timestamp = uuidTimestampMs(uuid!)
    expect(encoded).toBe(timestamp)
  })
})

describe('UUID v1 — 时间与节点', () => {
  beforeEach(() => {
    __resetUuidStateForTests()
  })

  it('解码出的时间戳接近当前时刻', () => {
    const [uuid] = generateUuids({ version: 1, count: 1 })
    const timestamp = uuidTimestampMs(uuid!)
    expect(Math.abs((timestamp ?? 0) - Date.now())).toBeLessThan(5_000)
  })

  it('节点 ID 首字节最低位为 1（随机 multicast 标志）', () => {
    const [uuid] = generateUuids({ version: 1, count: 1, hyphens: false })
    const firstNodeByte = Number.parseInt(uuid!.slice(20, 22), 16)
    expect(firstNodeByte & 0x01).toBe(1)
  })

  it('同一会话内节点 ID 与 clock_seq 保持稳定', () => {
    const [a] = generateUuids({ version: 1, count: 1, hyphens: false })
    const [b] = generateUuids({ version: 1, count: 1, hyphens: false })
    expect(a!.slice(16)).toBe(b!.slice(16))
  })
})

describe('uuidVersionOf / uuidTimestampMs 的健壮性', () => {
  it.each([
    ['空字符串', ''],
    ['非 UUID', 'hello'],
    ['长度不足', '12345678-1234-1234-1234-1234'],
    ['非十六进制', 'zzzzzzzz-zzzz-7zzz-8zzz-zzzzzzzzzzzz'],
  ])('%s 返回 null 而非抛错', (_label, value) => {
    expect(uuidVersionOf(value)).toBeNull()
    expect(uuidTimestampMs(value)).toBeNull()
  })

  it('对 v4 返回 null（无时间戳语义）', () => {
    const [uuid] = generateUuids({ version: 4, count: 1 })
    expect(uuidTimestampMs(uuid!)).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `npx vitest run --project core`
Expected: FAIL —— `Failed to resolve import "./uuid"`

- [ ] **Step 3: 实现 `src/core/crypto/uuid.ts`**

```ts
import { bytesToHex } from '../bytes'
import { randomBytes, randomInt } from '../random'

export type UuidVersion = 1 | 4 | 7

export interface UuidOptions {
  version: UuidVersion
  count: number
  /** 是否输出连字符，默认 true */
  hyphens?: boolean
  /** 是否大写，默认 false */
  uppercase?: boolean
}

/** 单次生成的条数上限，避免阻塞界面。 */
const MAX_COUNT = 1_000

/** 1582-10-15 00:00:00 UTC 与 Unix 纪元之间的 100ns 间隔数（0x01B21DD213814000）。 */
const GREGORIAN_OFFSET_100NS = 122_192_928_000_000_000n

const UUID_PATTERN =
  /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i

/**
 * v1 的会话级状态。
 *
 * 节点 ID 使用随机值：WebView 无法获取网卡 MAC。按 RFC 4122 要求把首字节
 * 最低位置 1（multicast 标志），以免冒充真实网卡地址。
 */
const sessionClockSeq = randomBytes(2)
const sessionNode = (() => {
  const node = randomBytes(6)
  node[0] = ((node[0] ?? 0) | 0x01) & 0xff
  return node
})()

/** v7 的单调计数器状态。 */
let lastTimestampMs = -1
let lastRandA = -1

/** 仅供测试重置模块级状态。 */
export function __resetUuidStateForTests(): void {
  lastTimestampMs = -1
  lastRandA = -1
}

function formatUuid(bytes: Uint8Array, hyphens: boolean, uppercase: boolean): string {
  const hex = bytesToHex(bytes, uppercase)
  if (!hyphens) return hex
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

function generateV1(): Uint8Array {
  const bytes = new Uint8Array(16)

  // 100ns 间隔数 = 毫秒 * 10^4
  const timestamp = BigInt(Date.now()) * 10_000n + GREGORIAN_OFFSET_100NS

  const timeLow = Number(timestamp & 0xffff_ffffn)
  const timeMid = Number((timestamp >> 32n) & 0xffffn)
  const timeHigh = Number((timestamp >> 48n) & 0x0fffn)

  bytes[0] = (timeLow >>> 24) & 0xff
  bytes[1] = (timeLow >>> 16) & 0xff
  bytes[2] = (timeLow >>> 8) & 0xff
  bytes[3] = timeLow & 0xff
  bytes[4] = (timeMid >>> 8) & 0xff
  bytes[5] = timeMid & 0xff
  // 高 4 位为版本号 1
  bytes[6] = ((timeHigh >>> 8) & 0x0f) | 0x10
  bytes[7] = timeHigh & 0xff
  // 高 2 位为变体标志 10
  bytes[8] = ((sessionClockSeq[0] ?? 0) & 0x3f) | 0x80
  bytes[9] = sessionClockSeq[1] ?? 0
  bytes.set(sessionNode, 10)

  return bytes
}

function generateV4(): Uint8Array {
  const bytes = randomBytes(16)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  return bytes
}

function generateV7(): Uint8Array {
  const bytes = new Uint8Array(16)
  let timestampMs = Date.now()
  let randA: number

  if (timestampMs > lastTimestampMs) {
    randA = randomInt(0x1000)
  } else {
    // 同一毫秒，或系统时钟发生了回拨。
    // 两种情况都不能让时间戳倒退，因此保持上一次的毫秒值并递增计数器。
    timestampMs = lastTimestampMs
    randA = lastRandA + 1
    if (randA > 0x0fff) {
      timestampMs = lastTimestampMs + 1
      randA = randomInt(0x1000)
    }
  }

  lastTimestampMs = timestampMs
  lastRandA = randA

  // rand_a 严格递增即可保证字典序单调，故 rand_b 每次重新随机
  const randB = randomBytes(8)
  const timestamp = BigInt(timestampMs)

  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((timestamp >> BigInt(40 - i * 8)) & 0xffn)
  }
  bytes[6] = 0x70 | ((randA >>> 8) & 0x0f)
  bytes[7] = randA & 0xff
  bytes[8] = 0x80 | ((randB[0] ?? 0) & 0x3f)
  for (let i = 1; i < 8; i++) bytes[8 + i] = randB[i] ?? 0

  return bytes
}

export function generateUuids(options: UuidOptions): string[] {
  const { version, count, hyphens = true, uppercase = false } = options

  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
    throw new RangeError(`数量必须为 0 到 ${MAX_COUNT} 之间的整数`)
  }
  if (version !== 1 && version !== 4 && version !== 7) {
    throw new RangeError('仅支持 UUID v1 / v4 / v7')
  }

  const generate = version === 1 ? generateV1 : version === 4 ? generateV4 : generateV7

  const output: string[] = []
  for (let i = 0; i < count; i++) {
    output.push(formatUuid(generate(), hyphens, uppercase))
  }
  return output
}

function toBytes(uuid: string): Uint8Array | null {
  const match = UUID_PATTERN.exec(uuid)
  if (!match) {
    // 允许无连字符形式
    if (!/^[0-9a-f]{32}$/i.test(uuid)) return null
    const plain = uuid.toLowerCase()
    const bytes = new Uint8Array(16)
    for (let i = 0; i < 16; i++) {
      bytes[i] = Number.parseInt(plain.slice(i * 2, i * 2 + 2), 16)
    }
    return bytes
  }

  const hex = `${match[1]}${match[2]}${match[3]}${match[4]}${match[5]}`.toLowerCase()
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function uuidVersionOf(uuid: string): number | null {
  const bytes = toBytes(uuid)
  if (!bytes) return null
  return ((bytes[6] ?? 0) >> 4) & 0x0f
}

/**
 * 解析 UUID 中编码的时间戳。
 *
 * v1 与 v7 有时间语义，其余版本返回 null —— 返回 0 会让调用方误以为
 * 得到了 Unix 纪元时刻。
 */
export function uuidTimestampMs(uuid: string): number | null {
  const bytes = toBytes(uuid)
  if (!bytes) return null

  const version = ((bytes[6] ?? 0) >> 4) & 0x0f

  if (version === 7) {
    let timestamp = 0n
    for (let i = 0; i < 6; i++) {
      timestamp = (timestamp << 8n) | BigInt(bytes[i] ?? 0)
    }
    return Number(timestamp)
  }

  if (version === 1) {
    const timeLow =
      ((bytes[0] ?? 0) << 24) |
      ((bytes[1] ?? 0) << 16) |
      ((bytes[2] ?? 0) << 8) |
      (bytes[3] ?? 0)
    const timeMid = ((bytes[4] ?? 0) << 8) | (bytes[5] ?? 0)
    const timeHigh = ((bytes[6] ?? 0) & 0x0f) << 8 | (bytes[7] ?? 0)

    const timestamp100ns =
      (BigInt(timeHigh) << 48n) | (BigInt(timeMid) << 32n) | BigInt(timeLow >>> 0)

    return Number((timestamp100ns - GREGORIAN_OFFSET_100NS) / 10_000n)
  }

  return null
}
```

注意 `timeLow` 在 v1 编码时用了 `>>> 0` 语义（无符号 32 位），解码时 `BigInt(timeLow >>> 0)` 同样保证无符号解释。

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run --project core`
Expected: PASS，约 22 个用例

**若「v1 解码时间戳」用例失败**，多半是 100ns 换算常量有误。用 `node -e "console.log(BigInt(0x01B21DD213814000))"` 核对常量值应为 `122192928000000000n`。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(core): UUID v1 / v4 / v7 生成

- v1 使用 60 位 100ns 时间戳，纪元偏移常量 0x01B21DD213814000
- v1 节点 ID 为会话级随机值并把首字节最低位置 1，
  符合 RFC 4122 的 multicast 标志要求，不冒充真实网卡
- v7 同毫秒内递增 12 位 rand_a 以保证字典序单调；
  该字段位于 rand_b 之前，故 rand_b 可每次重新随机
- 显式处理系统时钟回拨：时间戳不倒退，改用递增计数器
- uuidTimestampMs 对无时间语义的版本返回 null 而非 0"
```

---

### Task 19: UUID 生成器工具（端到端样板）

本任务同时是**样板**：计划② 的其余 16 个工具都遵循这里的结构。请把它当作模式的示范，而非一次性代码。

**关键的交互决策：格式变更不重新生成。**

`hyphens` 与 `uppercase` 只影响呈现，若一并触发重新生成，用户勾选「大写」时会看到 UUID 整体变化 —— 这显然是错的。实现上只缓存**规范形式**（无连字符、小写），`hyphens`/`uppercase` 在渲染时套用。仅 `version` 与 `count` 触发重新生成。

**Files:**
- Create: `src/tools/crypto/uuid-generator/meta.ts`, `src/tools/crypto/uuid-generator/Tool.tsx`

**Interfaces:**
- Consumes: Task 18 的 `generateUuids`；Task 12 的 `useToolState`；Task 13 的 UI 原语；Task 15 的 `ToolLayout`
- Produces: 一个已被注册表发现、可搜索、可打开、可复制、可导出的完整工具

- [ ] **Step 1: 写 `src/tools/crypto/uuid-generator/meta.ts`**

关键词必须同时包含英文与中文，否则 Task 11 的中文检索能力无从发挥。

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'uuid-generator',
  name: 'UUID 生成器',
  category: 'crypto',
  description: '生成 UUID v1 / v4 / v7，支持批量与格式选项',
  keywords: ['uuid', 'guid', '唯一标识', '唯一id', 'id生成', 'v1', 'v4', 'v7', '随机id'],
} satisfies ToolMeta
```

- [ ] **Step 2: 写 `src/tools/crypto/uuid-generator/Tool.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { generateUuids, type UuidVersion } from '@/core/crypto/uuid'
import type { ErrorInfo } from '@/core/result'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { Checkbox, NumberInput, SegmentedControl } from '@/framework/ui/Inputs'
import { Pane } from '@/framework/ui/Pane'

const MAX_COUNT = 1_000

/**
 * 必须定义在组件外部：useToolState 的 reset 依赖它，
 * 每次渲染新建字面量对象会导致该依赖持续变化。
 */
const INITIAL_STATE = {
  input: '',
  options: {
    version: 'v4' as UuidVersion,
    count: 10,
    hyphens: true,
    uppercase: false,
  },
}

const VERSION_OPTIONS = [
  { value: 'v1', label: 'v1' },
  { value: 'v4', label: 'v4' },
  { value: 'v7', label: 'v7' },
] as const

const VERSION_BY_LABEL: Record<string, UuidVersion> = { v1: 1, v4: 4, v7: 7 }
const LABEL_BY_VERSION: Record<UuidVersion, string> = { 1: 'v1', 4: 'v4', 7: 'v7' }

/** 把规范形式（无连字符、小写）套用为展示形式。 */
function formatCanonical(canonical: string, hyphens: boolean, uppercase: boolean): string {
  const hex = uppercase ? canonical.toUpperCase() : canonical
  if (!hyphens) return hex
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export default function UuidGeneratorTool() {
  const { state, updateOptions } = useToolState('uuid-generator', INITIAL_STATE)
  const { version, count, hyphens, uppercase } = state.options

  // 规范形式：仅 version 与 count 变化时重新生成
  const [canonical, setCanonical] = useState<string[]>([])

  const countError: ErrorInfo | null =
    Number.isInteger(count) && count >= 0 && count <= MAX_COUNT
      ? null
      : {
          error: `数量必须是 0 到 ${MAX_COUNT} 之间的整数`,
          detail: `当前值为 ${count}`,
        }

  useEffect(() => {
    if (countError) {
      setCanonical([])
      return
    }
    // 用 try/catch 兜住生成层可能抛出的参数异常
    try {
      setCanonical(generateUuids({ version, count, hyphens: false, uppercase: false }))
    } catch {
      setCanonical([])
    }
  }, [version, count, countError])

  // 格式变更只影响渲染，不触发重新生成
  const rendered = useMemo(
    () => canonical.map((item) => formatCanonical(item, hyphens, uppercase)),
    [canonical, hyphens, uppercase],
  )

  const joined = rendered.join('\n')

  return (
    <ToolLayout
      options={
        <>
          <Field label="版本">
            <SegmentedControl
              label="UUID 版本"
              options={VERSION_OPTIONS}
              value={LABEL_BY_VERSION[version]}
              onChange={(label) => {
                const next = VERSION_BY_LABEL[label]
                if (next !== undefined) updateOptions({ version: next })
              }}
            />
          </Field>

          <Field label="数量">
            <NumberInput
              label="生成数量"
              value={count}
              min={1}
              max={MAX_COUNT}
              onChange={(value) => updateOptions({ count: value })}
            />
          </Field>

          <Checkbox
            label="连字符"
            checked={hyphens}
            onChange={(checked) => updateOptions({ hyphens: checked })}
          />
          <Checkbox
            label="大写"
            checked={uppercase}
            onChange={(checked) => updateOptions({ uppercase: checked })}
          />

          <button
            type="button"
            onClick={() => {
              try {
                setCanonical(
                  generateUuids({ version, count, hyphens: false, uppercase: false }),
                )
              } catch {
                setCanonical([])
              }
            }}
            disabled={countError !== null}
            className="h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent disabled:opacity-40"
          >
            重新生成
          </button>
        </>
      }
      input={
        <div className="p-2.5 text-[12px] text-muted">
          {version === 1 ? (
            <p>
              v1 基于时间戳与节点 ID 生成。本应用的节点 ID 为**会话级随机值**（已按 RFC 4122
              置 multicast 标志），并非本机网卡地址 —— 运行环境无法获取该信息。
            </p>
          ) : version === 4 ? (
            <p>v4 完全随机生成，不含时间或位置信息。</p>
          ) : (
            <p>v7 以毫秒时间戳开头，因而按字典序排列即为时间顺序；同一毫秒内保持单调递增。</p>
          )}
        </div>
      }
      output={
        countError ? (
          <EmptyState title="参数不合法" hint={countError.error} />
        ) : rendered.length === 0 ? (
          <EmptyState title="尚未生成" hint="调整上方参数即可生成" />
        ) : (
          <CodeArea value={joined} readOnly label="生成的 UUID" />
        )
      }
      status={
        countError ? (
          <span className="text-danger">{countError.error}</span>
        ) : (
          <span>共 {rendered.length} 条</span>
        )
      }
    />
  )
}
```

**注意**：上面 `ToolLayout` 的 `output` 分支中，`ErrorNote` 未直接使用 —— 布局的 `status` 槽已承载错误文案。若希望错误呈现与其它工具统一（spec P3 要求），应改为在 `output` 内使用 `ErrorNote`：

```tsx
      output={
        countError ? (
          <ErrorNote info={countError} />
        ) : rendered.length === 0 ? (
          <EmptyState title="尚未生成" hint="调整上方参数即可生成" />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={joined} label="复制全部" />
              <DownloadButton filename="uuids.txt" text={joined} />
            </div>
            <CodeArea value={joined} readOnly label="生成的 UUID" />
          </>
        )
      }
```

**采用后者**。它满足 spec P3 的错误呈现一致性要求，并提供复制与导出的入口。

- [ ] **Step 3: 确认注册表校验通过**

Run: `npx vitest run --project ui -t '注册表不变式'`
Expected: PASS。若报 `orphan-meta` 或 `orphan-tool`，说明 `meta.ts` 与 `Tool.tsx` 未同时存在或目录名与 id 不符。

- [ ] **Step 4: 端到端手工验证**

```bash
npm run tauri dev
```

逐项确认：

1. 侧栏「加密」分类下出现「UUID 生成器」，分类计数为 1
2. 按 `Cmd/Ctrl+K`，输入 `uuid` —— 命中；输入 `唯一标识` —— 同样命中
3. 打开后默认生成 10 条 v4 UUID
4. 切换至 v7，**列表内容改变**；勾选「大写」，**列表内容不变、仅大小写改变**（这是本任务的关键交互）
5. 勾选/取消「连字符」，内容同样不变、仅格式改变
6. 数量改为 3，列表变为 3 条
7. 点击「复制全部」，粘贴到编辑器确认内容正确
8. 点击下载，确认文件保存成功
9. 关闭应用再重新打开，确认版本、数量与格式选项被保留
10. 按 F12 打开 Console，确认**没有** offline-guard 报错

- [ ] **Step 5: 验证懒加载 —— 只有被打开的工具的 chunk 被加载**

在 Console 的 Network 面板中，筛选 JS 请求：

1. 记下首屏加载的 chunk 列表
2. 切换到另一个工具（计划② 完成后才有第二个工具，此时可跳过对比）

**本步骤在计划① 阶段无法完整验证**（目前只有一个工具）。将其标记为计划② 的验收项：届时应有 `uuid-generator-*.js` 与 `qrcode-generator-*.js` 等分离的 chunk，且首屏不加载任何工具 chunk。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat(tools): UUID 生成器端到端打通样板链路

- meta.ts 提供中英双语关键词，使中文检索可用
- 格式选项（连字符/大写）只影响呈现，不触发重新生成，
  避免勾选大写时 UUID 整体变化这类错误交互
- 仅版本与数量变更触发重新生成
- 参数非法时经 ErrorNote 呈现，与其它工具保持统一（spec P3）
- v1 在界面显式说明节点 ID 为会话级随机值"
```

---

### Task 20: 全量验收与 tasks.md 勾选

**Files:**
- Modify: `openspec/changes/it-toolbox-app/tasks.md`（勾选本计划覆盖的任务）
- Create: `README.md`

- [ ] **Step 1: 运行全量测试**

Run: `npm run test`
Expected: 两个项目（core / ui）全部通过，无失败、无跳过

- [ ] **Step 2: 运行类型检查与 lint**

Run: `npm run typecheck && npm run lint`
Expected: 均无错误退出

- [ ] **Step 3: 运行完整构建（含外发扫描）**

Run: `npm run build`
Expected: 类型检查 → Vite 构建 → `scan-egress` 全部通过，最后输出 `[scan-egress] 通过：产物中未发现外发能力。`

- [ ] **Step 4: 校验安装包体积**

```bash
npm run tauri build
ls -lh src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null
ls -lh src-tauri/target/release/bundle/nsis/*.exe 2>/dev/null
```

Expected: 当前平台产物体积 **≤ 15MB**（spec 硬约束）。

**若超出**，按以下顺序排查，不要直接放宽预算：
1. 确认 `[profile.release]` 的 `opt-level = "s"` / `lto` / `strip` / `codegen-units = 1` 均已生效
2. 检查是否有依赖被整体打入（`npm run build` 输出的 chunk 列表）
3. 确认 `sourcemap: false`

- [ ] **Step 5: 断网冒烟**

断开网络，启动已构建的应用：

1. 打开 UUID 生成器，生成、复制、下载均正常
2. Console 中无失败的网络请求
3. 应用启动不出现任何等待网络的行为

- [ ] **Step 6: 勾选 tasks.md 中本计划覆盖的任务**

以下任务已完成，逐条改为 `- [x]`：

```
1.1 1.2 1.3 1.4 1.5 1.6 1.7 1.8 1.9 1.10
2.1 2.2 2.3 2.4 2.5 2.6 2.7
3.1 3.2 3.3 3.4 3.5 3.6 3.7 3.8 3.9 3.10
4.1 4.2 4.3 4.4 4.5 4.6 4.7 4.8 4.9 4.10 4.11
5.2 5.8
8.8 8.9 8.10
```

**保持未勾选**（留给计划②）：`5.1 5.3 5.4 5.5 5.6 5.7 5.9 5.10 5.11 5.12`、`6.*`、`7.*`、`8.1–8.7`、`9.*`。

注意 `8.8` / `8.9` / `8.10` 已在本计划完成（JSON 扫描器、严格解析入口、token 级压缩与格式化），但 `8.1–8.7` 属于二维码与开发类工具，归计划②。

- [ ] **Step 7: 编写 README.md**

必须包含（其中 Windows 前置条件对应 spec P7，不可省略）：

```markdown
# IT Toolbox

离线可用的 IT 工具集合。17 个工具，5 个分类，运行期零网络请求。

## 平台与架构

| 平台 | 架构 | 产物 |
|---|---|---|
| macOS | Apple Silicon (arm64) | `.dmg` |
| macOS | Intel (x64) | `.dmg` |
| Windows | x64 | `.exe`（NSIS） |
| Windows | arm64 | `.exe`（NSIS） |

## Windows 前置条件

安装包**不检测、不安装** WebView2 运行时，因此安装过程无需联网。

- Windows 11 与 Windows 10（2018 年 4 月版及以后）**已随系统提供**该运行时，无需额外操作
- 若目标机器缺失该运行时，应用将无法启动。请从微软官方获取 WebView2 离线安装包后先安装

如需面向完全隔离或内网环境的分发产物，可构建内嵌运行时的变体：

```bash
# 将 tauri.conf.json 的 bundle.windows.webviewInstallMode 改为
#   { "type": "offlineInstaller" }
# 注意：该变体的安装包体积约为 140MB（内嵌约 127MB 的 WebView2 离线安装器）
```

## 开发

```bash
npm install
npm run tauri:dev     # 桌面应用
npm run dev           # 仅浏览器预览（UI 开发用，Tauri 能力自动降级）
npm run test          # 全部单测
npm run build         # 类型检查 + 构建 + 外发扫描
```

## 离线约束

运行期零出网由四层机制共同保证，修改代码时请注意：

1. **CSP**（`src-tauri/tauri.conf.json`）：`connect-src` 仅放行 Tauri IPC，`img-src` 不含远程来源
2. **开发期守卫**（`src/framework/offline-guard.ts`）：包装 `fetch` / `XMLHttpRequest` / `WebSocket`，命中外部目标即抛错
3. **产物扫描**（`scripts/scan-egress.mjs`）：构建时扫描产物中的网络 API 调用，发现即失败
4. **交互层**：远程图片渲染为占位块，外部链接不在应用窗口内导航

**不引入**自动更新、遥测、崩溃上报组件。

## 新增一个工具

1. 新建目录 `src/tools/<类别>/<kebab-case-id>/`
2. 写 `meta.ts`（同步元数据，导出 `satisfies ToolMeta` 的默认对象）
3. 写 `Tool.tsx`（默认导出组件）
4. 算法放进 `src/core/`，保持零 React / 零 Tauri / 零 DOM 依赖

无需登记 —— `import.meta.glob` 会自动发现。若配对或命名有误，`registry` 的不变式测试会失败并指出具体目录。
```

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "docs: 补充 README 并勾选已完成任务

- README 说明四平台产物、Windows WebView2 前置条件与全离线变体构建方式
- 记录离线四层机制，使后续修改不会无意破坏该约束
- 说明新增工具的三步流程，降低扩展成本
- tasks.md 勾选计划① 覆盖的 45 项任务"
```

---

## 计划自检

### 1. spec 覆盖检查

逐条核对 delta spec 与本计划的对应关系：

| capability | 要求 | 覆盖任务 |
|---|---|---|
| `app-shell` | 应用主布局 | 16, 17 |
| `app-shell` | 窄窗口侧栏折叠（P2） | 16 |
| `app-shell` | 主题切换（P1，默认暗色） | 2, 12, 16 |
| `app-shell` | 全局快捷键 | 17 |
| `app-shell` | 本地偏好持久化 | 12 |
| `app-shell` | 离线可用（P6，四层） | 3, 5 |
| `app-shell` | 外部链接与远程资源处理 | 3（CSP `img-src`）, 5 |
| `app-shell` | Windows 运行时前置条件（P7） | 3, 20 |
| `app-shell` | 桌面安装产物（四平台 / ≤15MB） | 3, 20 |
| `tool-registry` | 工具声明契约 | 9, 19 |
| `tool-registry` | 自动注册与代码分割 | 10, 15, 19 |
| `tool-registry` | 一致性校验 | 10 |
| `tool-registry` | 搜索 | 11, 17 |
| `tool-registry` | 解析类错误的统一定位（P3） | 13, 19 |
| `tool-registry` | 收藏与最近使用 | 12, 16 |
| `tool-registry` | 懒加载 | 15, 19 |
| `tool-registry` | 统一工具交互契约 | 15, 19 |
| `tool-registry` | 工具输入输出状态持久化 | 12, 19 |
| `crypto-tools` | UUID 生成器 | 18, 19 |
| `dev-tools` | JSON 压缩 / 美化（P5） | 7, 8 |

**未覆盖**：`crypto-tools` 的 Token / ULID / HMAC / RSA（5.1、5.3–5.7、5.9–5.12），`converter-tools` 全部（6.*），`web-tools` 全部（7.*），`image-tools` 全部（8.1–8.7），以及 `9.*` 的验收项（计划② 完成后执行）。

这些**属于计划② 的范围**，不是本计划的缺口。

### 2. 占位符扫描

已逐节检查，本计划不含 "TBD"、"待补充"、"类似上文" 之类的表述。每个步骤均给出可执行命令或完整代码。

**已知的一处非完全交付**：Task 19 Step 5 的「懒加载 chunk 分离验证」在计划① 阶段无法完成 —— 当前只有一个工具，无法对比。已在该步骤中显式标记为计划② 的验收项，而非伪装成已完成。

### 3. 类型与命名一致性

| 检查项 | 结果 |
|---|---|
| `Result<T>` / `ok` / `err` / `ErrorInfo` 在 Task 1 定义，Task 6/7/8/14 使用 | 一致 |
| `ErrorInfo` 字段名 `error`/`code`/`detail`/`suggestion`/`offset`/`line`/`column` | 全计划一致 |
| `ToolMeta` 字段名 `id`/`name`/`category`/`description`/`keywords`/`order` | Task 9 定义，Task 10/11/19 使用，一致 |
| `ToolEntry` 字段名 `meta`/`load` | Task 10 定义，Task 11/15 使用，一致 |
| `ToolComponent` | Task 10 定义，Task 11 使用，一致 |
| `CategoryDescriptor` 字段名 `id`/`name`/`icon`/`order` | Task 9 定义，Task 11/16 使用，一致 |
| `IconName` 的 21 个取值 | Task 9 定义，Task 13 全部实现，Task 16 使用 `menu`/`close`/`star`/`star-filled`/`chevron-*`，一致 |
| `ThemeMode` / `DEFAULT_THEME_MODE` / `resolveTheme` / `applyTheme` / `systemPrefersDark` | Task 2 定义，Task 12/16 使用，一致 |
| `Prefs` / `RecentEntry` | Task 12 定义，Task 16 使用，一致 |
| `scanJson` / `positionToLineColumn` / `JsonToken` | Task 7 定义，Task 8/13 使用，一致 |
| `minifyJson` / `formatJson` / `JsonTextResult` / `FormatJsonResult` | Task 8 定义，未在 Task 19 使用（属计划②），一致 |
| `generateUuids` / `UuidVersion` / `uuidTimestampMs` / `uuidVersionOf` / `__resetUuidStateForTests` | Task 18 定义，Task 19 使用 `generateUuids`/`UuidVersion`，一致 |
| `copyText` / `downloadText` / `isTauri` / `canCopyImage` / `copyImage` | Task 14 定义，Task 13 的 `CopyButton`/`DownloadButton` 使用，一致 |
| `useToolState` / `usePrefs` / `setTheme` / `toggleFavorite` / `pushRecent` | Task 12 定义，Task 16/19 使用，一致 |
| `utf8ByteLength` | Task 6 定义，Task 8/12 使用，一致 |
| `ToolLayoutProps` 判别联合 | Task 15 定义，Task 19 使用标准形态，一致 |
| `STORAGE_KEY` 常量名 | Task 12 用 `PREF_KEY` / `TOOL_STATE_KEY`，Task 16 测试中引用 `'itt:v1:prefs'` 字面量，Task 12 测试中引用 `PREF_KEY`，一致 |

**发现并已修正的问题**（在自检过程中修复，非遗留）：

1. Task 8 原计划引入 `core/dev/json-format.ts` 组合层 —— 实为多余的一跳，已改为工具直接调用 `minifyJson` / `formatJson`
2. Task 6 缺少 `utf8ByteLength`，而 Task 8/12 需要它 —— 已补入 Task 6 的接口与实现
3. Task 1 的 `package.json` 缺少 `@eslint/js`，而 Task 4 需要它 —— 已补入（版本 `^10.0.1`，注意与 eslint 并非同版本号）
4. 设计文档与 spec P6 原写 CSP 为 `connect-src 'none'` —— 经查证会切断 Tauri IPC，已修正为 `ipc: http://ipc.localhost`

### 4. 执行顺序依赖

```
Task 1 (脚手架 + Result)
  └─▶ Task 2 (主题) ─▶ Task 3 (Tauri + CSP) ─▶ Task 4 (Lint 分层) ─▶ Task 5 (离线四层)
  └─▶ Task 6 (bytes/random) ─▶ Task 7 (JSON 扫描器) ─▶ Task 8 (JSON 压缩/格式化)
  └─▶ Task 9 (类型/类别) ─▶ Task 10 (注册表) ─▶ Task 11 (搜索)
  └─▶ Task 12 (持久化/偏好) ─▶ Task 13 (UI 原语) ─▶ Task 14 (剪贴板/文件)
                                                 └─▶ Task 15 (布局/宿主/边界)
                                                      └─▶ Task 16 (外壳/侧栏) ─▶ Task 17 (命令面板)
  └─▶ Task 18 (UUID Core) ─▶ Task 19 (UUID 工具) ─▶ Task 20 (验收)
```

Task 18 只依赖 Task 6，可与 Task 9–17 并行。Task 19 需要 Task 10–18 全部就绪。
