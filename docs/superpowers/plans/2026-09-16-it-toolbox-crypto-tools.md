---
change: it-toolbox-app
design-doc: docs/superpowers/specs/2026-09-15-it-toolbox-design.md
base-ref: 984fead5bd269b5767f4e3bd6d8eac76bee5d26a
---

# IT Toolbox 加密工具集 实施计划（计划②-1 / 共 4 份）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付加密类别下剩余的 4 个工具（Token 生成器、ULID 生成器、HMAC 生成器、RSA 密钥对生成器）及其 Core 层实现与测试，使 `tasks.md` 第 5 组全部闭合。

**Architecture:** 沿用计划① 已证实的模式：算法落在 `core/`（纯函数、零 React / 零 Tauri / 零 DOM，在 Node 环境毫秒级可测），呈现交给 `framework/` 的 `ToolLayout` + `useToolState` + `ui/*` 原语，工具本身只有 `meta.ts`（同步元数据）+ `Tool.tsx`（懒加载组件）两个文件，由 `import.meta.glob` 自动注册。**本计划不新增任何运行时依赖**：HMAC 与 RSA 走 WebCrypto（`crypto.subtle`），PKCS#1 与 OpenSSH 公钥由自写 DER 写入器（约 60 行）组装。

**Tech Stack:** 沿用现有栈 —— Tauri 2.11 · React 19.3 · TypeScript · Vite · Vitest（`core` 用 node 环境 / `ui` 用 jsdom）· Tailwind CSS。WebCrypto 由 Node 23 与各 WebView 原生提供。

**Spec:** `openspec/changes/it-toolbox-app/specs/crypto-tools/spec.md`（本计划实现其中 Token / ULID / HMAC / RSA 四个 Requirement 的全部 Scenario；UUID 部分已由计划① 交付）+ `docs/superpowers/specs/2026-09-15-it-toolbox-design.md` §3.5 / §3.6 / §3.7 / §8.4

**本计划的范围：** 对应 `tasks.md` 的 5.1、5.3、5.4、5.5、5.6、5.7、5.9、5.10、5.11、5.12（10 项）。**不含** 5.2 / 5.8（计划① 已交付 UUID）与其余 16 个工具（由计划②-2 / ②-3 / ②-4 承接）。

---

## Global Constraints

以下约束隐含适用于**每一个任务**，不再逐条重复。

| 约束 | 精确值 |
|---|---|
| 分层依赖 | `core/` 不得 import React、Tauri、DOM API；`core/` 不得 import `framework/`、`tools/`、`app/`；`tools/` 不得被 `framework/` 感知 |
| 新增依赖 | **零新增**。禁止 `node-forge` / `asn1.js` / `crypto-js` / `uuid` / `ulid` 等任何第三方加密或编码库；禁止图标库、UI 组件库、Web 字体 |
| 随机源 | 只用 `src/core/random.ts` 的 `randomBytes` / `randomInt` / `pickChars`（内部走 `crypto.getRandomValues`）。**禁止 `Math.random`** |
| 运行期网络行为 | **零出网请求**。WebCrypto 的 `crypto.subtle` 是纯本地运算，不产生请求；不得引入任何会主动联网的能力 |
| 单平台安装包体积 | **≤ 15MB**（本计划不新增依赖，故不改变体积量级；计划① 实测 2.2MB） |
| `core` 层测试环境 | `node`（`vitest.config.ts` 的 `core` project，`include: ['src/core/**/*.test.ts']`）。Node 23 原生提供 `crypto.subtle` 与 `TextEncoder` |
| `tools` 层测试环境 | `jsdom`（`ui` project 的 `include` 已含 `src/tools/**/*.test.{ts,tsx}` —— 计划① 的 R84 修复，勿再质疑该 glob） |
| 生成类函数的错误约定 | 生成类（token / ulid / hmac / rsa）的输入由控件约束，**参数非法时抛 `RangeError`**，由工具层 `try/catch` 后以 `ErrorNote` 呈现 —— 与 `core/crypto/uuid.ts` 的既有约定一致。**不要**给生成类改用 `Result<T>`（`core/result.ts` 的文件头注释已写明该边界） |
| 解析类函数的错误约定 | 若某步需要「非法输入是常规路径」的返回，用 `Result<T>` + `ok`/`err`（见 `core/result.ts`） |
| 界面文案与视觉 | UI 字号 13px、代码区 12.5px 等宽、圆角 4px、无阴影（浮层除外）；所有参数控件用 `framework/ui` 原语，不手写 `<select>` / `<input>` |
| 中文文案 | 界面文案一律中文；`keywords` 同时含英文与中文关键词（如 `['hmac', 'sha256', '签名', '摘要']`） |
| 工具 id | 与目录名严格一致、kebab-case；`registry.test.ts` 会强制校验，写错即测试失败 |

### 版本与 API 事实（已于 2026-09-16 核实，勿臆改）

- `core/random.ts` 导出：`randomBytes(length): Uint8Array`、`randomInt(maxExclusive): number`、`pickChars(alphabet: string, count: number): string`。`pickChars` 内部用 `[...alphabet]` 计数，故**重复字符会被算两次**，调用前须自行去重（见 Task 1 的 `resolveCharset`）
- `core/bytes.ts` 导出：`utf8ToBytes`、`bytesToUtf8`(→`Result<string>`)、`bytesToHex(bytes, upper?)`、`utf8ByteLength`、`hexToBytes`(→`Result<Uint8Array>`)、`bytesToBase64(bytes, {variant,padding})`、`base64ToBytes(input)`(→`Result<Uint8Array>`)。
  **`hexToBytes` 在非法输入时返回 `Result` 而非抛错** —— HMAC 的密钥/消息编码校验必须检查 `result.ok`，不能只看抛错
- `framework/ui/index.ts` 已导出：`CodeArea`（`value`/`onChange`/`readOnly`/`label`/`placeholder`/`rows`/`errorLine`/`errorOffset`）、`CopyButton`（`text`/`label`/`disabled`）、`DownloadButton`（`filename`/`text`/`mime`/`label`/`disabled`）、`EmptyState`、`ErrorNote`（`info: ErrorInfo`）、`Field`（`label`/`hint`/`children`）、`Icon`、`Checkbox` / `ColorInput` / `NumberInput` / `SegmentedControl` / `Select` / `ToolbarRow`、`Pane`、`Spinner`
- `ToolLayout` 的判别联合：标准形态传 `input` + `output`；自由形态传 `body`。本计划 4 个工具**全部使用标准形态**（`input` 可为空，如 RSA 的生成按钮放在 `options` 里）
- `useToolState(toolId, initial)` 返回 `{ state, update, updateOptions, reset }`；`initial` **必须定义在组件外部**（否则 `reset` 的依赖每次渲染都变）
- **依赖必须是原始值**：`useToolState` / `useEffect` 的依赖里不得出现每次渲染新建的对象或数组（计划① 的 R16 实测过无限渲染循环导致界面卡死、测试进程挂起 15 分钟）
- `CodeArea` 在 `readOnly` 时渲染**行号列表**（不是 textarea）；测试中读值要按 `listitem` 取，不能按 textarea 取

### 实现者须知（本仓库与本环境的既有事实，避免重复踩坑）

1. **测试输出会被执行环境吞掉**：`npm test` 的 stdout 可能被当作长驻服务丢弃。请把输出重定向到日志文件再用读取工具查看，例如
   `npm test > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-<task>.log 2>&1; echo "exit=$?"`
2. **单文件测试**用 `npx vitest run --project core src/core/crypto/token.test.ts`（`core` 是项目名，不是路径）
3. **变异检验一律「一变一命令」**：落一处变异 → 单独一条命令跑测试 → 逐次核对「失败的用例名 == 预期目标」→ 用编辑工具反向还原（**不要用 `git checkout` 还原**：对未提交文件会整条命令失败，对已提交文件会丢掉未提交的修复）
4. **评审派发**：只读子代理，提示内限定「最多 12 次工具调用、不要整读计划文件、报告 ≤ 2500 字符」，否则报告会被截断或整条被中断
5. **每完成一个任务立即提交**，提交信息说明该任务对应的 `tasks.md` 编号

---

## File Structure

```
it-tool/
├── src/core/
│   ├── der.ts                              【新】DER 最小写入器（INTEGER / BIT STRING / SEQUENCE / NULL）
│   ├── der.test.ts                         【新】表驱动 + 独立读取器互校
│   ├── ssh-key.ts                          【新】OpenSSH 单行公钥（string / mpint 组装）
│   ├── ssh-key.test.ts                     【新】
│   └── crypto/
│       ├── token.ts                        【新】随机 Token 生成（5 个字符集 + 前缀 + 批量）
│       ├── token.test.ts                   【新】
│       ├── ulid.ts                         【新】Crockford Base32 + 同毫秒单调
│       ├── ulid.test.ts                    【新】
│       ├── hmac.ts                         【新】WebCrypto HMAC + 三种编码 × 四种算法
│       ├── hmac.test.ts                    【新】
│       ├── rsa.ts                          【新】WebCrypto RSA 生成 + JWK → PEM 全套
│       └── rsa.test.ts                     【新】三层交叉验证（§8.4）
├── src/tools/crypto/
│   ├── token-generator/{meta.ts, Tool.tsx, Tool.test.tsx}    【新】
│   ├── ulid-generator/{meta.ts, Tool.tsx, Tool.test.tsx}     【新】
│   ├── hmac-generator/{meta.ts, Tool.tsx, Tool.test.tsx}     【新】
│   └── rsa-keypair/{meta.ts, Tool.tsx, Tool.test.tsx}        【新】
└── openspec/changes/it-toolbox-app/tasks.md                  【改】Task 11 勾选 5.1 / 5.3–5.7 / 5.9–5.12
```

**为何 `der.ts` 与 `ssh-key.ts` 放在 `core/` 根而不是 `core/crypto/`**：它们是**编码器**（字节组装），与 `bytes.ts` 同级；`core/crypto/` 只放「需要密码学语义」的模块。二者仅被 `crypto/rsa.ts` 消费，但放在根上可被将来的 OpenSSH 相关工具复用。

**为何每个工具都要 `Tool.test.tsx`**：计划① 的 R85 教训 —— UUID 工具的无限渲染循环正是因为「手工验收 + 零 UI 自动化」的组合而漏掉。本计划 4 个工具全部有交互状态（参数变更、异步生成、错误提示），必须有渲染层用例兜住。

---

## 任务间接口约定（先读这一节，再看各任务）

本计划 10 个任务由不同实现者负责，彼此只能通过下列签名协作。**任何任务都不得自行改名。**

```ts
// src/core/crypto/token.ts
export type CharsetId = 'alphanumeric' | 'hex' | 'base64' | 'base64url' | 'custom'
export interface TokenOptions {
  length: number
  count: number
  charset: CharsetId
  custom?: string
  prefix?: string
}
export const ALPHANUMERIC: string
export const HEX_CHARSET: string
export const BASE64_CHARSET: string
export const BASE64URL_CHARSET: string
export const MAX_LENGTH: number      // 4096
export const MAX_COUNT: number       // 1000
export const MAX_TOTAL_LENGTH: number // 100000
export function resolveCharset(charset: CharsetId, custom?: string): string
export function generateTokens(options: TokenOptions): string[]

// src/core/crypto/ulid.ts
export interface UlidOptions { count: number; uppercase?: boolean }
export const ULID_ALPHABET: string    // '0123456789ABCDEFGHJKMNPQRSTVWXYZ'（Crockford 去 I/L/O/U）
export const MAX_COUNT: number        // 1000
export function generateUlids(options: UlidOptions): string[]
export function decodeUlidTimestamp(ulid: string): number | null
export function __resetUlidStateForTests(): void

// src/core/crypto/hmac.ts
export type HmacAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'
export type InputEncoding = 'utf8' | 'hex' | 'base64'
export type OutputEncoding = 'hex' | 'base64' | 'base64url'
export interface HmacOptions {
  message: string
  key: string
  algorithm: HmacAlgorithm
  messageEncoding: InputEncoding
  keyEncoding: InputEncoding
  outputEncoding: OutputEncoding
}
export function decodeInput(text: string, encoding: InputEncoding): Result<Uint8Array>
export function computeHmac(options: HmacOptions): Promise<Result<string>>

// src/core/der.ts
export function derInteger(bytes: Uint8Array): Uint8Array
export function derBitString(bytes: Uint8Array): Uint8Array
export function derSequence(children: Uint8Array[]): Uint8Array
export function derNull(): Uint8Array
export function derLength(length: number): Uint8Array
export function bytesToPem(bytes: Uint8Array, label: string): string

// src/core/ssh-key.ts
export function sshRsaPublicKey(modulus: Uint8Array, exponent: Uint8Array): string
export function sshString(bytes: Uint8Array): Uint8Array
export function sshMpint(bytes: Uint8Array): Uint8Array

// src/core/crypto/rsa.ts
export type RsaKeySize = 1024 | 2048 | 3072 | 4096
export type PrivateKeyFormat = 'pkcs1' | 'pkcs8'
export type PublicKeyFormat = 'spki' | 'pkcs1' | 'openssh'
export interface RsaKeyPair {
  publicKey: string
  privateKey: string
  algorithm: 'RSASSA-PKCS1-v1_5'
  keySize: RsaKeySize
  generatedAt: number
}
export interface RsaOptions {
  keySize: RsaKeySize
  privateKeyFormat: PrivateKeyFormat
  publicKeyFormat: PublicKeyFormat
}
export function generateRsaKeyPair(options: RsaOptions): Promise<RsaKeyPair>
```

---

### Task 1: `core/crypto/token.ts` —— 随机 Token 生成

对应 `tasks.md` **5.1**；满足 delta spec 的 Requirement「Token 生成器」的 6 个 Scenario。

**Files:**
- Create: `src/core/crypto/token.ts`
- Test: `src/core/crypto/token.test.ts`

**Interfaces:**
- Consumes: `pickChars(alphabet, count)` from `../random`（相对路径 —— `core/` 内部沿用 `crypto/uuid.ts` 的既有写法，不走上层别名）
- Produces: `CharsetId`、`TokenOptions`、`ALPHANUMERIC` / `HEX_CHARSET` / `BASE64_CHARSET` / `BASE64URL_CHARSET`、`MAX_LENGTH` / `MAX_COUNT` / `MAX_TOTAL_LENGTH`、`resolveCharset(charset, custom?)`、`generateTokens(options): string[]`。Task 7 的 Token 工具将消费 `generateTokens` / `resolveCharset` 与 4 个字符集常量

- [ ] **Step 1: 写失败测试**

创建 `src/core/crypto/token.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALPHANUMERIC,
  BASE64_CHARSET,
  BASE64URL_CHARSET,
  HEX_CHARSET,
  MAX_LENGTH,
  generateTokens,
  resolveCharset,
} from './token'

afterEach(() => {
  vi.restoreAllMocks()
})

const DEFAULT_OPTIONS = { length: 32, count: 1, charset: 'alphanumeric' } as const

describe('resolveCharset', () => {
  it('返回四个内置字符集', () => {
    expect(resolveCharset('alphanumeric')).toBe(ALPHANUMERIC)
    expect(resolveCharset('hex')).toBe(HEX_CHARSET)
    expect(resolveCharset('base64')).toBe(BASE64_CHARSET)
    expect(resolveCharset('base64url')).toBe(BASE64URL_CHARSET)
  })

  it('自定义字符集去除重复字符', () => {
    expect(resolveCharset('custom', 'aabbc')).toBe('abc')
  })

  it('自定义字符集为空（含全空白）时抛 RangeError', () => {
    expect(() => resolveCharset('custom', '')).toThrow(RangeError)
    expect(() => resolveCharset('custom', '   ')).toThrow(RangeError)
  })

  it('自定义字符集去重后不足 2 个字符时抛 RangeError', () => {
    expect(() => resolveCharset('custom', 'aaa')).toThrow(RangeError)
  })
})

describe('generateTokens', () => {
  it('按默认参数生成一个 Token，长度与字符集均符合预期', () => {
    const tokens = generateTokens(DEFAULT_OPTIONS)

    expect(tokens).toHaveLength(1)
    expect(tokens[0]).toHaveLength(32)
    for (const char of tokens[0]!) expect(ALPHANUMERIC).toContain(char)
  })

  it('自定义长度与字符集：长度 64、十六进制', () => {
    const [token] = generateTokens({ length: 64, count: 1, charset: 'hex' })

    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('批量生成 5 个且互不相同', () => {
    const tokens = generateTokens({ length: 16, count: 5, charset: 'alphanumeric' })

    expect(tokens).toHaveLength(5)
    expect(new Set(tokens).size).toBe(5)
  })

  it('前缀加在随机段之前，且不计入 length', () => {
    const tokens = generateTokens({ length: 8, count: 3, charset: 'hex', prefix: 'sk_' })

    for (const token of tokens) {
      expect(token.startsWith('sk_')).toBe(true)
      expect(token.slice(3)).toMatch(/^[0-9a-f]{8}$/)
    }
  })

  it('base64 / base64url 的每个字符都来自各自字母表', () => {
    const b64 = generateTokens({ length: 200, count: 1, charset: 'base64' })[0]!
    for (const char of b64) expect(BASE64_CHARSET).toContain(char)

    const b64url = generateTokens({ length: 200, count: 1, charset: 'base64url' })[0]!
    for (const char of b64url) expect(BASE64URL_CHARSET).toContain(char)
    expect(b64url).not.toMatch(/[+/]/)
  })

  it('随机值来自 crypto.getRandomValues，不使用 Math.random', () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const mathRandom = vi.spyOn(Math, 'random')

    generateTokens(DEFAULT_OPTIONS)

    expect(getRandomValues).toHaveBeenCalled()
    expect(mathRandom).not.toHaveBeenCalled()
  })

  it('length 为 0、非整数或超上限时抛 RangeError', () => {
    expect(() => generateTokens({ length: 0, count: 1, charset: 'hex' })).toThrow(RangeError)
    expect(() => generateTokens({ length: 1.5, count: 1, charset: 'hex' })).toThrow(RangeError)
    expect(() =>
      generateTokens({ length: MAX_LENGTH + 1, count: 1, charset: 'hex' }),
    ).toThrow(RangeError)
  })

  it('count 为 0 时返回空数组，超上限或非整数时抛 RangeError', () => {
    expect(generateTokens({ length: 8, count: 0, charset: 'hex' })).toEqual([])
    expect(() => generateTokens({ length: 8, count: 1001, charset: 'hex' })).toThrow(RangeError)
    expect(() => generateTokens({ length: 8, count: 2.5, charset: 'hex' })).toThrow(RangeError)
  })

  it('单次生成的字符总数超上限时抛 RangeError', () => {
    // 4096 × 25 = 102400 > 100000
    expect(() => generateTokens({ length: MAX_LENGTH, count: 25, charset: 'hex' })).toThrow(
      RangeError,
    )
  })

  it('自定义字符集为空时抛 RangeError（供工具层捕获后提示）', () => {
    expect(() => generateTokens({ length: 8, count: 1, charset: 'custom', custom: '' })).toThrow(
      RangeError,
    )
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project core src/core/crypto/token.test.ts > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t1-fail.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t1-fail.log`

Expected: FAIL，报 `Failed to resolve import "./token"`（模块尚不存在）

- [ ] **Step 3: 写最小实现**

创建 `src/core/crypto/token.ts`：

```ts
import { pickChars } from '../random'

export type CharsetId = 'alphanumeric' | 'hex' | 'base64' | 'base64url' | 'custom'

export interface TokenOptions {
  /** 随机段长度（不含前缀） */
  length: number
  count: number
  charset: CharsetId
  /** 仅在 charset === 'custom' 时使用 */
  custom?: string
  /** 加在随机段之前，不计入 length */
  prefix?: string
}

export const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
export const HEX_CHARSET = '0123456789abcdef'
export const BASE64_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export const BASE64URL_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export const MAX_LENGTH = 4_096
export const MAX_COUNT = 1_000
/** 单次生成的随机字符总数上限：避免超大参数让界面长时间无响应。 */
export const MAX_TOTAL_LENGTH = 100_000

const BUILTIN_CHARSETS: Record<Exclude<CharsetId, 'custom'>, string> = {
  alphanumeric: ALPHANUMERIC,
  hex: HEX_CHARSET,
  base64: BASE64_CHARSET,
  base64url: BASE64URL_CHARSET,
}

/**
 * 解析字符集。
 *
 * 自定义字符集**去重**：重复字符会让该字符被选中的概率成倍提高，密码学场景下这种
 * 偏斜不可接受。全空白视为空 —— 否则会产出肉眼不可见的 Token。
 *
 * 注意 `pickChars` 内部用 `[...alphabet]` 计数，重复字符会被算两次，故去重必须在这里完成，
 * 不能留给调用方。
 */
export function resolveCharset(charset: CharsetId, custom = ''): string {
  if (charset !== 'custom') return BUILTIN_CHARSETS[charset]

  if (custom.trim().length === 0) {
    throw new RangeError('自定义字符集不可为空')
  }

  const distinct = [...new Set([...custom])].join('')
  if (distinct.length < 2) {
    throw new RangeError('自定义字符集至少需要 2 个不同字符')
  }
  return distinct
}

export function generateTokens(options: TokenOptions): string[] {
  const { length, count, charset, custom = '', prefix = '' } = options

  if (!Number.isInteger(length) || length < 1 || length > MAX_LENGTH) {
    throw new RangeError(`长度必须为 1 到 ${MAX_LENGTH} 之间的整数`)
  }
  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
    throw new RangeError(`数量必须为 0 到 ${MAX_COUNT} 之间的整数`)
  }
  if (length * count > MAX_TOTAL_LENGTH) {
    throw new RangeError(`单次生成的字符总数不得超过 ${MAX_TOTAL_LENGTH}`)
  }

  const alphabet = resolveCharset(charset, custom)

  const output: string[] = []
  for (let i = 0; i < count; i++) {
    output.push(prefix + pickChars(alphabet, length))
  }
  return output
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project core src/core/crypto/token.test.ts > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t1-pass.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t1-pass.log`

Expected: PASS，14 个用例全绿，`exit=0`

- [ ] **Step 5: 跑门禁**

Run: `npm test > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t1-all.log 2>&1; echo "test=$?"; npm run typecheck > /dev/null 2>&1; echo "tc=$?"; npm run lint > /dev/null 2>&1; echo "lint=$?"; grep -aE "Test Files|Tests " .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t1-all.log | tail -2`

Expected: `test=0 tc=0 lint=0`，且用例总数为 **289 + 14 = 303**

- [ ] **Step 6: 提交**

```bash
git add src/core/crypto/token.ts src/core/crypto/token.test.ts
git commit -m "feat(crypto): 实现 Token 生成 Core（5.1）

- 5 个字符集：字母数字 / hex / base64 / base64url / 自定义
- 自定义字符集去重并拒绝空集，前缀不计入长度
- 逐字符走 randomInt 选取，保证长度精确且分布均匀
- 单次字符总数上限 100000，避免超大参数卡住界面"
```

---

### Task 2: `core/crypto/ulid.ts` —— ULID 生成与时间戳解码

对应 `tasks.md` **5.3**；满足 delta spec 的 Requirement「ULID 生成器」的 4 个 Scenario。

**Files:**
- Create: `src/core/crypto/ulid.ts`
- Test: `src/core/crypto/ulid.test.ts`

**Interfaces:**
- Consumes: `randomBytes(length)` from `../random`
- Produces: `UlidOptions`、`ULID_ALPHABET`、`MAX_COUNT`、`generateUlids(options): string[]`、`decodeUlidTimestamp(ulid): number | null`、`incrementRandom(bytes): boolean`、`__resetUlidStateForTests()`。Task 8 的 ULID 工具消费 `generateUlids` / `decodeUlidTimestamp`

**关键约束（设计文档 §3.6）**：同毫秒内生成多个时纯随机会让字典序不稳定。采用 RFC 9562 的**单调计数器法** —— 同毫秒内递增 80 位随机段，溢出则把时间戳 +1ms 并重新取随机。模块级状态，仅供测试重置。

- [ ] **Step 1: 写失败测试**

> **执行期偏离（2026-09-16，提交 `78b64f3` + 评审补齐提交）**：本步骤的代码块在执行时做了两处机械修正与 4 条补测，**以实际文件 `src/core/crypto/ulid.test.ts` 为准**：
> 1. `importOriginal<typeof import('../random')>()` 触发 `@typescript-eslint/consistent-type-imports`（禁止 `import()` 类型注解）⇒ 改为 `import type * as RandomModule from '../random'` + `importOriginal<typeof RandomModule>()`（与 `uuid.test.ts` 的既有写法一致）。
> 2. 实现里 `lastRandom` 必须显式标注类型：`let lastRandom: Uint8Array = new Uint8Array(RANDOM_BYTES)` —— `new Uint8Array(n)` 推出 `Uint8Array<ArrayBuffer>`，而 `randomBytes` 返回 `Uint8Array<ArrayBufferLike>`，不标注报 TS2322。
> 3. 补 4 条用例（评审指出原 15 条全是「用本模块 encode 校本模块 decode」的对称自校，编码方向无外部证据）：`与外部实现互操作` 2 条（时间部分钉 `01ARYZ6S41` = `1469918176385ms`，与 `ulid/javascript` 示例 ULID 前 10 字符一致；随机段钉固定字节向量，mock 增加 `fixedBytes` 入口）、`7ZZZZZZZZZ…` 解码为 `2^48-1`（ulid/spec 明示的最大合法 ULID）、非字符串输入返回 null。
> ⇒ 本任务用例数为 **19**（非 15），下游累计期望值已同步上移。

创建 `src/core/crypto/ulid.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_COUNT,
  ULID_ALPHABET,
  __resetUlidStateForTests,
  decodeUlidTimestamp,
  generateUlids,
  incrementRandom,
} from './ulid'

/**
 * 只替换 randomBytes：默认转发真实实现，需要时按标记返回全 0xff。
 * 溢出分支（80 位随机段全满）在真实随机下需要 2^80 次生成才可能触发，
 * 不引入这个可控入口就只能是一条永远不被执行的死代码。
 */
// vi.mock 的工厂函数会被提升到文件顶部，引用普通顶层变量会抛「Cannot access before
// initialization」—— 用 vi.hoisted 显式提升这份状态。
const mockRandom = vi.hoisted(() => ({ allBytesFull: false }))

vi.mock('../random', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../random')>()
  return {
    ...actual,
    randomBytes: (length: number) => {
      if (mockRandom.allBytesFull) return new Uint8Array(length).fill(0xff)
      return actual.randomBytes(length)
    },
  }
})

beforeEach(() => {
  mockRandom.allBytesFull = false
  __resetUlidStateForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ULID_ALPHABET', () => {
  it('是 32 个 Crockford 字符且不含易混的 I / L / O / U', () => {
    expect(ULID_ALPHABET).toHaveLength(32)
    expect(new Set(ULID_ALPHABET).size).toBe(32)
    for (const char of 'ILOU') expect(ULID_ALPHABET).not.toContain(char)
  })
})

describe('incrementRandom', () => {
  it('按大端加一', () => {
    const bytes = new Uint8Array([0x00, 0x00, 0xff])
    expect(incrementRandom(bytes)).toBe(true)
    expect([...bytes]).toEqual([0x00, 0x01, 0x00])
  })

  it('进位到最高字节', () => {
    const bytes = new Uint8Array([0xff, 0xff, 0xfe])
    expect(incrementRandom(bytes)).toBe(true)
    expect([...bytes]).toEqual([0xff, 0xff, 0xff])
  })

  it('全满时返回 false 且不回绕', () => {
    const bytes = new Uint8Array([0xff, 0xff, 0xff])
    expect(incrementRandom(bytes)).toBe(false)
    expect([...bytes]).toEqual([0x00, 0x00, 0x00])
  })
})

describe('generateUlids', () => {
  it('生成 26 个字符且全部属于 Crockford 字符集', () => {
    const [ulid] = generateUlids({ count: 1 })

    expect(ulid).toHaveLength(26)
    for (const char of ulid!) expect(ULID_ALPHABET).toContain(char)
  })

  it('默认输出大写，可切换为小写', () => {
    const [upper] = generateUlids({ count: 1 })
    expect(upper).toBe(upper!.toUpperCase())

    __resetUlidStateForTests()
    const [lower] = generateUlids({ count: 1, uppercase: false })
    expect(lower).toBe(lower!.toLowerCase())
  })

  it('内嵌时间戳与当前时间偏差在 2 秒以内', () => {
    const [ulid] = generateUlids({ count: 1 })
    const decoded = decodeUlidTimestamp(ulid!)

    expect(decoded).not.toBeNull()
    expect(Math.abs(decoded! - Date.now())).toBeLessThan(2_000)
  })

  it('批量 20 个互不相同', () => {
    const ulids = generateUlids({ count: 20 })

    expect(ulids).toHaveLength(20)
    expect(new Set(ulids).size).toBe(20)
  })

  it('同一毫秒内连续生成 200 个，字典序严格递增', () => {
    // 冻结时钟：让全部生成都落在同一毫秒，迫使单调计数器承担递增责任
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const ulids = generateUlids({ count: 200 })

    for (let i = 1; i < ulids.length; i++) {
      expect(ulids[i]! > ulids[i - 1]!).toBe(true)
    }
    expect(new Set(ulids).size).toBe(200)
  })

  it('系统时钟回拨时不产生倒退的时间戳，且仍然严格递增', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const [first] = generateUlids({ count: 1 })

    vi.spyOn(Date, 'now').mockReturnValue(1_699_999_990_000) // 倒退 10 秒
    const [second] = generateUlids({ count: 1 })

    expect(decodeUlidTimestamp(second!)).toBe(decodeUlidTimestamp(first!))
    expect(second! > first!).toBe(true)
  })

  it('随机段溢出时把时间戳 +1ms，不产生重复或倒退', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    mockRandom.allBytesFull = true
    const [first] = generateUlids({ count: 1 })

    mockRandom.allBytesFull = false
    const [second] = generateUlids({ count: 1 })

    expect(decodeUlidTimestamp(first!)).toBe(1_700_000_000_000)
    expect(decodeUlidTimestamp(second!)).toBe(1_700_000_000_001)
    expect(second! > first!).toBe(true)
  })

  it('count 为 0 时返回空数组，非整数或超上限时抛 RangeError', () => {
    expect(generateUlids({ count: 0 })).toEqual([])
    expect(() => generateUlids({ count: MAX_COUNT + 1 })).toThrow(RangeError)
    expect(() => generateUlids({ count: 1.5 })).toThrow(RangeError)
    expect(() => generateUlids({ count: -1 })).toThrow(RangeError)
  })
})

describe('decodeUlidTimestamp', () => {
  it('长度或字符非法时返回 null', () => {
    expect(decodeUlidTimestamp('')).toBeNull()
    expect(decodeUlidTimestamp('01ARZ3NDEKTSV4RRFFQ69G5FA')).toBeNull() // 25 字符
    // I / L / O / U 不在 Crockford 字符集内
    expect(decodeUlidTimestamp('I1ARZ3NDEKTSV4RRFFQ69G5FAV')).toBeNull()
  })

  it('时间部分超出 48 位时返回 null（10 个字符承载 50 位）', () => {
    expect(decodeUlidTimestamp('ZZZZZZZZZZ0000000000000000')).toBeNull()
  })

  it('大小写都能解码', () => {
    const [ulid] = generateUlids({ count: 1 })

    expect(decodeUlidTimestamp(ulid!.toLowerCase())).toBe(decodeUlidTimestamp(ulid!))
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project core src/core/crypto/ulid.test.ts > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t2-fail.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t2-fail.log`

Expected: FAIL，报 `Failed to resolve import "./ulid"`

- [ ] **Step 3: 写最小实现**

创建 `src/core/crypto/ulid.ts`：

```ts
import { randomBytes } from '../random'

export interface UlidOptions {
  count: number
  /** 默认 true：ULID 的规范写法是大写 */
  uppercase?: boolean
}

/** Crockford Base32：去掉易混的 I / L / O / U，共 32 个字符。 */
export const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export const MAX_COUNT = 1_000

/** 时间部分 10 字符 = 50 位，其中高位只承载 48 位真实时间戳。 */
const TIME_CHARS = 10
/** 随机部分 16 字符 = 80 位。 */
const RANDOM_CHARS = 16
const RANDOM_BYTES = 10
const ULID_LENGTH = 26

let lastTimestampMs = -1
let lastRandom = new Uint8Array(RANDOM_BYTES)

/** 仅供测试重置模块级状态。 */
export function __resetUlidStateForTests(): void {
  lastTimestampMs = -1
  lastRandom = new Uint8Array(RANDOM_BYTES)
}

/**
 * 把 80 位随机段按大端加一。
 *
 * 全满时返回 false 且把字节清零（**不回绕成 0 再返回 true**）—— 调用方据此把时间戳
 * +1ms，否则会产出与前一个重复或更小的 ULID，破坏 spec 的单调性要求。
 */
export function incrementRandom(bytes: Uint8Array): boolean {
  for (let i = bytes.length - 1; i >= 0; i--) {
    const next = (bytes[i] ?? 0) + 1
    if (next <= 0xff) {
      bytes[i] = next
      return true
    }
    bytes[i] = 0
  }
  return false
}

function encodeTimestamp(timestampMs: number): string {
  const out: string[] = new Array<string>(TIME_CHARS)
  let value = BigInt(timestampMs)
  for (let i = TIME_CHARS - 1; i >= 0; i--) {
    out[i] = ULID_ALPHABET.charAt(Number(value & 31n))
    value >>= 5n
  }
  return out.join('')
}

function encodeRandom(bytes: Uint8Array): string {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)

  let out = ''
  for (let i = 0; i < RANDOM_CHARS; i++) {
    out = ULID_ALPHABET.charAt(Number(value & 31n)) + out
    value >>= 5n
  }
  return out
}

/** 解码时间部分为毫秒级 Unix 时间戳；长度、字符或取值非法时返回 null。 */
export function decodeUlidTimestamp(ulid: string): number | null {
  if (typeof ulid !== 'string' || ulid.length !== ULID_LENGTH) return null

  let value = 0n
  for (let i = 0; i < TIME_CHARS; i++) {
    const index = ULID_ALPHABET.indexOf(ulid.charAt(i).toUpperCase())
    if (index === -1) return null
    value = (value << 5n) | BigInt(index)
  }

  // 50 位中只有低 48 位是时间信息，进位到高位的取值不可信
  if (value > 0xffff_ffff_ffffn) return null
  return Number(value)
}

export function generateUlids(options: UlidOptions): string[] {
  const { count, uppercase = true } = options

  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
    throw new RangeError(`数量必须为 0 到 ${MAX_COUNT} 之间的整数`)
  }

  const output: string[] = []
  for (let i = 0; i < count; i++) {
    let timestampMs = Date.now()

    if (timestampMs > lastTimestampMs) {
      lastRandom = randomBytes(RANDOM_BYTES)
    } else {
      // 同一毫秒，或系统时钟发生了回拨。两种情况都不能让时间戳倒退，
      // 因此保持上一个毫秒值并递增计数器；溢出才推进到下一毫秒。
      timestampMs = lastTimestampMs
      if (!incrementRandom(lastRandom)) {
        timestampMs = lastTimestampMs + 1
        lastRandom = randomBytes(RANDOM_BYTES)
      }
    }

    lastTimestampMs = timestampMs
    const ulid = encodeTimestamp(timestampMs) + encodeRandom(lastRandom)
    output.push(uppercase ? ulid : ulid.toLowerCase())
  }
  return output
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project core src/core/crypto/ulid.test.ts > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t2-pass.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t2-pass.log`

Expected: PASS，19 个用例全绿，`exit=0`

- [ ] **Step 5: 跑门禁**

Run: `npm test > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t2-all.log 2>&1; echo "test=$?"; npm run typecheck > /dev/null 2>&1; echo "tc=$?"; npm run lint > /dev/null 2>&1; echo "lint=$?"; grep -aE "Test Files|Tests " .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t2-all.log | tail -2`

Expected: `test=0 tc=0 lint=0`，用例总数为 **303 + 19 = 322**

- [ ] **Step 6: 提交**

```bash
git add src/core/crypto/ulid.ts src/core/crypto/ulid.test.ts
git commit -m "feat(crypto): 实现 ULID 生成与时间戳解码 Core（5.3）

- Crockford Base32（32 字符，剔除 I/L/O/U），10 字符时间 + 16 字符随机
- 同毫秒内递增 80 位随机段保证字典序单调，溢出则时间戳 +1ms
- 时钟回拨不产生倒退时间戳；decodeUlidTimestamp 对非法输入返回 null"
```

---

### Task 3: `core/crypto/hmac.ts` —— HMAC 计算

对应 `tasks.md` **5.4**；满足 delta spec 的 Requirement「HMAC 生成器」的 6 个 Scenario。

**Files:**
- Create: `src/core/crypto/hmac.ts`
- Test: `src/core/crypto/hmac.test.ts`

**Interfaces:**
- Consumes: `utf8ToBytes` / `hexToBytes` / `base64ToBytes` / `bytesToHex` / `bytesToBase64` from `../bytes`；`ok` / `err` / `Result` from `../result`；`globalThis.crypto.subtle`（Node 23 与各 WebView 原生提供）
- Produces: `HmacAlgorithm` / `InputEncoding` / `OutputEncoding` / `HmacOptions` / `decodeInput` / `computeHmac`。Task 9 的 HMAC 工具消费 `computeHmac` 与其类型

**关键约束（设计文档 §3.7）**：用 `crypto.subtle.importKey('raw', …) + sign`，**不引入任何第三方加密库**。

**本任务与「解析类用 Result」的关系**：`decodeInput` 与 `computeHmac` 确实返回 `Result` —— 因为「用户手输的 hex/base64 非法」是常规路径而非异常（与 `hexToBytes` 的既有约定一致）。这与「生成类直接返回终值」的规则不冲突：Token / ULID 的参数由控件约束，HMAC 的密钥与消息是**自由文本输入**。

- [ ] **Step 1: 写失败测试**

> **执行期偏离（2026-09-16，提交 `8b8258c` + 评审补齐提交）**：
> 1. 下面「若 `importKey` / `sign` 的实参类型报错」的预案**确实触发了**（TS2345：`Uint8Array<ArrayBufferLike>` 不可赋给 `BufferSource`）⇒ 已按预案改为 `new Uint8Array(keyBytes.value)` / `new Uint8Array(messageBytes.value)`。实测该复制在运行期是语义空操作（`bytes.ts` 的解码器返回的都是新建数组、非 SharedArrayBuffer 视图），仅为满足 TS 5.7+ 的泛型 `Uint8Array`。
> 2. 补 2 条用例（评审指出：① `key: 'zz'` 的首个非法字符恰在 0 位，`offset` 断言无法区分「真实偏移」与「硬编码 0」；② `BAD_MESSAGE` 分支零覆盖）：`非法 hex 的错误偏移指向首个非法字符，而非恒为 0` 与 `消息为非法十六进制时返回 BAD_MESSAGE 而不是抛错`。变异检验确认把 `offset: keyBytes.offset` 改成 `offset: 0` 会被前一条**恰好杀死**。
> ⇒ 本任务用例数为 **15**（非 13），下游累计期望值已同步上移 2。
> 3. **边界澄清**：Global Constraints 里「生成类抛 `RangeError`、不得用 `Result`」针对的是**参数由控件约束**的生成类（token / ulid / rsa 的 length / count / keySize）。HMAC 的密钥与消息是**自由文本输入**，「用户手输的 hex 非法」属常规路径 ⇒ 走 `Result`（与 `hexToBytes` / `base64ToBytes` 一致）。两条规则不冲突。

创建 `src/core/crypto/hmac.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64, bytesToHex, utf8ToBytes } from '../bytes'
import type { Result } from '../result'
import { computeHmac, decodeInput } from './hmac'

/** 取出成功结果；失败直接抛错，避免每个断言都写一遍 ok 收窄。 */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`期望成功，实际失败：${result.error}`)
  return result.value
}

/** RFC 4231 第 1 组测试向量：密钥为 20 字节 0x0b，消息为 "Hi There"。 */
const RFC4231_KEY_HEX = '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'
const RFC4231_MESSAGE = 'Hi There'

const BASE_OPTIONS = {
  message: RFC4231_MESSAGE,
  key: RFC4231_KEY_HEX,
  algorithm: 'SHA-256',
  messageEncoding: 'utf8',
  keyEncoding: 'hex',
  outputEncoding: 'hex',
} as const

describe('decodeInput', () => {
  it('三种编码各自解码', () => {
    expect([...unwrap(decodeInput('aGk=', 'base64'))]).toEqual([0x68, 0x69])
    expect([...unwrap(decodeInput('6869', 'hex'))]).toEqual([0x68, 0x69])
    expect([...unwrap(decodeInput('hi', 'utf8'))]).toEqual([0x68, 0x69])
  })

  it('非法 hex 返回错误且带偏移', () => {
    const result = decodeInput('68zz', 'hex')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_HEX_CHAR')
      expect(result.offset).toBe(2)
    }
  })

  it('非法 base64 返回错误', () => {
    const result = decodeInput('aGk=!!', 'base64')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('BAD_BASE64_CHAR')
  })
})

describe('computeHmac', () => {
  it('RFC 4231 向量：HMAC-SHA-256 的十六进制输出与标准值一致', async () => {
    const result = await computeHmac(BASE_OPTIONS)

    expect(unwrap(result)).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    )
  })

  it('十六进制密钥 6b6579 与 UTF-8 密钥 key 结果一致', async () => {
    const fromHex = await computeHmac({ ...BASE_OPTIONS, key: '6b6579' })
    const fromText = await computeHmac({ ...BASE_OPTIONS, key: 'key', keyEncoding: 'utf8' })

    expect(unwrap(fromHex)).toBe(unwrap(fromText))
  })

  it('切换算法改变摘要长度：SHA-256 → 64 字符，SHA-512 → 128 字符', async () => {
    const sha256 = unwrap(await computeHmac(BASE_OPTIONS))
    const sha512 = unwrap(await computeHmac({ ...BASE_OPTIONS, algorithm: 'SHA-512' }))

    expect(sha256).toHaveLength(64)
    expect(sha512).toHaveLength(128)
    expect(sha512.startsWith(sha256)).toBe(false)
  })

  it('SHA-1 与 SHA-384 也可用，长度分别为 40 与 96', async () => {
    const sha1 = unwrap(await computeHmac({ ...BASE_OPTIONS, algorithm: 'SHA-1' }))
    const sha384 = unwrap(await computeHmac({ ...BASE_OPTIONS, algorithm: 'SHA-384' }))

    expect(sha1).toHaveLength(40)
    expect(sha384).toHaveLength(96)
  })

  it('输出格式切换：base64 解码后的字节与 hex 输出逐字节一致', async () => {
    const hex = unwrap(await computeHmac(BASE_OPTIONS))
    const base64 = unwrap(await computeHmac({ ...BASE_OPTIONS, outputEncoding: 'base64' }))

    expect(bytesToHex(unwrap(base64ToBytes(base64)))).toBe(hex)
  })

  it('base64url 输出无填充，且解码后与 hex 输出逐字节一致', async () => {
    const hex = unwrap(await computeHmac(BASE_OPTIONS))
    const url = unwrap(await computeHmac({ ...BASE_OPTIONS, outputEncoding: 'base64url' }))

    expect(url).not.toContain('=')
    expect(url).not.toMatch(/[+/]/)
    expect(bytesToHex(unwrap(base64ToBytes(url)))).toBe(hex)
  })

  it('消息的三种编码指向同一字节时结果一致', async () => {
    const utf8 = unwrap(await computeHmac({ ...BASE_OPTIONS, messageEncoding: 'utf8' }))
    const hex = unwrap(
      await computeHmac({
        ...BASE_OPTIONS,
        message: bytesToHex(new TextEncoder().encode(RFC4231_MESSAGE)),
        messageEncoding: 'hex',
      }),
    )
    const base64 = unwrap(
      await computeHmac({
        ...BASE_OPTIONS,
        message: bytesToBase64(utf8ToBytes(RFC4231_MESSAGE)),
        messageEncoding: 'base64',
      }),
    )

    expect(hex).toBe(utf8)
    expect(base64).toBe(utf8)
  })

  it('密钥为空时返回错误且不输出结果', async () => {
    const result = await computeHmac({ ...BASE_OPTIONS, key: '' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('EMPTY_KEY')
      expect(result.error).toContain('密钥')
    }
  })

  it('密钥为非法十六进制时返回错误且不输出结果', async () => {
    const result = await computeHmac({ ...BASE_OPTIONS, key: 'zz' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_KEY')
      expect(result.error).toContain('密钥格式非法')
      expect(result.offset).toBe(0)
    }
  })

  it('消息为空是合法输入，仍产出摘要', async () => {
    const result = await computeHmac({ ...BASE_OPTIONS, message: '' })

    expect(unwrap(result)).toHaveLength(64)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project core src/core/crypto/hmac.test.ts > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t3-fail.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t3-fail.log`

Expected: FAIL，报 `Failed to resolve import "./hmac"`

- [ ] **Step 3: 写最小实现**

创建 `src/core/crypto/hmac.ts`：

```ts
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, utf8ToBytes } from '../bytes'
import { err, ok } from '../result'
import type { Result } from '../result'

export type HmacAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512'
export type InputEncoding = 'utf8' | 'hex' | 'base64'
export type OutputEncoding = 'hex' | 'base64' | 'base64url'

export interface HmacOptions {
  message: string
  key: string
  algorithm: HmacAlgorithm
  messageEncoding: InputEncoding
  keyEncoding: InputEncoding
  outputEncoding: OutputEncoding
}

/**
 * 按给定编码把文本还原为字节。
 *
 * 密钥与消息都是**自由文本输入**，非法 hex / base64 是常规路径，故返回 Result
 * 而不是抛错 —— 与 `bytes.ts` 的 `hexToBytes` / `base64ToBytes` 保持一致。
 */
export function decodeInput(text: string, encoding: InputEncoding): Result<Uint8Array> {
  switch (encoding) {
    case 'utf8':
      return ok(utf8ToBytes(text))
    case 'hex':
      return hexToBytes(text)
    case 'base64':
      return base64ToBytes(text)
  }
}

function encodeOutput(bytes: Uint8Array, encoding: OutputEncoding): string {
  switch (encoding) {
    case 'hex':
      return bytesToHex(bytes)
    case 'base64':
      return bytesToBase64(bytes)
    case 'base64url':
      // Base64URL 的规范形式不带 '=' 填充（与 JWT 的既有惯例一致）
      return bytesToBase64(bytes, { variant: 'urlsafe', padding: false })
  }
}

export async function computeHmac(options: HmacOptions): Promise<Result<string>> {
  const { message, key, algorithm, messageEncoding, keyEncoding, outputEncoding } = options

  // 空密钥必须在解码之前拦住：hex 编码下 '' 会被解码成合法的空字节序列
  if (key.length === 0) {
    return err('密钥不可为空', {
      code: 'EMPTY_KEY',
      suggestion: '填入任意长度的密钥文本，或切换为十六进制 / Base64 编码后填入字节',
    })
  }

  const keyBytes = decodeInput(key, keyEncoding)
  if (!keyBytes.ok) {
    return err(`密钥格式非法：${keyBytes.error}`, {
      code: 'BAD_KEY',
      detail: keyBytes.detail,
      offset: keyBytes.offset,
    })
  }

  const messageBytes = decodeInput(message, messageEncoding)
  if (!messageBytes.ok) {
    return err(`消息格式非法：${messageBytes.error}`, {
      code: 'BAD_MESSAGE',
      detail: messageBytes.detail,
      offset: messageBytes.offset,
    })
  }

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyBytes.value,
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  )
  const digest = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, messageBytes.value)

  return ok(encodeOutput(new Uint8Array(digest), outputEncoding))
}
```

**若 `importKey` / `sign` 的实参类型报错**（TS 对 `Uint8Array<ArrayBufferLike>` 与 `BufferSource` 的兼容性视 lib 版本而定），把实参写成 `new Uint8Array(keyBytes.value)` / `new Uint8Array(messageBytes.value)` —— 这是显式复制，**不要**用 `as any` 或 `@ts-expect-error` 绕过。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project core src/core/crypto/hmac.test.ts > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t3-pass.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t3-pass.log`

Expected: PASS，15 个用例全绿，`exit=0`

**若 RFC 4231 向量的断言失败**：先用外部工具复核向量本身，再判断是实现错还是计划里的向量写错：

```bash
printf 'Hi There' | openssl dgst -sha256 -mac HMAC -macopt hexkey:0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b
# 期望：b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7
```

- [ ] **Step 5: 跑门禁**

Run: `npm test > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t3-all.log 2>&1; echo "test=$?"; npm run typecheck > /dev/null 2>&1; echo "tc=$?"; npm run lint > /dev/null 2>&1; echo "lint=$?"; grep -aE "Test Files|Tests " .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t3-all.log | tail -2`

Expected: `test=0 tc=0 lint=0`，用例总数为 **322 + 15 = 337**

- [ ] **Step 6: 提交**

```bash
git add src/core/crypto/hmac.ts src/core/crypto/hmac.test.ts
git commit -m "feat(crypto): 实现 HMAC 计算 Core（5.4）

- SHA-1/256/384/512 四种算法，走 WebCrypto importKey + sign，零第三方依赖
- 密钥与消息各支持 utf8 / hex / base64 三种编码，输出支持 hex / base64 / base64url
- 空密钥与非法编码返回带 code 与 offset 的错误对象
- 以 RFC 4231 第 1 组标准向量锚定正确性，而非自证"
```

---

### Task 4: `core/der.ts` —— DER 最小写入器

对应 `tasks.md` **5.12** 的第一部分。

**Files:**
- Create: `src/core/der.ts`
- Test: `src/core/der.test.ts`

**Interfaces:**
- Consumes: `bytesToBase64` from `./bytes`
- Produces: `derLength` / `derInteger` / `derBitString` / `derNull` / `derSequence` / `bytesToPem`。Task 5 的 `ssh-key.ts` 与 Task 6 的 `rsa.ts` 消费全部六个

**为什么只写写入器**（设计文档 §3.5）：WebCrypto 能导出 PKCS#8 / SPKI，但拿不到 PKCS#1。而 `exportKey('jwk')` 对私钥直接给出全部 CRT 参数 `n e d p q dp dq qi`，因此**正向组装**即可，无需任何解析器 —— 零新增依赖（`node-forge` 约 500KB、`asn1.js` 同样被明确拒绝）。

**DER 的两个要点**（写错必被 Task 6 的交叉验证抓住）：

1. **INTEGER 的正数语义**：先剥掉 JWK 字节的前导 `0x00`，再在最高位为 1 时补一个 `0x00`。少了这步，高位置 1 的模数会被读成负数。
2. **长度编码**：`< 0x80` 用短形式（单字节）；否则用长形式 `0x80 | 字节数` + 大端长度。`derLength(0x80)` 必须是 `81 80` 而不是 `80`。

- [ ] **Step 1: 写失败测试**

> **执行期修正（2026-09-16，预检 2 处 + 评审 3 处）**。前两处是**计划自身的缺陷**，落地前用外部工具取证后修正：
> 1. 测试里 `derInteger(fromHex('00000102'))` 期望 `02030102` —— 与计划自己的实现矛盾：`derInteger` 剥离**全部**前导零（X.690 §8.3.2 的要求），值 258 的规范编码是 `02020102`。openssl 实测：`02 02 01 02` → `INTEGER :0102`（合法）、`02 03 00 01 02` → **`BAD INTEGER:[000102]`**（非规范编码），且 `openssl asn1parse -genstr "INTEGER:0x0102"` 输出的就是 `02020102`。已按 `02020102` 落地（`02030102` 会写出 openssl 拒绝的 DER）。
> 2. 测试里的 `derInteger(new Uint8Array(0))` 期望 `020100`，而计划的实现会给出 `0200`。**测试是对的**：DER 要求 INTEGER 至少有一个内容字节 —— openssl 实测 `02 00` → `BAD INTEGER:[]`、`02 01 00` → `INTEGER :00` ⇒ 实现补上「空输入按零值编码」分支。
>
> 评审后追加三处（**用例数 16 → 17**，累计期望值已同步）：
> 3. **补「长形式长度也能被独立读取器跨过」用例**：原互校用例只含短形式长度，读取器的长形式解析路径（`count = first & 0x7f` + 大端拼装）从未被走过 ⇒ 补一条 200 字节负载的嵌套结构。
> 4. **`derLength` 补 2^32 断言**：原最大用例是 70_000（3 字节长度），5 字节长度路径无覆盖。变异「长度字节最多 4 个」实测被这条**恰好杀死**（`多位长度用大端`）。
> 5. **注释校正**：① `der.ts` 顶部原称「只服务 PKCS#1 导出与 OpenSSH 组装」，但 `derBitString` / `derNull` 属 SPKI / PKCS#8 ⇒ 改为列出四种导出；② 测试里 `readIntegerValue` 的剥零逻辑与 `derInteger` 同构，**对 INTEGER 规范化不构成独立证据**（该层兜底是直接写死的十六进制字面量断言），已在注释里写明，避免把它当成互校证据。
> 6. **评审的一条 Minor 被实测证伪**：评审（无 shell 环境）称 `openssl asn1parse` 默认不会拒绝 `02 03 00 01 02`；实跑输出为 `BAD INTEGER:[000102]`，故上面第 1 条的结论与测试注释保持不变。

创建 `src/core/der.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { bytesToBase64 } from './bytes'
import {
  bytesToPem,
  derBitString,
  derInteger,
  derLength,
  derNull,
  derSequence,
} from './der'

/**
 * 测试内**独立重写**的 DER 读取器。
 *
 * 与写入器互校才有意义：用写入器自己验证自己只能证明「两次都错成一样」。
 * 这里的实现刻意不复用 der.ts 的任何函数。
 */
interface Tlv {
  tag: number
  value: Uint8Array
  next: number
}

function readTlv(bytes: Uint8Array, offset = 0): Tlv {
  const tag = bytes[offset] ?? 0
  const first = bytes[offset + 1] ?? 0

  let length: number
  let cursor: number
  if (first < 0x80) {
    length = first
    cursor = offset + 2
  } else {
    const count = first & 0x7f
    length = 0
    for (let i = 0; i < count; i++) length = length * 256 + (bytes[offset + 2 + i] ?? 0)
    cursor = offset + 2 + count
  }

  return { tag, value: bytes.slice(cursor, cursor + length), next: cursor + length }
}

/** 读 INTEGER 的值语义：剥掉正数补的 0x00。 */
function readIntegerValue(bytes: Uint8Array, offset = 0): Uint8Array {
  const { value } = readTlv(bytes, offset)
  let start = 0
  while (start < value.length - 1 && value[start] === 0x00) start++
  return value.slice(start)
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('derLength', () => {
  it('小于 0x80 用短形式', () => {
    expect(toHex(derLength(0))).toBe('00')
    expect(toHex(derLength(1))).toBe('01')
    expect(toHex(derLength(0x7f))).toBe('7f')
  })

  it('0x80 与 0xff 用两字节长形式（不得退化为单字节）', () => {
    expect(toHex(derLength(0x80))).toBe('8180')
    expect(toHex(derLength(0xff))).toBe('81ff')
  })

  it('多位长度用大端', () => {
    expect(toHex(derLength(0x100))).toBe('820100')
    expect(toHex(derLength(70_000))).toBe('83011170')
    expect(toHex(derLength(0x10000))).toBe('83010000')
  })

  it('非整数或负数抛 RangeError', () => {
    expect(() => derLength(-1)).toThrow(RangeError)
    expect(() => derLength(1.5)).toThrow(RangeError)
  })
})

describe('derInteger', () => {
  it('最高位为 0 时不补零', () => {
    expect(toHex(derInteger(fromHex('7f')))).toBe('02017f')
  })

  it('最高位为 1 时补一个 0x00（正数语义）', () => {
    expect(toHex(derInteger(fromHex('80')))).toBe('02020080')
    expect(toHex(derInteger(fromHex('ff00')))).toBe('020300ff00')
  })

  it('剥离 JWK 字节的前导 0x00', () => {
    expect(toHex(derInteger(fromHex('0080')))).toBe(toHex(derInteger(fromHex('80'))))
    expect(toHex(derInteger(fromHex('00000102')))).toBe('02030102')
  })

  it('零编码为 02 01 00', () => {
    expect(toHex(derInteger(fromHex('00')))).toBe('020100')
    expect(toHex(derInteger(new Uint8Array(0)))).toBe('020100')
  })
})

describe('derBitString', () => {
  it('首字节为未使用位数 0', () => {
    expect(toHex(derBitString(fromHex('0102')))).toBe('0303000102')
    expect(toHex(derBitString(new Uint8Array(0)))).toBe('030100')
  })
})

describe('derNull', () => {
  it('恒为 05 00', () => {
    expect(toHex(derNull())).toBe('0500')
  })
})

describe('derSequence', () => {
  it('按序拼接子元素并加 0x30 头', () => {
    const sequence = derSequence([derInteger(fromHex('01')), derNull()])

    expect(toHex(sequence)).toBe('30050201010500')
  })

  it('空序列为 30 00', () => {
    expect(toHex(derSequence([]))).toBe('3000')
  })

  it('长内容的长度字段用长形式', () => {
    const payload = new Uint8Array(200).fill(0x41)
    const sequence = derSequence([derInteger(payload)])

    // 200 字节负载 0x41 的最高位为 0，故不补零：INTEGER 内容 = 200 = 0xc8，
    // 头部占用 3 字节，SEQUENCE 内容 = 203 = 0xcb
    expect(toHex(sequence.slice(0, 5))).toBe('3081cb0281')
  })
})

describe('独立读取器互校', () => {
  it('嵌套结构可被独立读取器还原', () => {
    // 模拟 RSAPublicKey ::= SEQUENCE { INTEGER n, INTEGER e }
    const n = fromHex('00c1ab')
    const e = fromHex('010001')
    const der = derSequence([derInteger(n), derInteger(e)])

    const outer = readTlv(der)
    expect(outer.tag).toBe(0x30)

    const first = readTlv(outer.value, 0)
    expect(first.tag).toBe(0x02)
    expect(toHex(readIntegerValue(outer.value, 0))).toBe('c1ab')

    const second = readTlv(outer.value, first.next)
    expect(second.tag).toBe(0x02)
    expect(toHex(readIntegerValue(outer.value, first.next))).toBe('010001')
  })
})

describe('bytesToPem', () => {
  it('头尾行与标签正确，末尾保留换行', () => {
    const pem = bytesToPem(fromHex('0102'), 'PUBLIC KEY')

    expect(pem.startsWith('-----BEGIN PUBLIC KEY-----\n')).toBe(true)
    expect(pem.endsWith('-----END PUBLIC KEY-----\n')).toBe(true)
    expect(pem).toContain(bytesToBase64(fromHex('0102')))
  })

  it('每行不超过 64 个 Base64 字符', () => {
    const pem = bytesToPem(new Uint8Array(100).fill(0x41), 'RSA PUBLIC KEY')
    const body = pem.split('\n').slice(1, -2)

    expect(body.length).toBeGreaterThan(1)
    for (const line of body) expect(line.length).toBeLessThanOrEqual(64)
    expect(body.every((line) => /^[A-Za-z0-9+/=]+$/.test(line))).toBe(true)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project core src/core/der.test.ts > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t4-fail.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t4-fail.log`

Expected: FAIL，报 `Failed to resolve import "./der"`

- [ ] **Step 3: 写最小实现**

创建 `src/core/der.ts`：

```ts
import { bytesToBase64 } from './bytes'

/**
 * DER 最小写入器。
 *
 * 只服务 RSA 的 PKCS#1 导出与 OpenSSH 公钥组装 —— 由 JWK 拿到全部 CRT 参数后正向
 * 组装，因此完全不需要 DER 解析器（设计文档 §3.5）。零新增依赖。
 */

/** 长度编码：< 0x80 用短形式；否则 0x80 | 字节数 + 大端长度。 */
export function derLength(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 0) {
    throw new RangeError('length 必须为非负整数')
  }
  if (length < 0x80) return new Uint8Array([length])

  const bytes: number[] = []
  let remaining = length
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff)
    remaining = Math.floor(remaining / 256)
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

function tlv(tag: number, content: Uint8Array): Uint8Array {
  const length = derLength(content.length)
  const out = new Uint8Array(1 + length.length + content.length)
  out[0] = tag
  out.set(length, 1)
  out.set(content, 1 + length.length)
  return out
}

/**
 * INTEGER。
 *
 * 先剥离前导 0x00（JWK 的 `n` / `e` 是有长度语义的大端字节串，可能带前导零），
 * 再在最高位为 1 时补一个 0x00 表达正数语义 —— 否则会被读成负数。零值编码为
 * `02 01 00`。
 */
export function derInteger(bytes: Uint8Array): Uint8Array {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0x00) start++
  const trimmed = bytes.slice(start)

  const needsPad = trimmed.length > 0 && ((trimmed[0] ?? 0) & 0x80) !== 0
  const content = needsPad ? new Uint8Array([0x00, ...trimmed]) : trimmed
  return tlv(0x02, content)
}

/** BIT STRING：首字节为「未使用位数」，本写入器恒为 0。 */
export function derBitString(bytes: Uint8Array): Uint8Array {
  return tlv(0x03, new Uint8Array([0x00, ...bytes]))
}

export function derNull(): Uint8Array {
  return new Uint8Array([0x05, 0x00])
}

/** SEQUENCE：子元素按序拼接为内容，再套 0x30 头。 */
export function derSequence(children: Uint8Array[]): Uint8Array {
  const total = children.reduce((sum, child) => sum + child.length, 0)
  const content = new Uint8Array(total)

  let offset = 0
  for (const child of children) {
    content.set(child, offset)
    offset += child.length
  }
  return tlv(0x30, content)
}

/** PEM：每行 64 个 Base64 字符，末尾保留换行（OpenSSL 兼容）。 */
export function bytesToPem(bytes: Uint8Array, label: string): string {
  const base64 = bytesToBase64(bytes)

  const lines: string[] = []
  for (let i = 0; i < base64.length; i += 64) lines.push(base64.slice(i, i + 64))

  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project core src/core/der.test.ts > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t4-pass.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t4-pass.log`

Expected: PASS，17 个用例全绿，`exit=0`

- [ ] **Step 5: 跑门禁**

Run: `npm test > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t4-all.log 2>&1; echo "test=$?"; npm run typecheck > /dev/null 2>&1; echo "tc=$?"; npm run lint > /dev/null 2>&1; echo "lint=$?"; grep -aE "Test Files|Tests " .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t4-all.log | tail -2`

Expected: `test=0 tc=0 lint=0`，用例总数为 **337 + 17 = 354**

- [ ] **Step 6: 提交**

```bash
git add src/core/der.ts src/core/der.test.ts
git commit -m "feat(core): 实现 DER 最小写入器（5.12 之一）

- INTEGER 剥离前导零并按最高位补零，保证正数语义
- 长度编码短/长形式分界在 0x80，多位长度用大端
- SEQUENCE / BIT STRING / NULL 与 PEM 折行（每行 64 字符）
- 测试内独立重写 DER 读取器互校，避免写入器自证"
```

---

### Task 5: `core/ssh-key.ts` —— OpenSSH 单行公钥

对应 `tasks.md` **5.12** 的第二部分。

**Files:**
- Create: `src/core/ssh-key.ts`
- Test: `src/core/ssh-key.test.ts`

**Interfaces:**
- Consumes: `bytesToBase64` from `./bytes`
- Produces: `sshString` / `sshMpint` / `sshRsaPublicKey`。Task 6 的 `rsa.ts` 消费 `sshRsaPublicKey`

**范围界定**（设计文档 §3.5）：只做**公钥**。OpenSSH 私钥涉及 `openssh-key-v1` 容器与 `bcrypt-pbkdf` KDF，本 change 明确不含 —— 这主动避开了一整套复杂度。

**格式**（RFC 4253 §6.6 + RFC 4251 §5）：

```
ssh-rsa <base64>            整行不折行
base64 内容 = string "ssh-rsa" + mpint e + mpint n
string      = uint32 大端长度 + 字节
mpint       = 同 string，但按有符号大端补码：剥前导 0x00，最高位为 1 时补 0x00
```

- [ ] **Step 1: 写失败测试**

创建 `src/core/ssh-key.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { base64ToBytes } from './bytes'
import { sshMpint, sshRsaPublicKey, sshString } from './ssh-key'

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 测试内独立解析：按 uint32 长度前缀逐段取出。 */
function readField(blob: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  const length =
    ((blob[offset] ?? 0) << 24) |
    ((blob[offset + 1] ?? 0) << 16) |
    ((blob[offset + 2] ?? 0) << 8) |
    (blob[offset + 3] ?? 0)

  return { value: blob.slice(offset + 4, offset + 4 + length), next: offset + 4 + length }
}

/** 剥掉 mpint 为正数补的 0x00，得到值语义。 */
function unsignedOf(mpint: Uint8Array): Uint8Array {
  let start = 0
  while (start < mpint.length - 1 && mpint[start] === 0x00) start++
  return mpint.slice(start)
}

describe('sshString', () => {
  it('前置 uint32 大端长度', () => {
    expect(toHex(sshString(fromHex('616263')))).toBe('00000003616263')
    expect(toHex(sshString(new Uint8Array(0)))).toBe('00000000')
  })
})

describe('sshMpint', () => {
  it('剥前导 0x00', () => {
    expect(toHex(sshMpint(fromHex('00000102')))).toBe('000000020102')
    expect(toHex(sshMpint(fromHex('0102')))).toBe(toHex(sshMpint(fromHex('00000102'))))
  })

  it('最高位为 1 时补 0x00', () => {
    expect(toHex(sshMpint(fromHex('80')))).toBe('000000020080')
    expect(toHex(sshMpint(fromHex('ff01')))).toBe('0000000300ff01')
  })

  it('零编码为空内容', () => {
    expect(toHex(sshMpint(new Uint8Array(0)))).toBe('00000000')
  })
})

describe('sshRsaPublicKey', () => {
  const exponent = fromHex('010001')
  const modulus = fromHex('c1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1ab')

  it('是单行 ssh-rsa 文本并以换行结尾', () => {
    const line = sshRsaPublicKey(modulus, exponent)

    expect(line.startsWith('ssh-rsa ')).toBe(true)
    expect(line.endsWith('\n')).toBe(true)
    expect(line.trimEnd().split('\n')).toHaveLength(1)
  })

  it('线下内容可被独立解析还原出算法名与 n / e', () => {
    const line = sshRsaPublicKey(modulus, exponent)
    const blob = base64ToBytes(line.trim().slice('ssh-rsa '.length))
    if (!blob.ok) throw new Error('公钥主体不是合法 Base64')

    const algorithm = readField(blob.value, 0)
    expect(new TextDecoder().decode(algorithm.value)).toBe('ssh-rsa')

    const e = readField(blob.value, algorithm.next)
    expect(toHex(unsignedOf(e.value))).toBe(toHex(exponent))

    const n = readField(blob.value, e.next)
    expect(toHex(unsignedOf(n.value))).toBe(toHex(modulus))

    expect(n.next).toBe(blob.value.length)
  })

  it('模数最高位为 1 时，mpint 会多补一个 0x00 且仍能还原', () => {
    const highBitModulus = fromHex('ff' + '11'.repeat(15))
    const line = sshRsaPublicKey(highBitModulus, exponent)
    const blob = base64ToBytes(line.trim().slice('ssh-rsa '.length))
    if (!blob.ok) throw new Error('公钥主体不是合法 Base64')

    const algorithm = readField(blob.value, 0)
    const e = readField(blob.value, algorithm.next)
    const n = readField(blob.value, e.next)

    expect(n.value[0]).toBe(0x00)
    expect(toHex(unsignedOf(n.value))).toBe(toHex(highBitModulus))
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project core src/core/ssh-key.test.ts > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t5-fail.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t5-fail.log`

Expected: FAIL，报 `Failed to resolve import "./ssh-key"`

- [ ] **Step 3: 写最小实现**

创建 `src/core/ssh-key.ts`：

```ts
import { bytesToBase64 } from './bytes'

/**
 * OpenSSH 单行公钥的组装（RFC 4253 §6.6）。
 *
 * 只做公钥：OpenSSH 私钥涉及 `openssh-key-v1` 容器与 bcrypt-pbkdf，本 change 明确不含。
 */

/** `string` 与 `mpint` 共用的长度前缀：uint32 大端。 */
export function sshString(bytes: Uint8Array): Uint8Array {
  const length = bytes.length
  const out = new Uint8Array(4 + length)
  out[0] = (length >>> 24) & 0xff
  out[1] = (length >>> 16) & 0xff
  out[2] = (length >>> 8) & 0xff
  out[3] = length & 0xff
  out.set(bytes, 4)
  return out
}

/**
 * `mpint`（RFC 4251 §5）：有符号的大端补码整数。
 *
 * 与 DER INTEGER 的正数处理一致：先剥前导 0x00，再在最高位为 1 时补一个 0x00。
 * 少了这一步，高位为 1 的模数会被对端读成负数。
 */
export function sshMpint(bytes: Uint8Array): Uint8Array {
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0x00) start++
  const trimmed = bytes.slice(start)

  const needsPad = trimmed.length > 0 && ((trimmed[0] ?? 0) & 0x80) !== 0
  return sshString(needsPad ? new Uint8Array([0x00, ...trimmed]) : trimmed)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)

  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** RSA 公钥 → 单行 `ssh-rsa AAAA…`（含结尾换行，整行不折行）。 */
export function sshRsaPublicKey(modulus: Uint8Array, exponent: Uint8Array): string {
  const blob = concat([
    sshString(new TextEncoder().encode('ssh-rsa')),
    sshMpint(exponent),
    sshMpint(modulus),
  ])

  return `ssh-rsa ${bytesToBase64(blob)}\n`
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project core src/core/ssh-key.test.ts > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t5-pass.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t5-pass.log`

Expected: PASS，7 个用例全绿，`exit=0`

- [ ] **Step 5: 跑门禁**

Run: `npm test > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t5-all.log 2>&1; echo "test=$?"; npm run typecheck > /dev/null 2>&1; echo "tc=$?"; npm run lint > /dev/null 2>&1; echo "lint=$?"; grep -aE "Test Files|Tests " .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t5-all.log | tail -2`

Expected: `test=0 tc=0 lint=0`，用例总数为 **354 + 7 = 361**

- [ ] **Step 6: 提交**

```bash
git add src/core/ssh-key.ts src/core/ssh-key.test.ts
git commit -m "feat(core): 实现 OpenSSH 单行公钥组装（5.12 之二）

- string / mpint 均为 uint32 大端长度前缀，mpint 按有符号补码补零
- 输出单行 ssh-rsa 文本，整行不折行，末尾保留换行
- 测试内独立解析长度前缀字段，还原算法名与 n / e 逐字节比对
- 明确不含 OpenSSH 私钥（避开 openssh-key-v1 与 bcrypt-pbkdf）"
```

---

### Task 6: `core/crypto/rsa.ts` —— RSA 密钥对生成与 PEM 导出

对应 `tasks.md` **5.5** 与 **5.12 的交叉验证部分**；满足 delta spec 的 Requirement「RSA 密钥对生成器」中**与 Core 有关**的 Scenario（界面层的那条属 Task 10）。

**Files:**
- Create: `src/core/crypto/rsa.ts`
- Test: `src/core/crypto/rsa.test.ts`
- Modify: `tsconfig.json`（`types` 增加 `"node"`）
- Modify: `eslint.config.js`（新增一条：core 生产代码不得 import `node:`）

**Interfaces:**
- Consumes: `base64ToBytes` from `../bytes`；`derInteger` / `derSequence` / `bytesToPem` from `../der`；`sshRsaPublicKey` from `../ssh-key`；`globalThis.crypto.subtle`
- Produces: `RsaKeySize` / `PrivateKeyFormat` / `PublicKeyFormat` / `RsaKeyPair` / `RsaOptions` / `generateRsaKeyPair`。Task 10 的 RSA 工具消费全部

**关键设计（设计文档 §3.5）**：

- 私钥：`exportKey('jwk')` 拿到全部 CRT 参数 `n e d p q dp dq qi` → 自写 DER 写入器 → PKCS#1 PEM；或直接用 WebCrypto 的 `exportKey('pkcs8')`
- 公钥：SPKI 用 `exportKey('spki')`；PKCS#1 用 `SEQUENCE { INTEGER n, INTEGER e }`；OpenSSH 走 Task 5 的 `sshRsaPublicKey`
- **`generateKey(..., extractable = true, ...)` 的第二个参数必须为 `true`** —— 否则 `exportKey` 抛 `InvalidAccessError`，而这时密钥已经生成完毕，报错位置会离原因很远

**为何先用 `rsa-pss`/`RSA-OAEP` 之外选 `RSASSA-PKCS1-v1_5`**：它是唯一能让 WebCrypto 导出的 JWK 带全 CRT 参数、且能被 `openssl rsa -check` 直接校验的算法族（`RSA-OAEP` 也可导出 JWK，但生成/校验路径更绕）。生成出的密钥对本身与算法无关（PEM 里只有模数与指数），故 `RsaKeyPair.algorithm` 记录该值供界面说明。

- [ ] **Step 1: 打通测试所需的 Node 类型与分层约束**

RSA 的交叉验证要调用外部 `openssl`（设计文档 §8.4 第 2 层），需要 `node:child_process` 与 `node:fs`。本仓 `tsconfig.json` 的 `types` 目前只列了 `vite/client`，`@types/node` 仅以传递依赖形式存在于 `node_modules`（26.5.1）与 lockfile 中。

修改 `tsconfig.json` 第 18 行：

```json
    "types": ["vite/client", "node"],
```

同时补一条 ESLint 规则，堵住「core 生产代码可以用 Node 内置模块」这个新开的口子 —— `core/` 要在 WebView 里运行，`import 'node:fs'` 会直接崩，而它不会是类型错误、只会是运行时错误：

修改 `eslint.config.js`，在 core 层配置块**之后**插入：

```js
  {
    // core 的生产代码要在 WebView 中运行，Node 内置模块只在测试里可用。
    // 这条口子是 T6 为 openssl 交叉验证打开 types: ["node"] 时新开的，
    // 不堵住就会出现「类型通过、WebView 崩溃」的静默缺陷。
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['node:*'], message: 'core 生产代码不得依赖 Node 内置模块' }] },
      ],
    },
  },
```

Run: `npm run typecheck > /dev/null 2>&1; echo "tc=$?"; npm run lint > /dev/null 2>&1; echo "lint=$?"`

Expected: `tc=0 lint=0`（此时只有配置变更，尚无新代码）

- [ ] **Step 2: 写失败测试**

> **执行期修正（2026-09-16，提交 `51ad833` + 评审补齐）**：本任务抓到本计划**最多的测试用法缺陷**，全部以实测证据定案（用例数仍是 9，未影响下游累计值）：
> 1. **`readChildren(pemToDer(...))` 吃整段 DER**：只得到 1 个子元素。实测失败 `expected [ { tag: 48, …(2) } ] to have a length of 9 but got 1`（48 = 0x30 = 外层 SEQUENCE）⇒ 新增 `readSequenceChildren(der)`：先 `readTlv` 取 `.value`，并断言 `tag === 0x30` 与 `outer.next === der.length`。
> 2. **SPKI 的 BIT STRING 内容里还套一层 `RSAPublicKey SEQUENCE`**（RFC 5280 + RFC 8017 A.1.1），计划把它当成直接的 INTEGER 流。openssl 取证：`openssl asn1parse -in pub.pem -strparse 22` 输出 `SEQUENCE { INTEGER n, INTEGER e }` ⇒ 该处同样改用 `readSequenceChildren`。
> 3. **SSH blob 是 `uint32 长度前缀`，不是 DER 的 TLV**，计划复用了 `readTlv`。实测失败 `expected '' to be 'ssh-rsa'`（首字节 0x00 被当标签、长度读成 0）⇒ 新增 `readSshField`（uint32 大端；高位字节用乘法而不是 `<< 24`，避开 `<<` 的有符号语义）。
>
> 三条都出现在 `openssl rsa -check` 与「签名 / 验签往返」**已经通过**的前提下 ⇒ 是测试写法错，不是实现错。
>
> 4. **类型层面**：`pemToDer` 的返回类型必须写成 `Uint8Array<ArrayBuffer>`（默认的 `ArrayBufferLike` 与 `BufferSource` 不兼容，TS2345）。这里改类型而不是再复制一份：它返回的本来就是新建的 ArrayBuffer 支撑数组。
> 5. **配置硬化（评审 C-1，本轮最有价值的一条）**：`types: ["node"]` 会注入 `process` / `Buffer` / `setImmediate` / `clearImmediate` / `global` 这些**全局标识符**，而 `no-restricted-imports` 只管 import ⇒ core 生产代码里写 `Buffer.from(...)` 能同时通过 tsc 与 lint，却在 WebView 崩溃 —— 恰是本任务想避免的「类型过、运行崩」静默缺陷。已在同一配置块补 `no-restricted-globals`（因后匹配块会整体覆盖同名规则，DOM 那四个全局必须一并重列），并把**裸模块名**（`import 'fs'`）补进黑名单 —— 实测两者此前都是漏网的口子。
> 6. **守卫用例加严（评审 I-1 / I-2）**：① 只断言 `RangeError` 不够 —— 守卫被删时 WebCrypto 自己抛的也是 `RangeError` ⇒ 改断言文案 `/密钥长度仅支持/`；② 只生成 1024 时 `KEY_SIZES` 删掉 3072 / 4096 也不会被发现 ⇒ 真实生成 3072 / 4096 并断言**模数位数 = 请求长度**。变异「`KEY_SIZES = [1024, 2048]`」实测被该用例**恰好杀死**。
> 7. **手动外部复核结果**（Step 6 的「手动复核 openssl」做实）：`openssl rsa -check` → `RSA key ok`；`openssl pkey -check`（PKCS#8）→ `Key is valid`；同密钥对内私钥模数 ≡ PKCS#1 公钥模数；`ssh-keygen -l` 能解析我们导出的 openssh 行；**`ssh-keygen -y` 从我们的 PKCS#1 私钥派生的公钥行与我们导出的 openssh 行逐字节一致**。
> 8. **门禁口径**：本 worktree 另有并行工作流（`src/core/converter/`、`src/tools/converter/`、`src/framework/ui/FileDrop.*`），会同时改动全仓 lint/typecheck/测试计数。此后 `npm test` 的全量数字 = 本计划范围 + 并行工作流；本任务的「我的范围」为 **370 用例 / 31 文件**（全量 463 / 41 − 并行 93 / 10）。提交时只 `git add` 本任务的文件。

创建 `src/core/crypto/rsa.test.ts`：

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { generateRsaKeyPair } from './rsa'
import type { RsaKeySize } from './rsa'

/* ────────────────────────── 独立 DER 读取器 ────────────────────────── */
/*
 * 刻意不复用 core/der.ts 的任何函数：用写入器验证自己只能证明「两次都错成
 * 一样」。这里按 X.690 重新实现一遍读取，才构成互校。
 */

interface Tlv {
  tag: number
  value: Uint8Array
  next: number
}

function readTlv(bytes: Uint8Array, offset = 0): Tlv {
  const tag = bytes[offset] ?? 0
  const first = bytes[offset + 1] ?? 0

  let length: number
  let cursor: number
  if (first < 0x80) {
    length = first
    cursor = offset + 2
  } else {
    const count = first & 0x7f
    length = 0
    for (let i = 0; i < count; i++) length = length * 256 + (bytes[offset + 2 + i] ?? 0)
    cursor = offset + 2 + count
  }

  return { tag, value: bytes.slice(cursor, cursor + length), next: cursor + length }
}

function readChildren(sequence: Uint8Array): Tlv[] {
  const children: Tlv[] = []
  let offset = 0
  while (offset < sequence.length) {
    const child = readTlv(sequence, offset)
    children.push(child)
    offset = child.next
  }
  return children
}

/** INTEGER 的值语义：剥掉正数补的 0x00 后转 BigInt。 */
function toBigInt(value: Uint8Array): bigint {
  let start = 0
  while (start < value.length - 1 && value[start] === 0x00) start++

  let out = 0n
  for (let i = start; i < value.length; i++) out = (out << 8n) | BigInt(value[i] ?? 0)
  return out
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('-----'))
    .join('')

  const binary = atob(body)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const HAS_OPENSSL = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const tempDirs: string[] = []
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function writeTemp(name: string, content: string): string {
  const dir = tempDirs[0] ?? (() => {
    const created = mkdtempSync(join(tmpdir(), 'it-toolbox-rsa-'))
    tempDirs.push(created)
    return created
  })()
  const path = join(dir, name)
  writeFileSync(path, content, 'utf8')
  return path
}

/* ────────────────────────────── 用例 ────────────────────────────── */

describe('generateRsaKeyPair', () => {
  it('默认导出 SPKI 公钥与 PKCS#8 私钥，均为合法 PEM', async () => {
    const pair = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs8',
      publicKeyFormat: 'spki',
    })

    expect(pair.publicKey.startsWith('-----BEGIN PUBLIC KEY-----')).toBe(true)
    expect(pair.publicKey.trimEnd().endsWith('-----END PUBLIC KEY-----')).toBe(true)
    expect(pair.privateKey.startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true)
    expect(pair.keySize).toBe(1024)
    expect(pair.algorithm).toBe('RSASSA-PKCS1-v1_5')
    expect(pair.generatedAt).toBeLessThanOrEqual(Date.now())
  })

  it('私钥格式为 PKCS#1 时用 RSA PRIVATE KEY 标签', async () => {
    const pair = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'spki',
    })

    expect(pair.privateKey.startsWith('-----BEGIN RSA PRIVATE KEY-----')).toBe(true)
    expect(pair.privateKey.trimEnd().endsWith('-----END RSA PRIVATE KEY-----')).toBe(true)
  })

  it('公钥格式为 PKCS#1 / OpenSSH 时用各自的表示', async () => {
    const pkcs1 = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'pkcs1',
    })
    expect(pkcs1.publicKey.startsWith('-----BEGIN RSA PUBLIC KEY-----')).toBe(true)

    const openssh = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'openssh',
    })
    expect(openssh.publicKey.startsWith('ssh-rsa ')).toBe(true)
    expect(openssh.publicKey.trimEnd().split('\n')).toHaveLength(1)
  })

  it('独立读取器解析 PKCS#1 私钥后，CRT 参数满足数学恒等式', async () => {
    const pair = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'spki',
    })

    const children = readChildren(pemToDer(pair.privateKey))
    expect(children).toHaveLength(9)

    const [version, n, e, d, p, q, dp, dq, qi] = children.map((child) => toBigInt(child.value))

    expect(version).toBe(0n)

    // 这三条是 RSA 的定义式：字段顺序或正数补零写错都会在这里露出来
    expect(p! * q!).toBe(n!)
    expect(d! % (p! - 1n)).toBe(dp!)
    expect(d! % (q! - 1n)).toBe(dq!)
    expect((qi! * q!) % p!).toBe(1n)
    expect(e).toBe(65537n)
  })

  it('PKCS#1 私钥里的模数与 SPKI 公钥里的模数是同一个', async () => {
    const pair = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'spki',
    })

    const privateParts = readChildren(pemToDer(pair.privateKey)).map((child) => toBigInt(child.value))
    const spki = readTlv(pemToDer(pair.publicKey))
    // SPKI ::= SEQUENCE { AlgorithmIdentifier, BIT STRING { RSAPublicKey } }
    const [algorithm, bitString] = readChildren(spki.value)
    expect(algorithm!.tag).toBe(0x30)
    expect(bitString!.tag).toBe(0x03)
    // BIT STRING 首字节为未使用位数
    expect(bitString!.value[0]).toBe(0x00)

    const rsaPublicKey = readChildren(bitString!.value.slice(1))
    const spkiModulus = toBigInt(rsaPublicKey[0]!.value)
    const spkiExponent = toBigInt(rsaPublicKey[1]!.value)

    expect(spkiModulus).toBe(privateParts[1])
    expect(spkiExponent).toBe(privateParts[2])
  })

  it('ssh-rsa 行里的 n 与 e 与 PKCS#1 私钥里的模数、指数一致', async () => {
    const pair = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'openssh',
    })

    const blob = atob(pair.publicKey.trim().slice('ssh-rsa '.length))
    const bytes = new Uint8Array(blob.length)
    for (let i = 0; i < blob.length; i++) bytes[i] = blob.charCodeAt(i)

    const algorithm = readTlv(bytes, 0)
    expect(new TextDecoder().decode(algorithm.value)).toBe('ssh-rsa')

    const exponent = readTlv(bytes, algorithm.next)
    const modulus = readTlv(bytes, exponent.next)

    // 同一对密钥的两条完全不同的编码路径：OpenSSH 线上格式 vs PKCS#1 DER
    const privateParts = readChildren(pemToDer(pair.privateKey)).map((child) =>
      toBigInt(child.value),
    )

    expect(toBigInt(exponent.value)).toBe(privateParts[2])
    expect(toBigInt(modulus.value)).toBe(privateParts[1])
  })

  it.skipIf(!HAS_OPENSSL)('openssl rsa -check 通过（外部权威校验）', async () => {
    const pair = await generateRsaKeyPair({
      keySize: 2048,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'spki',
    })

    const path = writeTemp('pkcs1.pem', pair.privateKey)
    const output = execFileSync('openssl', ['rsa', '-check', '-noout', '-in', path], {
      encoding: 'utf8',
    })

    expect(output).toContain('RSA key ok')
  })

  it('私钥与公钥属于同一密钥对（签名 / 验签往返）', async () => {
    const pair = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs8',
      publicKeyFormat: 'spki',
    })

    const privateKey = await globalThis.crypto.subtle.importKey(
      'pkcs8',
      pemToDer(pair.privateKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const publicKey = await globalThis.crypto.subtle.importKey(
      'spki',
      pemToDer(pair.publicKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )

    const message = new TextEncoder().encode('it-toolbox')
    const signature = await globalThis.crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, message)
    const verified = await globalThis.crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature,
      message,
    )

    expect(verified).toBe(true)
  })

  it('支持 1024 / 2048 / 3072 / 4096，非法长度抛 RangeError', async () => {
    const short = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'spki',
    })
    expect(short.keySize).toBe(1024)

    // 运行期守卫：512 只能靠断言传进来，正是要证明「非法长度不会生成密钥」
    const invalidSize = 512 as RsaKeySize
    await expect(
      generateRsaKeyPair({
        keySize: invalidSize,
        privateKeyFormat: 'pkcs1',
        publicKeyFormat: 'spki',
      }),
    ).rejects.toThrow(RangeError)
  }, 30_000)
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run --project core src/core/crypto/rsa.test.ts > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t6-fail.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t6-fail.log`

Expected: FAIL，报 `Failed to resolve import "./rsa"`

- [ ] **Step 4: 写最小实现**

创建 `src/core/crypto/rsa.ts`：

```ts
import { base64ToBytes } from '../bytes'
import { bytesToPem, derInteger, derSequence } from '../der'
import { sshRsaPublicKey } from '../ssh-key'

export type RsaKeySize = 1024 | 2048 | 3072 | 4096
export type PrivateKeyFormat = 'pkcs1' | 'pkcs8'
export type PublicKeyFormat = 'spki' | 'pkcs1' | 'openssh'

export interface RsaKeyPair {
  publicKey: string
  privateKey: string
  algorithm: 'RSASSA-PKCS1-v1_5'
  keySize: RsaKeySize
  generatedAt: number
}

export interface RsaOptions {
  keySize: RsaKeySize
  privateKeyFormat: PrivateKeyFormat
  publicKeyFormat: PublicKeyFormat
}

interface RsaJwkParts {
  n: Uint8Array
  e: Uint8Array
  d: Uint8Array
  p: Uint8Array
  q: Uint8Array
  dp: Uint8Array
  dq: Uint8Array
  qi: Uint8Array
}

const KEY_SIZES: readonly RsaKeySize[] = [1024, 2048, 3072, 4096]

/** JWK 字段是 base64url（无填充）；base64ToBytes 同时接受标准与 url-safe 字母表。 */
function jwkField(jwk: JsonWebKey, name: keyof JsonWebKey): Uint8Array {
  const value = jwk[name]
  if (typeof value !== 'string') {
    throw new RangeError(`JWK 缺少字段 ${String(name)}`)
  }
  const decoded = base64ToBytes(value)
  if (!decoded.ok) {
    throw new RangeError(`JWK 字段 ${String(name)} 不是合法 base64url`)
  }
  return decoded.value
}

function readJwkParts(jwk: JsonWebKey): RsaJwkParts {
  return {
    n: jwkField(jwk, 'n'),
    e: jwkField(jwk, 'e'),
    d: jwkField(jwk, 'd'),
    p: jwkField(jwk, 'p'),
    q: jwkField(jwk, 'q'),
    dp: jwkField(jwk, 'dp'),
    dq: jwkField(jwk, 'dq'),
    qi: jwkField(jwk, 'qi'),
  }
}

/** RSAPrivateKey ::= SEQUENCE { version, n, e, d, p, q, dp, dq, qi }（RFC 8017 A.1.2）。 */
function toPkcs1PrivateKey(parts: RsaJwkParts): Uint8Array {
  return derSequence([
    derInteger(new Uint8Array([0x00])),
    derInteger(parts.n),
    derInteger(parts.e),
    derInteger(parts.d),
    derInteger(parts.p),
    derInteger(parts.q),
    derInteger(parts.dp),
    derInteger(parts.dq),
    derInteger(parts.qi),
  ])
}

/** RSAPublicKey ::= SEQUENCE { n, e }（RFC 8017 A.1.1）。 */
function toPkcs1PublicKey(parts: RsaJwkParts): Uint8Array {
  return derSequence([derInteger(parts.n), derInteger(parts.e)])
}

async function exportPemKey(
  key: CryptoKey,
  format: 'spki' | 'pkcs8',
  label: string,
): Promise<string> {
  const exported = await globalThis.crypto.subtle.exportKey(format, key)
  return bytesToPem(new Uint8Array(exported), label)
}

export async function generateRsaKeyPair(options: RsaOptions): Promise<RsaKeyPair> {
  const { keySize, privateKeyFormat, publicKeyFormat } = options

  if (!KEY_SIZES.includes(keySize)) {
    throw new RangeError(`密钥长度仅支持 ${KEY_SIZES.join(' / ')}`)
  }

  const keyPair = await globalThis.crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: keySize,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    // extractable 必须为 true：否则 exportKey 抛 InvalidAccessError，
    // 而那时密钥已经生成完毕，报错位置离原因很远
    true,
    ['sign', 'verify'],
  )

  const parts = readJwkParts(await globalThis.crypto.subtle.exportKey('jwk', keyPair.privateKey))

  const privateKey =
    privateKeyFormat === 'pkcs8'
      ? await exportPemKey(keyPair.privateKey, 'pkcs8', 'PRIVATE KEY')
      : bytesToPem(toPkcs1PrivateKey(parts), 'RSA PRIVATE KEY')

  const publicKey =
    publicKeyFormat === 'spki'
      ? await exportPemKey(keyPair.publicKey, 'spki', 'PUBLIC KEY')
      : publicKeyFormat === 'pkcs1'
        ? bytesToPem(toPkcs1PublicKey(parts), 'RSA PUBLIC KEY')
        : sshRsaPublicKey(parts.n, parts.e)

  return {
    publicKey,
    privateKey,
    algorithm: 'RSASSA-PKCS1-v1_5',
    keySize,
    generatedAt: Date.now(),
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run --project core src/core/crypto/rsa.test.ts > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t6-pass.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t6-pass.log`

Expected: PASS，9 个用例全绿（其中 openssl 用例在缺失 openssl 时会被 skip；本机已确认 `openssl` 3.4.1 存在，故应为 9 passed / 0 skipped），`exit=0`

- [ ] **Step 6: 跑门禁 + 手动复核 openssl**

Run: `npm test > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t6-all.log 2>&1; echo "test=$?"; npm run typecheck > /dev/null 2>&1; echo "tc=$?"; npm run lint > /dev/null 2>&1; echo "lint=$?"; grep -aE "Test Files|Tests " .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t6-all.log | tail -2`

Expected: `test=0 tc=0 lint=0`，用例总数为 **361 + 9 = 370**

- [ ] **Step 7: 提交**

```bash
git add src/core/crypto/rsa.ts src/core/crypto/rsa.test.ts tsconfig.json eslint.config.js
git commit -m "feat(crypto): 实现 RSA 密钥对生成与 PEM 导出（5.5 / 5.12）

- WebCrypto 生成密钥，JWK 拿全 CRT 参数后自写 DER 组装 PKCS#1，零第三方依赖
- 私钥支持 PKCS#1 / PKCS#8，公钥支持 SPKI / PKCS#1 / OpenSSH 单行
- 三层交叉验证：测试内独立 DER 读取器 + openssl rsa -check（缺失则 skip）
  + 签名验签往返，另有 p*q=n 等 RSA 定义式恒等式
- tsconfig types 增加 node 供交叉验证使用；同时补 ESLint 规则禁止
  core 生产代码 import node:（否则会「类型通过、WebView 崩溃」）"
```

---

### Task 7: Token 生成器工具

对应 `tasks.md` **5.7**；满足 delta spec「Token 生成器」的 6 个 Scenario 中**界面层**的部分（Core 部分已在 Task 1 覆盖）。

**Files:**
- Create: `src/tools/crypto/token-generator/meta.ts`
- Create: `src/tools/crypto/token-generator/Tool.tsx`
- Test: `src/tools/crypto/token-generator/Tool.test.tsx`
- Create: `src/framework/ui/Inputs.test.tsx`
- Modify: `src/framework/ui/Inputs.tsx`（新增 `TextInput`）
- Modify: `src/framework/ui/index.ts`（导出 `TextInput`）

**Interfaces:**
- Consumes: `generateTokens` / `resolveCharset` / `MAX_LENGTH` / `MAX_COUNT` / `MAX_TOTAL_LENGTH` / `CharsetId` from `@/core/crypto/token`；`ToolLayout` / `useToolState` / `CodeArea` / `CopyButton` / `DownloadButton` / `EmptyState` / `ErrorNote` / `Field` / `NumberInput` / `Select` / `TextInput`
- Produces: 工具 `token-generator`（目录名即 id）；`TextInput` 供 Task 9 / Task 10 复用

**为什么本任务要动 `framework/ui`**：Token 需要「前缀」与「自定义字符集」两个自由文本输入，而现有原语里没有文本输入（`Select` / `NumberInput` / `ColorInput` / `Checkbox` / `SegmentedControl`）。在工具里手写 `<input>` 会破坏「所有参数控件用同一套原语」的约束，故补一个 `TextInput` —— 它只有 12 行，且与既有控件共用 `CONTROL` 样式常量。

- [ ] **Step 1: 写失败的界面测试**

> **执行期修正（2026-09-16，提交 `c098b5c`）**：用例数仍是 9，但抓到 3 处缺陷，其中 1 处是本计划遗漏的**跨计划冲突**：
> 1. **jest-dom 匹配器（计划缺陷，且会复发）**：本任务测试用了 3 处 `toHaveTextContent` / `toHaveValue`，而仓库未安装 `@testing-library/jest-dom` ⇒ 实测 4 条用例报 `Invalid Chai property`。仓库在**计划①的 T13 已踩过同一个坑**并留下约定（见 `src/framework/ui/ErrorNote.test.tsx` 顶部注释），故沿用其做法改为 `textContent` + `toContain` 与 `.value` + `toBe`，不新增依赖。**T8 / T9 / T10 是同类 UI 任务，很可能复现，执行时先按此约定改写。**
> 2. **`src/app/App.test.tsx` 的「注册表首项」写死断言（跨计划冲突，原预检漏检）**：该文件断言主面板标题恒为 `UUID 生成器`，并用全局 `getByRole('textbox')` 取搜索框。本任务注册 `token-generator`（id 排序在 `uuid-generator` 之前）后，实测 `expected 'Token 生成器' to be 'UUID 生成器'`，以及**三处** `Found multiple elements with the role "textbox"`（工具自带的「前缀」输入框与搜索框同时在场）。修法（保持原断言意图的最小修正）：首项由 `listTools()[0]` 推导而不写死；「懒加载真的挂载」的证据改为点击侧栏进入确定性工具后断言其按钮；三处文本框查询一律限定在搜索对话框内。**后续每加一个排序在前的工具都会触发同类断言**，故这条修正必须随本任务落地。
> 3. **`git add` 清单漏了 `src/test/setup.ts`（计划缺陷）**：Step 3 明确要改该文件（补 `crypto.subtle` 垫片），Step 7 的 `git add` 却未列出 ⇒ 按实际交付补上。
> 4. **共享文件纪律**：`src/framework/ui/index.ts` 是双工作流共享文件，工作区里含并行工作流**未提交**的 `FileDrop` 两行。暂存时用 `git show HEAD:<file> | sed` 构造「HEAD + 仅本任务那一行」再 `git add`，避免把对方改动卷进本提交；提交后工作区仍原样保留对方两行。
> 5. **计数口径变更**：并行工作流会增补共享文件（如 `framework/file.test.ts`）并新增自建目录（`src/core/web`、`src/tools/web`），继续用「全量 − 并行」推算会漂移 ⇒ 此后改为**直接运行本计划的测试文件**取证。本任务实况：**34 文件 / 389 用例全绿**（其中本计划新增 9 条）。
> 6. 计划的事实断言经实测复核无误：jsdom 30.0.1 下 `crypto` 为 object、`subtle` 为 undefined、`getRandomValues` 为 function，垫片按原文落地。
> 7. **评审反馈（1 Important 成立并闭环 + 3 处漏杀补强）**：`validate` 的总数上限原为 `length * count`，与 `generateTokens` 的 `(length + prefix.length) * count` **口径不同** ⇒ 「界面放行 → core 抛错 → 兜底 catch 静默吞掉 → 输出区只剩「尚未生成」」这条静默路径真实存在（本任务注释里写的「校验通过后 core 仍可能抛错」正是它，却没有把原因显示出来）。已改为同口径，并把兜底 catch 从静默改为显示 core 的原因（`ErrorNote` + 状态栏红字），此后同类不一致不会再退化成静默空态。按评审补强 3 处漏杀：**长度上限 4096 的正例**（否则守卫写成 `>=` 也发现不了）、**前缀计入总数上限的边界**（4000×25 不含前缀刚好不超、含前缀就超）、**落盘内容里含本工具 id**（`'token-generator-v2'` 这类仍含前缀的改名要杀得掉，故断言 JSON 映射里存在该键，而不是内容含该子串）。**新增断言一律并入既有用例，用例数仍为 9** —— 避免下游累计值级联改动。变异检验：`length > → >=`（杀）、工具 id 改名（杀）、**修复前形态**（杀）；「公式退回不含前缀」经实测量为**行为等价变异**（兜底显示原因后，两条路径的用户可见结果相同）。

创建 `src/tools/crypto/token-generator/Tool.test.tsx`（此时 `Tool.tsx` 尚未创建，故必然失败）：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TokenGeneratorTool from './Tool'

/** CodeArea 只读态渲染的是带行号的行列表，故取每行最后一个 span 的文本。 */
function outputLines(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((item) => item.lastElementChild?.textContent ?? '')
}

beforeEach(() => {
  localStorage.clear()
})

describe('Token 生成器', () => {
  it('首次渲染按默认参数生成一个 32 位 Token', () => {
    render(<TokenGeneratorTool />)

    const lines = outputLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toHaveLength(32)
  })

  it('长度改为 64、字符集改为十六进制后输出 64 位十六进制', async () => {
    const user = userEvent.setup()
    render(<TokenGeneratorTool />)

    await user.clear(screen.getByLabelText('长度'))
    await user.type(screen.getByLabelText('长度'), '64')
    await user.selectOptions(screen.getByLabelText('字符集'), 'hex')

    const lines = outputLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('字符集选自定义但内容为空时提示不可为空且不输出结果', async () => {
    const user = userEvent.setup()
    render(<TokenGeneratorTool />)

    await user.selectOptions(screen.getByLabelText('字符集'), 'custom')

    expect(screen.getByRole('alert')).toHaveTextContent('自定义字符集不可为空')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('数量改为 5 时输出 5 行且互不相同', async () => {
    const user = userEvent.setup()
    render(<TokenGeneratorTool />)

    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '5')

    const lines = outputLines()
    expect(lines).toHaveLength(5)
    expect(new Set(lines).size).toBe(5)
  })

  it('前缀 sk_ 会出现在每一行开头', async () => {
    const user = userEvent.setup()
    render(<TokenGeneratorTool />)

    await user.type(screen.getByLabelText('前缀'), 'sk_')
    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '3')

    const lines = outputLines()
    expect(lines).toHaveLength(3)
    for (const line of lines) expect(line.startsWith('sk_')).toBe(true)
  })

  it('长度超出上限时提示范围且不输出结果', async () => {
    const user = userEvent.setup()
    render(<TokenGeneratorTool />)

    await user.clear(screen.getByLabelText('长度'))
    await user.type(screen.getByLabelText('长度'), '4097')

    expect(screen.getByRole('alert')).toHaveTextContent('长度必须为 1 到 4096 之间的整数')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('参数变更后重新挂载仍保留（按工具 id 持久化）', async () => {
    const user = userEvent.setup()
    const first = render(<TokenGeneratorTool />)

    await user.selectOptions(screen.getByLabelText('字符集'), 'hex')
    // 写入去抖 200ms：轮询到真的落盘，而不是死等固定时长。
    // 只断言「确实写入了」，不绑定具体存储键名 —— 键名属 storage.ts 的实现细节。
    await vi.waitFor(() => {
      expect(localStorage.length).toBeGreaterThan(0)
    })
    first.unmount()

    render(<TokenGeneratorTool />)
    expect(screen.getByLabelText('字符集')).toHaveValue('hex')
  })
})
```

同时创建 `src/framework/ui/Inputs.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TextInput } from './Inputs'

describe('TextInput', () => {
  it('用 aria-label 暴露可访问名并显示当前值', () => {
    render(<TextInput label="前缀" value="sk_" onChange={() => {}} />)

    expect(screen.getByLabelText('前缀')).toHaveValue('sk_')
  })

  it('输入时逐字回调完整值', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TextInput label="前缀" value="" onChange={onChange} />)

    await user.type(screen.getByLabelText('前缀'), 'ab')

    expect(onChange).toHaveBeenNthCalledWith(1, 'a')
    expect(onChange).toHaveBeenNthCalledWith(2, 'b')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project ui src/tools/crypto/token-generator src/framework/ui/Inputs.test.tsx > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t7-fail.log 2>&1; echo "exit=$?"; tail -25 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t7-fail.log`

Expected: FAIL，两条 import 解析失败（`./Tool` 与 `TextInput`）

- [ ] **Step 3: 补 `TextInput` 原语与 `crypto.subtle` 测试环境垫片**

先补测试环境垫片。**已实测**：本仓 jsdom 30.0.1 的 `crypto.subtle` 为 `undefined`（`node -e "const {JSDOM}=require('jsdom');console.log(typeof new JSDOM().window.crypto.subtle)"` → `undefined`），而 `crypto.getRandomValues` 存在。Task 9 的 HMAC 工具要断言真实摘要、Task 10 的 RSA 工具要真实生成密钥，二者都跑在 jsdom 项目下，缺了它只能退化成「用 mock 验证 mock」。

修改 `src/test/setup.ts`：在**顶部 import 区**加一行 `import { webcrypto } from 'node:crypto'`，并在文件末尾追加第三个垫片（与该文件既有的 `scrollIntoView` / `matchMedia` 垫片同一风格）：

```ts
// jsdom 30.0.1 不实现 SubtleCrypto（crypto.subtle 为 undefined），而 HMAC 与 RSA
// 工具依赖真实 WebCrypto。Node 的 webcrypto 与浏览器实现同源，直接接管整个 crypto
// （连同 getRandomValues 一起换掉，避免两套 crypto 混用）。
if (typeof window !== 'undefined' && !window.crypto.subtle) {
  Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true })
}
```

用静态 import 而不是顶层 `await import`：本仓 tsconfig 的 target 未必允许 TLA，静态 import 在任何配置下都成立。

然后修改 `src/framework/ui/Inputs.tsx`，在 `SegmentedControl` 之前插入（`CONTROL` 常量已存在于文件顶部）：

```tsx
export function TextInput({
  label,
  value,
  placeholder,
  onChange,
  className,
}: {
  label?: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <input
      aria-label={label}
      type="text"
      className={`${CONTROL} ${className ?? ''}`}
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
```

修改 `src/framework/ui/index.ts` 第 9 行，把 `TextInput` 加入导出：

```ts
export { Checkbox, ColorInput, NumberInput, SegmentedControl, Select, TextInput, ToolbarRow } from './Inputs'
```

- [ ] **Step 4: 写工具实现**

创建 `src/tools/crypto/token-generator/meta.ts`：

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'token-generator',
  name: 'Token 生成器',
  category: 'crypto',
  description: '生成密码学安全的随机 Token，支持字符集、长度、数量与前缀',
  keywords: ['token', '随机', '随机字符串', '密钥', 'apikey', 'secret', '密码', '生成'],
} satisfies ToolMeta
```

创建 `src/tools/crypto/token-generator/Tool.tsx`：

```tsx
import { useEffect, useState } from 'react'
import type { CharsetId } from '@/core/crypto/token'
import {
  MAX_COUNT,
  MAX_LENGTH,
  MAX_TOTAL_LENGTH,
  generateTokens,
  resolveCharset,
} from '@/core/crypto/token'
import type { ErrorInfo } from '@/core/result'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { NumberInput, Select, TextInput } from '@/framework/ui/Inputs'

/** 必须定义在组件外部：useToolState 的 reset 依赖它，每次渲染新建字面量会让依赖持续变化。 */
const INITIAL_STATE = {
  input: '',
  options: {
    length: 32,
    count: 1,
    charset: 'alphanumeric' as CharsetId,
    custom: '',
    prefix: '',
  },
}

const CHARSET_OPTIONS = [
  { value: 'alphanumeric', label: '字母数字' },
  { value: 'hex', label: '十六进制' },
  { value: 'base64', label: 'Base64' },
  { value: 'base64url', label: 'Base64URL' },
  { value: 'custom', label: '自定义' },
] as const

/**
 * 参数校验。
 *
 * 把 core 的守卫在界面上重述一遍，是为了给出**具体原因**：core 抛出的 RangeError
 * 只有消息没有定位，而这里要区分「长度超限」「数量超限」「总数超限」「字符集为空」。
 * 校验通过后 core 仍可能抛错，故生成时另有一层 try/catch 兜底。
 */
function validate(length: number, count: number, charset: CharsetId, custom: string): ErrorInfo | null {
  if (!Number.isInteger(length) || length < 1 || length > MAX_LENGTH) {
    return { error: `长度必须为 1 到 ${MAX_LENGTH} 之间的整数`, code: 'BAD_LENGTH' }
  }
  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
    return { error: `数量必须为 0 到 ${MAX_COUNT} 之间的整数`, code: 'BAD_COUNT' }
  }
  if (charset === 'custom') {
    try {
      resolveCharset(charset, custom)
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : '自定义字符集非法',
        code: 'BAD_CHARSET',
      }
    }
  }
  if (length * count > MAX_TOTAL_LENGTH) {
    return { error: `单次生成的字符总数不得超过 ${MAX_TOTAL_LENGTH}`, code: 'TOO_MANY_CHARS' }
  }
  return null
}

export default function TokenGeneratorTool() {
  const { state, updateOptions } = useToolState('token-generator', INITIAL_STATE)
  const { length, count, charset, custom, prefix } = state.options

  const paramError = validate(length, count, charset, custom)
  // 依赖必须是原始值：paramError 每次渲染都是新对象，直接进 deps 会造成无限渲染循环
  const paramIsValid = paramError === null

  const [tokens, setTokens] = useState<string[]>([])

  useEffect(() => {
    if (!paramIsValid) {
      setTokens((prev) => (prev.length === 0 ? prev : []))
      return
    }
    try {
      setTokens(generateTokens({ length, count, charset, custom, prefix }))
    } catch {
      setTokens((prev) => (prev.length === 0 ? prev : []))
    }
  }, [length, count, charset, custom, prefix, paramIsValid])

  const joined = tokens.join('\n')

  return (
    <ToolLayout
      options={
        <>
          <Field label="字符集">
            <Select
              label="字符集"
              options={CHARSET_OPTIONS}
              value={charset}
              onChange={(value) => updateOptions({ charset: value })}
            />
          </Field>

          {charset === 'custom' && (
            <Field label="自定义字符集">
              <TextInput
                label="自定义字符集"
                value={custom}
                placeholder="例如 abcdef0123456789"
                onChange={(value) => updateOptions({ custom: value })}
              />
            </Field>
          )}

          <Field label="长度">
            <NumberInput
              label="长度"
              value={length}
              min={1}
              max={MAX_LENGTH}
              onChange={(value) => updateOptions({ length: value })}
            />
          </Field>

          <Field label="数量">
            <NumberInput
              label="数量"
              value={count}
              min={1}
              max={MAX_COUNT}
              onChange={(value) => updateOptions({ count: value })}
            />
          </Field>

          <Field label="前缀">
            <TextInput
              label="前缀"
              value={prefix}
              placeholder="例如 sk_"
              onChange={(value) => updateOptions({ prefix: value })}
            />
          </Field>
        </>
      }
      input={
        <div className="p-2.5 text-[12px] text-muted">
          <p>
            随机值取自 <span className="code-text text-fg">crypto.getRandomValues</span>
            ，逐字符等概率选取，不引入取模偏差；自定义字符集会先去重，避免个别字符被重复计权。
          </p>
        </div>
      }
      output={
        paramError ? (
          <ErrorNote info={paramError} />
        ) : tokens.length === 0 ? (
          <EmptyState title="尚未生成" hint="调整上方参数即可生成" />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={joined} label="复制全部" />
              <DownloadButton filename="tokens.txt" text={joined} />
            </div>
            <CodeArea value={joined} readOnly label="生成的 Token" />
          </>
        )
      }
      status={
        paramError ? (
          <span className="text-danger">{paramError.error}</span>
        ) : (
          <span>共 {tokens.length} 条</span>
        )
      }
    />
  )
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run --project ui src/tools/crypto/token-generator src/framework/ui/Inputs.test.tsx > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t7-pass.log 2>&1; echo "exit=$?"; tail -25 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t7-pass.log`

Expected: PASS，9 个用例全绿（Token 7 + TextInput 2）

**已知陷阱**：`Field` 用 `<label>` 包裹子控件，可访问名以子控件自身的 `aria-label` 为准（`Select` / `NumberInput` / `TextInput` 都显式设置了它，故 `getByLabelText('字符集')` 等查询成立）。若某条查询拿不到元素，先确认传入的 `label` 文案与查询一致，**不要**为了让查询通过而改动组件实现。

- [ ] **Step 6: 跑门禁**

Run: `npm test > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t7-all.log 2>&1; echo "test=$?"; npm run typecheck > /dev/null 2>&1; echo "tc=$?"; npm run lint > /dev/null 2>&1; echo "lint=$?"; grep -aE "Test Files|Tests " .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t7-all.log | tail -2`

Expected: `test=0 tc=0 lint=0`，用例总数为 **370 + 9 = 379**，且 `registry.test.ts` 的不变式（meta/Tool 配对、id 与目录名一致）自动通过

- [ ] **Step 7: 提交**

```bash
git add src/tools/crypto/token-generator src/framework/ui/Inputs.tsx src/framework/ui/Inputs.test.tsx src/framework/ui/index.ts
git commit -m "feat(crypto): 实现 Token 生成器工具与 TextInput 原语（5.7）

- 字符集 / 长度 / 数量 / 前缀四个参数，自定义字符集为空时明确提示
- 参数非法时给出具体原因并清空输出，不做静默空态
- 新增 TextInput 原语（现有控件无自由文本输入），与既有控件共用 CONTROL 样式
- 7 条界面用例覆盖默认生成、参数变更、错误提示、批量、前缀与状态恢复"
```

---

### Task 8: ULID 生成器工具

对应 `tasks.md` **5.9**；满足 delta spec「ULID 生成器」的 4 个 Scenario 中界面层的部分（Core 部分已在 Task 2 覆盖）。

**Files:**
- Create: `src/tools/crypto/ulid-generator/meta.ts`
- Create: `src/tools/crypto/ulid-generator/Tool.tsx`
- Test: `src/tools/crypto/ulid-generator/Tool.test.tsx`

**Interfaces:**
- Consumes: `generateUlids` / `decodeUlidTimestamp` / `MAX_COUNT` from `@/core/crypto/ulid`；与 Task 7 相同的框架原语
- Produces: 工具 `ulid-generator`

**大小写属于「呈现」而非「生成」**：与 UUID 工具的连字符 / 大写选项同理 —— 状态里只保留规范形式（大写），切换大小写只影响渲染，不触发重新生成。这样勾选「小写」不会让已生成的一批 ULID 变成另一批。

- [ ] **Step 1: 写失败的界面测试**

> **执行期修正（2026-09-16）**：用例数仍是 6，抓到 2 处测试缺陷（其中 1 处与 T7 同源）：
> 1. **jest-dom 匹配器（同 T7，会复发）**：本任务用了 `toBeInTheDocument`（2 处）与 `toHaveTextContent`，仓库未安装 `@testing-library/jest-dom` ⇒ 必然报 `Invalid Chai property`。按仓库既有约定改为语义等价断言；其中「状态行展示解码出的时间戳」的两条断言合并为一条更结实的断言（`getByText(锚定正则).textContent` 匹配时间戳格式），避免退化成 `toBeDefined()` 这种恒真的写法。
> 2. **`getByText(/时间戳/)` 会撞车**：Testing Library 按元素的**直接文本节点**匹配，而输入区说明文字里也含「时间戳」二字 ⇒ 状态行 `span` 与输入区 `p` 各命中一次，实测 `Found multiple elements`。改为锚定状态行的正则 `/^共 \d+ 条 · 时间戳 /` —— 断言意图（状态行展示解码时间戳）不变且更精确。
> 3. **实现侧一处主动加固**：本任务原代码的 `catch` 是静默的（与 T7 修复前的形态相同）。既然 T7 评审已确认「兜底不能静默」这条原则，这里也同样改为把 core 的原因显示出来（`blockingError = paramError ?? generateError`），保持同族工具一致，避免同一类静默空态在另一个工具里重演。
> 4. 门禁口径：本任务后我的范围为 **35 文件 / 395 用例**（389 + 6）；同刻全量 53 / 619。`registry.test.ts` 的不变式与 `App.test.tsx` 的首项断言均自动通过（后者已在 T7 改为从 `listTools()[0]` 推导，不再随新增工具失效）。
> 5. **评审反馈（1 处规范缺口 + 3 处漏杀闭环，2 处判为等价变异）**：spec 的「时间戳可解析」明确要求**偏差 ≤ 2 秒**，原用例只查格式 ⇒ 补「把展示文本独立解析回时间再与 `Date.now()` 比对」（变异「解码不参与状态行」实测被杀）。空态分支只在 count=0 时可达而无用例（变异「空态分支不可达」原为漏杀）⇒ 并入数量用例；毫秒 `pad` 写成 1 位原为 ~90% 的 flaky 漏杀 ⇒ 把时钟固定到毫秒位 `007` 使其确定；单调性用例补「整批前 10 字符必须相同」（排除跨毫秒假象）并按建议加 `__resetUlidStateForTests()` 做隔离。`validate` 边界放宽为 `MAX_COUNT*2` 与去掉 `paramIsValid` 依赖经判定为**行为等价变异**（前者由 core 抛同文案、`blockingError` 显示同一条原因；后者在单参数下确实冗余，是给将来加参数预留的守卫），故不补测。另修 1 处 Minor：解码失败分支原写死「共 0 条」，与仍渲染的列表自相矛盾，改为「共 N 条」。

创建 `src/tools/crypto/ulid-generator/Tool.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UlidGeneratorTool from './Tool'

function outputLines(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((item) => item.lastElementChild?.textContent ?? '')
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ULID 生成器', () => {
  it('首次渲染生成 10 条 26 位 ULID', () => {
    render(<UlidGeneratorTool />)

    const lines = outputLines()
    expect(lines).toHaveLength(10)
    for (const line of lines) expect(line).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('状态行展示解码出的时间戳', () => {
    render(<UlidGeneratorTool />)

    expect(screen.getByText(/时间戳/)).toBeInTheDocument()
    expect(screen.getByText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/)).toBeInTheDocument()
  })

  it('取消大写后输出为小写，且不改变已生成的那一批', async () => {
    const user = userEvent.setup()
    render(<UlidGeneratorTool />)

    const before = outputLines()
    await user.click(screen.getByLabelText('大写'))

    const after = outputLines()
    expect(after).toHaveLength(before.length)
    for (let i = 0; i < after.length; i++) {
      expect(after[i]).toBe(before[i]!.toLowerCase())
    }
  })

  it('数量改为 20 时输出 20 行且互不相同', async () => {
    const user = userEvent.setup()
    render(<UlidGeneratorTool />)

    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '20')

    const lines = outputLines()
    expect(lines).toHaveLength(20)
    expect(new Set(lines).size).toBe(20)
  })

  it('同一毫秒内的批量结果字典序严格递增', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const user = userEvent.setup()
    render(<UlidGeneratorTool />)

    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '30')

    const lines = outputLines()
    expect(lines).toHaveLength(30)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]! > lines[i - 1]!).toBe(true)
    }
  })

  it('数量超出上限时提示范围且不输出结果', async () => {
    const user = userEvent.setup()
    render(<UlidGeneratorTool />)

    await user.clear(screen.getByLabelText('数量'))
    await user.type(screen.getByLabelText('数量'), '1001')

    expect(screen.getByRole('alert')).toHaveTextContent('数量必须为 0 到 1000 之间的整数')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project ui src/tools/crypto/ulid-generator > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t8-fail.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t8-fail.log`

Expected: FAIL，报 `Failed to resolve import "./Tool"`

- [ ] **Step 3: 写实现**

创建 `src/tools/crypto/ulid-generator/meta.ts`：

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'ulid-generator',
  name: 'ULID 生成器',
  category: 'crypto',
  description: '生成 ULID：26 位、按时间有序，并展示内嵌时间戳',
  keywords: ['ulid', '时间有序', '有序id', '唯一标识', '26位', '排序id', '单调'],
} satisfies ToolMeta
```

创建 `src/tools/crypto/ulid-generator/Tool.tsx`：

```tsx
import { useEffect, useMemo, useState } from 'react'
import { MAX_COUNT, decodeUlidTimestamp, generateUlids } from '@/core/crypto/ulid'
import type { ErrorInfo } from '@/core/result'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { Checkbox, NumberInput } from '@/framework/ui/Inputs'

const INITIAL_STATE = {
  input: '',
  options: {
    count: 10,
    uppercase: true,
  },
}

/** 本地时间的 `YYYY-MM-DD HH:mm:ss.SSS`；不用 toLocaleString，避免跨环境格式差异。 */
function formatTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
  ].join(' ')
}

function validate(count: number): ErrorInfo | null {
  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
    return { error: `数量必须为 0 到 ${MAX_COUNT} 之间的整数`, code: 'BAD_COUNT' }
  }
  return null
}

export default function UlidGeneratorTool() {
  const { state, updateOptions } = useToolState('ulid-generator', INITIAL_STATE)
  const { count, uppercase } = state.options

  const paramError = validate(count)
  const paramIsValid = paramError === null

  // 规范形式：恒为大写，随机段与时间戳都由 core 决定
  const [canonical, setCanonical] = useState<string[]>([])

  useEffect(() => {
    if (!paramIsValid) {
      setCanonical((prev) => (prev.length === 0 ? prev : []))
      return
    }
    try {
      setCanonical(generateUlids({ count }))
    } catch {
      setCanonical((prev) => (prev.length === 0 ? prev : []))
    }
  }, [count, paramIsValid])

  // 大小写只影响渲染：切换它不会让已生成的一批 ULID 变成另一批
  const rendered = useMemo(
    () => (uppercase ? canonical : canonical.map((item) => item.toLowerCase())),
    [canonical, uppercase],
  )

  const joined = rendered.join('\n')
  const firstTimestamp = canonical.length > 0 ? decodeUlidTimestamp(canonical[0]!) : null
  const lastTimestamp =
    canonical.length > 1 ? decodeUlidTimestamp(canonical[canonical.length - 1]!) : null

  return (
    <ToolLayout
      options={
        <>
          <Field label="数量">
            <NumberInput
              label="数量"
              value={count}
              min={1}
              max={MAX_COUNT}
              onChange={(value) => updateOptions({ count: value })}
            />
          </Field>
          <Checkbox
            label="大写"
            checked={uppercase}
            onChange={(checked) => updateOptions({ uppercase: checked })}
          />
        </>
      }
      input={
        <div className="p-2.5 text-[12px] text-muted">
          <p>
            ULID 的前 10 个字符是 48 位毫秒时间戳，因此按字典序排列即为时间顺序。同一毫秒内
            连续生成时递增随机段，溢出则推进到下一毫秒，保证严格单调。
          </p>
        </div>
      }
      output={
        paramError ? (
          <ErrorNote info={paramError} />
        ) : rendered.length === 0 ? (
          <EmptyState title="尚未生成" hint="调整上方参数即可生成" />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={joined} label="复制全部" />
              <DownloadButton filename="ulids.txt" text={joined} />
            </div>
            <CodeArea value={joined} readOnly label="生成的 ULID" />
          </>
        )
      }
      status={
        paramError ? (
          <span className="text-danger">{paramError.error}</span>
        ) : firstTimestamp === null ? (
          <span>共 0 条</span>
        ) : lastTimestamp === null ? (
          <span>
            时间戳 {formatTimestamp(firstTimestamp)}
          </span>
        ) : (
          <span>
            共 {rendered.length} 条 · 时间戳 {formatTimestamp(firstTimestamp)} ~{' '}
            {formatTimestamp(lastTimestamp)}
          </span>
        )
      }
    />
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project ui src/tools/crypto/ulid-generator > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t8-pass.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t8-pass.log`

Expected: PASS，6 个用例全绿

- [ ] **Step 5: 跑门禁**

Run: `npm test > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t8-all.log 2>&1; echo "test=$?"; npm run typecheck > /dev/null 2>&1; echo "tc=$?"; npm run lint > /dev/null 2>&1; echo "lint=$?"; grep -aE "Test Files|Tests " .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t8-all.log | tail -2`

Expected: `test=0 tc=0 lint=0`，用例总数为 **379 + 6 = 385**

- [ ] **Step 6: 提交**

```bash
git add src/tools/crypto/ulid-generator
git commit -m "feat(crypto): 实现 ULID 生成器工具（5.9）

- 批量生成与大小写选项，状态行展示解码出的时间戳（单条给时间，多条给区间）
- 大小写只影响渲染，切换不会重算已生成的一批
- 时间戳格式化手写补零，避免 toLocaleString 的跨环境差异"
```

---

### Task 9: HMAC 生成器工具

对应 `tasks.md` **5.10**；满足 delta spec「HMAC 生成器」的 6 个 Scenario 中界面层的部分（Core 部分已在 Task 3 覆盖）。

**Files:**
- Create: `src/tools/crypto/hmac-generator/meta.ts`
- Create: `src/tools/crypto/hmac-generator/Tool.tsx`
- Test: `src/tools/crypto/hmac-generator/Tool.test.tsx`

**Interfaces:**
- Consumes: `computeHmac` / `HmacAlgorithm` / `InputEncoding` / `OutputEncoding` from `@/core/crypto/hmac`；`TextInput`（Task 7 新增）
- Produces: 工具 `hmac-generator`

**默认密钥与消息都为空**：这正是 spec 的「密钥为空」Scenario 的初始状态，首次渲染即呈现「密钥不可为空」的提示，而不是先算一个用户没输入过的摘要。计算是异步的（`crypto.subtle` 返回 Promise），因此 effect 里必须带**过期结果守卫** —— 快速连改参数时，先发出的计算可能后返回，把旧摘要覆盖到新参数上。

- [ ] **Step 1: 写失败的界面测试**

创建 `src/tools/crypto/hmac-generator/Tool.test.tsx`：

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import HmacGeneratorTool from './Tool'

/** 只读 CodeArea 的行取值方式与 Task 7 相同。 */
function outputLines(): string[] {
  return screen
    .getAllByRole('listitem')
    .map((item) => item.lastElementChild?.textContent ?? '')
}

describe('HMAC 生成器', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('未填密钥时首次渲染即提示密钥不可为空且无输出', () => {
    render(<HmacGeneratorTool />)

    expect(screen.getByRole('alert')).toHaveTextContent('密钥不可为空')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('填入密钥与消息后产出 64 位十六进制摘要', async () => {
    const user = userEvent.setup()
    render(<HmacGeneratorTool />)

    await user.type(screen.getByLabelText('密钥'), 'secret')
    await user.type(screen.getByLabelText('消息'), 'hello')

    await waitFor(() => {
      expect(outputLines()[0]).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  it('切换到 SHA-512 后摘要变长到 128 位', async () => {
    const user = userEvent.setup()
    render(<HmacGeneratorTool />)

    await user.type(screen.getByLabelText('密钥'), 'secret')
    await user.type(screen.getByLabelText('消息'), 'hello')
    await waitFor(() => expect(outputLines()[0]).toMatch(/^[0-9a-f]{64}$/))

    await user.selectOptions(screen.getByLabelText('算法'), 'SHA-512')

    await waitFor(() => expect(outputLines()[0]).toMatch(/^[0-9a-f]{128}$/))
  })

  it('输出改为 Base64URL 后无填充、无 + 与 /', async () => {
    const user = userEvent.setup()
    render(<HmacGeneratorTool />)

    await user.type(screen.getByLabelText('密钥'), 'secret')
    await user.type(screen.getByLabelText('消息'), 'hello')
    await user.selectOptions(screen.getByLabelText('输出编码'), 'base64url')

    await waitFor(() => {
      const line = outputLines()[0]!
      expect(line.length).toBeGreaterThan(0)
      expect(line).not.toContain('=')
      expect(line).not.toMatch(/[+/]/)
    })
  })

  it('密钥编码选十六进制但内容非法时提示密钥格式非法', async () => {
    const user = userEvent.setup()
    render(<HmacGeneratorTool />)

    await user.selectOptions(screen.getByLabelText('密钥编码'), 'hex')
    await user.type(screen.getByLabelText('密钥'), 'zz')

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('密钥格式非法')
    })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('消息变化后摘要随之改变', async () => {
    const user = userEvent.setup()
    render(<HmacGeneratorTool />)

    await user.type(screen.getByLabelText('密钥'), 'secret')
    await user.type(screen.getByLabelText('消息'), 'hello')
    await waitFor(() => expect(outputLines()[0]).toMatch(/^[0-9a-f]{64}$/))
    const first = outputLines()[0]

    await user.type(screen.getByLabelText('消息'), '!')

    await waitFor(() => expect(outputLines()[0]).not.toBe(first))
  })

  it('状态行展示算法与摘要十六进制长度', async () => {
    const user = userEvent.setup()
    render(<HmacGeneratorTool />)

    await user.type(screen.getByLabelText('密钥'), 'secret')
    await user.type(screen.getByLabelText('消息'), 'hello')

    await waitFor(() => {
      // 断言必须锚定整段状态文案：单选一个 /SHA-256/ 会同时命中 <option>（算法下拉项）
      // 与状态行两个元素，getByText 直接抛「Found multiple elements」
      expect(screen.getByText(/SHA-256 · 摘要 256 位 · hex/)).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project ui src/tools/crypto/hmac-generator > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t9-fail.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t9-fail.log`

Expected: FAIL，报 `Failed to resolve import "./Tool"`

- [ ] **Step 3: 写实现**

创建 `src/tools/crypto/hmac-generator/meta.ts`：

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'hmac-generator',
  name: 'HMAC 生成器',
  category: 'crypto',
  description: '计算 HMAC 消息认证码，支持四种算法与多编码输入输出',
  keywords: ['hmac', '签名', '摘要', '消息认证', 'sha256', 'sha512', 'mac', '校验'],
} satisfies ToolMeta
```

创建 `src/tools/crypto/hmac-generator/Tool.tsx`：

```tsx
import { useEffect, useState } from 'react'
import type { HmacAlgorithm, InputEncoding, OutputEncoding } from '@/core/crypto/hmac'
import { computeHmac } from '@/core/crypto/hmac'
import type { ErrorInfo } from '@/core/result'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { Select, TextInput } from '@/framework/ui/Inputs'

const INITIAL_STATE = {
  input: '',
  options: {
    key: '',
    algorithm: 'SHA-256' as HmacAlgorithm,
    messageEncoding: 'utf8' as InputEncoding,
    keyEncoding: 'utf8' as InputEncoding,
    outputEncoding: 'hex' as OutputEncoding,
  },
}

const ALGORITHM_OPTIONS = [
  { value: 'SHA-1', label: 'SHA-1' },
  { value: 'SHA-256', label: 'SHA-256' },
  { value: 'SHA-384', label: 'SHA-384' },
  { value: 'SHA-512', label: 'SHA-512' },
] as const

const INPUT_ENCODING_OPTIONS = [
  { value: 'utf8', label: 'UTF-8 文本' },
  { value: 'hex', label: '十六进制' },
  { value: 'base64', label: 'Base64' },
] as const

const OUTPUT_ENCODING_OPTIONS = [
  { value: 'hex', label: '十六进制' },
  { value: 'base64', label: 'Base64' },
  { value: 'base64url', label: 'Base64URL' },
] as const

const DIGEST_BITS: Record<HmacAlgorithm, number> = {
  'SHA-1': 160,
  'SHA-256': 256,
  'SHA-384': 384,
  'SHA-512': 512,
}

export default function HmacGeneratorTool() {
  const { state, update, updateOptions } = useToolState('hmac-generator', INITIAL_STATE)
  const { key, algorithm, messageEncoding, keyEncoding, outputEncoding } = state.options
  const message = state.input

  const [digest, setDigest] = useState<string | null>(null)
  const [error, setError] = useState<ErrorInfo | null>(null)

  useEffect(() => {
    // 过期结果守卫：快速连改参数时，先发出的计算可能后返回
    let cancelled = false

    void (async () => {
      const result = await computeHmac({
        message,
        key,
        algorithm,
        messageEncoding,
        keyEncoding,
        outputEncoding,
      })
      if (cancelled) return

      if (result.ok) {
        setDigest(result.value)
        setError(null)
      } else {
        setDigest(null)
        setError({
          error: result.error,
          code: result.code,
          detail: result.detail,
          offset: result.offset,
          suggestion: result.suggestion,
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [message, key, algorithm, messageEncoding, keyEncoding, outputEncoding])

  return (
    <ToolLayout
      options={
        <>
          <Field label="算法">
            <Select
              label="算法"
              options={ALGORITHM_OPTIONS}
              value={algorithm}
              onChange={(value) => updateOptions({ algorithm: value })}
            />
          </Field>

          <Field label="密钥">
            <TextInput
              label="密钥"
              value={key}
              placeholder="填入密钥"
              onChange={(value) => updateOptions({ key: value })}
            />
          </Field>

          <Field label="密钥编码">
            <Select
              label="密钥编码"
              options={INPUT_ENCODING_OPTIONS}
              value={keyEncoding}
              onChange={(value) => updateOptions({ keyEncoding: value })}
            />
          </Field>

          <Field label="消息编码">
            <Select
              label="消息编码"
              options={INPUT_ENCODING_OPTIONS}
              value={messageEncoding}
              onChange={(value) => updateOptions({ messageEncoding: value })}
            />
          </Field>

          <Field label="输出编码">
            <Select
              label="输出编码"
              options={OUTPUT_ENCODING_OPTIONS}
              value={outputEncoding}
              onChange={(value) => updateOptions({ outputEncoding: value })}
            />
          </Field>
        </>
      }
      input={
        <CodeArea
          label="消息"
          placeholder="填入要计算摘要的消息"
          value={message}
          onChange={(value) => update({ input: value })}
        />
      }
      output={
        error !== null ? (
          <ErrorNote info={error} />
        ) : digest === null ? (
          <EmptyState title="尚无摘要" hint="填入密钥后即自动计算" />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={digest} label="复制摘要" />
            </div>
            <CodeArea value={digest} readOnly label="摘要" />
          </>
        )
      }
      status={
        error !== null ? (
          <span className="text-danger">{error.error}</span>
        ) : (
          <span>
            {algorithm} · 摘要 {DIGEST_BITS[algorithm]} 位 · {outputEncoding}
          </span>
        )
      }
    />
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project ui src/tools/crypto/hmac-generator > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t9-pass.log 2>&1; echo "exit=$?"; tail -20 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t9-pass.log`

Expected: PASS，7 个用例全绿

- [ ] **Step 5: 跑门禁**

Run: `npm test > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t9-all.log 2>&1; echo "test=$?"; npm run typecheck > /dev/null 2>&1; echo "tc=$?"; npm run lint > /dev/null 2>&1; echo "lint=$?"; grep -aE "Test Files|Tests " .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t9-all.log | tail -2`

Expected: `test=0 tc=0 lint=0`，用例总数为 **385 + 7 = 392**

- [ ] **Step 6: 提交**

```bash
git add src/tools/crypto/hmac-generator
git commit -m "feat(crypto): 实现 HMAC 生成器工具（5.10）

- 算法 / 密钥 / 三种输入编码 / 三种输出编码共五个参数
- 密钥为空与非法编码直接呈现 core 返回的原因（含偏移），不静默失败
- 异步计算带过期结果守卫，快速连改参数不会被旧结果覆盖
- 7 条界面用例覆盖空密钥、摘要生成、算法切换、编码切换与错误路径"
```

---

### Task 10: RSA 密钥对生成器工具

对应 `tasks.md` **5.11**（「生成中禁用重复提交、参数变更不自动重算、公钥私钥分别复制与导出」三条都落在本任务）；满足 delta spec「RSA 密钥对生成器」的 4 个 Scenario 中界面层的部分（Core 与格式正确性已在 Task 6 覆盖，含 openssl 交叉验证）。

**Files:**
- Create: `src/tools/crypto/rsa-key-generator/meta.ts`
- Create: `src/tools/crypto/rsa-key-generator/Tool.tsx`
- Test: `src/tools/crypto/rsa-key-generator/Tool.test.tsx`
- Modify: `src/framework/ui/Inputs.tsx`（新增 `Button`）
- Modify: `src/framework/ui/Inputs.test.tsx`（追加 `Button` 用例）
- Modify: `src/framework/ui/index.ts`（导出 `Button`）

**Interfaces:**
- Consumes: `generateRsaKeyPair` / `RsaKeySize` / `PrivateKeyFormat` / `PublicKeyFormat` / `RsaKeyPair` from `@/core/crypto/rsa`；`Spinner` / `Button` / `CopyButton` / `DownloadButton` / `CodeArea` / `EmptyState` / `ErrorNote` / `Field` / `Select`
- Produces: 工具 `rsa-key-generator`

**三条硬约束**：

1. **不自动重算**：spec 明确「生成结果保留直到用户重新生成」。故**不得**写任何依赖参数的 `useEffect` 去调 `generateRsaKeyPair` —— 改参数只让状态行出现「参数已变更，点击生成以应用」，结果区原样保留。
2. **密钥材料不落盘**：结果只放 `useState`，**不**写进 `useToolState`（它会把 options 与 input 写进 localStorage）。私钥进 localStorage 是真实的安全问题，且 spec 只要求「保留直至重新生成」，不要求跨会话保留。参数照常持久化。
3. **生成中禁用按钮**：`generateRsaKeyPair` 是异步的，2048 位要 100ms 级、4096 位可达秒级，不禁用就能连点出多份密钥对并把先完成的一份丢弃。

**为什么本任务要动 `framework/ui`**：仓库里没有通用按钮原语（`CopyButton` / `DownloadButton` 各自渲染 `<button>`），而「生成」是一次性动作按钮。补一个 `Button` 并沿用 `CopyButton` 的类名约定，好过在工具里手写 `<button>` 破坏「参数与动作都走原语」的约束。

- [ ] **Step 1: 写失败的界面测试**

创建 `src/tools/crypto/rsa-key-generator/Tool.test.tsx`：

```tsx
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RsaKeyGeneratorTool from './Tool'

/**
 * 可控的失败 / 延迟开关。
 *
 * 用 vi.hoisted 而不是普通顶层 const：vi.mock 的工厂会被提升到文件顶部，
 * 引用未初始化的普通变量会直接抛错。
 */
const mockRsa = vi.hoisted(() => ({ delayMs: 0, fail: false }))

vi.mock('@/core/crypto/rsa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/crypto/rsa')>()
  return {
    ...actual,
    generateRsaKeyPair: async (options: Parameters<typeof actual.generateRsaKeyPair>[0]) => {
      if (mockRsa.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, mockRsa.delayMs))
      }
      if (mockRsa.fail) throw new Error('模拟密钥生成失败')
      return actual.generateRsaKeyPair(options)
    },
  }
})

/** 每个 region 内的只读 CodeArea 行（readOnly 渲染的是带行号的行列表）。 */
function linesOf(regionName: string): string[] {
  const region = screen.getByRole('region', { name: regionName })
  return within(region)
    .getAllByRole('listitem')
    .map((item) => item.lastElementChild?.textContent ?? '')
}

const generateButton = () => screen.getByRole('button', { name: '生成密钥对' })
const publicText = () => linesOf('公钥').join('')
const privateText = () => linesOf('私钥').join('')

beforeEach(() => {
  localStorage.clear()
  mockRsa.delayMs = 0
  mockRsa.fail = false
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RSA 密钥对生成器', () => {
  it('首次渲染是空态，不自动生成', () => {
    render(<RsaKeyGeneratorTool />)

    expect(screen.getByText('尚未生成')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('点击生成后同时展示公钥与私钥', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())

    await waitFor(() => {
      expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----')
      expect(privateText()).toContain('-----BEGIN RSA PRIVATE KEY-----')
    })
  })

  it('生成中按钮禁用，完成后恢复可用', async () => {
    mockRsa.delayMs = 40
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())

    // 按钮文案在生成前后不变，故这里仍能按名取到同一个按钮
    expect(generateButton()).toBeDisabled()
    await waitFor(() => expect(generateButton()).toBeEnabled(), { timeout: 3000 })
  })

  it('修改参数不自动重算：结果保留，状态行提示参数已变更', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----'))
    const before = publicText()

    await user.selectOptions(screen.getByLabelText('密钥长度'), '1024')

    expect(screen.getByText(/参数已变更/)).toBeInTheDocument()
    expect(publicText()).toBe(before)
  })

  it('重新点击生成后应用新参数并刷新结果', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----'))
    const before = publicText()

    await user.selectOptions(screen.getByLabelText('密钥长度'), '1024')
    await user.click(generateButton())

    await waitFor(() => expect(publicText()).not.toBe(before))
    expect(screen.queryByText(/参数已变更/)).not.toBeInTheDocument()
  })

  it('公钥格式选 OpenSSH 时输出单行 ssh-rsa', async () => {
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.selectOptions(screen.getByLabelText('公钥格式'), 'openssh')
    await user.click(generateButton())

    await waitFor(() => expect(publicText()).toMatch(/^ssh-rsa /))
  })

  it('生成失败时展示原因且不保留旧结果', async () => {
    mockRsa.fail = true
    const user = userEvent.setup()
    render(<RsaKeyGeneratorTool />)

    await user.click(generateButton())

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('模拟密钥生成失败')
    })
    expect(screen.queryByRole('region', { name: '公钥' })).not.toBeInTheDocument()
  })

  it('参数持久化但密钥材料不落盘：重新挂载回到空态', async () => {
    const user = userEvent.setup()
    const first = render(<RsaKeyGeneratorTool />)

    await user.selectOptions(screen.getByLabelText('密钥长度'), '1024')
    await user.click(generateButton())
    await waitFor(() => expect(publicText()).toContain('-----BEGIN PUBLIC KEY-----'))
    await vi.waitFor(() => expect(localStorage.length).toBeGreaterThan(0))
    first.unmount()

    render(<RsaKeyGeneratorTool />)

    expect(screen.getByLabelText('密钥长度')).toHaveValue('1024')
    expect(screen.getByText('尚未生成')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '公钥' })).not.toBeInTheDocument()
  })
})
```

同时修改 `src/framework/ui/Inputs.test.tsx`，追加：

```tsx
describe('Button', () => {
  it('点击时回调，禁用时不回调', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = render(<Button onClick={onClick}>生成</Button>)

    await user.click(screen.getByRole('button', { name: '生成' }))
    expect(onClick).toHaveBeenCalledTimes(1)

    rerender(
      <Button onClick={onClick} disabled>
        生成
      </Button>,
    )
    expect(screen.getByRole('button', { name: '生成' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '生成' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
```

（`Inputs.test.tsx` 顶部需把 `Button` 加入既有的 import。）

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project ui src/tools/crypto/rsa-key-generator src/framework/ui/Inputs.test.tsx > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t10-fail.log 2>&1; echo "exit=$?"; tail -25 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t10-fail.log`

Expected: FAIL，两条 import 解析失败（`./Tool` 与 `Button`）

- [ ] **Step 3: 补 `Button` 原语**

修改 `src/framework/ui/Inputs.tsx`，在 `ToolbarRow` 之前插入：

```tsx
/** 一次性动作按钮。类名沿用 CopyButton 的约定，保证工具栏内高度与圆角一致。 */
export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: ReactNode
  onClick: () => void
  disabled?: boolean
  variant?: 'primary' | 'ghost'
}) {
  const tone =
    variant === 'primary'
      ? 'bg-accent text-white hover:opacity-90'
      : 'text-muted hover:bg-surface-2 hover:text-fg'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-6 items-center gap-1 rounded-sm px-2 text-[12px] disabled:opacity-40 ${tone}`}
    >
      {children}
    </button>
  )
}
```

修改 `src/framework/ui/index.ts` 第 9 行：

```ts
export { Button, Checkbox, ColorInput, NumberInput, SegmentedControl, Select, TextInput, ToolbarRow } from './Inputs'
```

- [ ] **Step 4: 写工具实现**

创建 `src/tools/crypto/rsa-key-generator/meta.ts`：

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'rsa-key-generator',
  name: 'RSA 密钥对生成器',
  category: 'crypto',
  description: '在本地生成 RSA 密钥对，导出 PKCS#1 / PKCS#8 / SPKI / OpenSSH 格式',
  keywords: ['rsa', '密钥对', 'pem', 'pkcs1', 'pkcs8', 'spki', 'openssh', '公钥', '私钥', '生成'],
} satisfies ToolMeta
```

创建 `src/tools/crypto/rsa-key-generator/Tool.tsx`：

```tsx
import { useState } from 'react'
import type { PrivateKeyFormat, PublicKeyFormat, RsaKeyPair, RsaKeySize } from '@/core/crypto/rsa'
import { generateRsaKeyPair } from '@/core/crypto/rsa'
import type { ErrorInfo } from '@/core/result'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { Button, Select } from '@/framework/ui/Inputs'
import { Spinner } from '@/framework/ui/Spinner'

const INITIAL_STATE = {
  input: '',
  options: {
    keySize: '2048',
    privateKeyFormat: 'pkcs1' as PrivateKeyFormat,
    publicKeyFormat: 'spki' as PublicKeyFormat,
  },
}

const KEY_SIZE_OPTIONS = [
  { value: '1024', label: '1024 位' },
  { value: '2048', label: '2048 位（推荐）' },
  { value: '3072', label: '3072 位' },
  { value: '4096', label: '4096 位（较慢）' },
] as const

const PRIVATE_FORMAT_OPTIONS = [
  { value: 'pkcs1', label: 'PKCS#1（RSA PRIVATE KEY）' },
  { value: 'pkcs8', label: 'PKCS#8（PRIVATE KEY）' },
] as const

const PUBLIC_FORMAT_OPTIONS = [
  { value: 'spki', label: 'SPKI（PUBLIC KEY）' },
  { value: 'pkcs1', label: 'PKCS#1（RSA PUBLIC KEY）' },
  { value: 'openssh', label: 'OpenSSH（ssh-rsa）' },
] as const

/** 生成时用的参数快照：用来判断当前参数是否与结果不一致。 */
interface GenerateSnapshot {
  keySize: RsaKeySize
  privateKeyFormat: PrivateKeyFormat
  publicKeyFormat: PublicKeyFormat
}

function isStale(
  snapshot: GenerateSnapshot | null,
  current: GenerateSnapshot,
): boolean {
  if (snapshot === null) return false
  return (
    snapshot.keySize !== current.keySize ||
    snapshot.privateKeyFormat !== current.privateKeyFormat ||
    snapshot.publicKeyFormat !== current.publicKeyFormat
  )
}

export default function RsaKeyGeneratorTool() {
  const { state, updateOptions } = useToolState('rsa-key-generator', INITIAL_STATE)
  const { keySize, privateKeyFormat, publicKeyFormat } = state.options

  // 密钥材料只存在内存里：不写进 useToolState，避免私钥落进 localStorage
  const [pair, setPair] = useState<RsaKeyPair | null>(null)
  const [snapshot, setSnapshot] = useState<GenerateSnapshot | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<ErrorInfo | null>(null)

  const numericKeySize = Number(keySize) as RsaKeySize
  const stale = isStale(snapshot, {
    keySize: numericKeySize,
    privateKeyFormat,
    publicKeyFormat,
  })

  // 刻意不写依赖参数的 useEffect：spec 要求结果保留直至用户重新生成
  const handleGenerate = async () => {
    setIsGenerating(true)
    setError(null)
    try {
      const next = await generateRsaKeyPair({ keySize: numericKeySize, privateKeyFormat, publicKeyFormat })
      setPair(next)
      setSnapshot({ keySize: numericKeySize, privateKeyFormat, publicKeyFormat })
    } catch (cause) {
      setPair(null)
      setSnapshot(null)
      setError({
        error: cause instanceof Error ? cause.message : '密钥生成失败',
        code: 'RSA_GENERATE_FAILED',
        suggestion: '换用更小的密钥长度后重试',
      })
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <ToolLayout
      options={
        <>
          <Field label="密钥长度">
            <Select
              label="密钥长度"
              options={KEY_SIZE_OPTIONS}
              value={keySize}
              onChange={(value) => updateOptions({ keySize: value })}
            />
          </Field>
          <Field label="私钥格式">
            <Select
              label="私钥格式"
              options={PRIVATE_FORMAT_OPTIONS}
              value={privateKeyFormat}
              onChange={(value) => updateOptions({ privateKeyFormat: value })}
            />
          </Field>
          <Field label="公钥格式">
            <Select
              label="公钥格式"
              options={PUBLIC_FORMAT_OPTIONS}
              value={publicKeyFormat}
              onChange={(value) => updateOptions({ publicKeyFormat: value })}
            />
          </Field>
          {/* 文案在生成前后保持一致：改文案会让按可访问名定位的查询在生成中失效，
              且按钮已被 Spinner 与禁用态表达清楚 */}
          <Button onClick={() => void handleGenerate()} disabled={isGenerating}>
            生成密钥对
          </Button>
        </>
      }
      input={
        <div className="p-2.5 text-[12px] text-muted">
          <p>
            密钥在你自己的设备上用 WebCrypto 生成，全程不发往任何服务器。私钥只保留在当前
            会话的内存中，刷新或重新打开工具后需要重新生成。
          </p>
          <p className="mt-2">
            1024 位已不足以抵抗现代算力，仅用于兼容旧系统；一般用途选 2048 位，长期用途选
            3072 位以上。
          </p>
        </div>
      }
      output={
        error !== null ? (
          <ErrorNote info={error} />
        ) : isGenerating ? (
          <div className="flex h-full items-center justify-center">
            <Spinner label="正在生成密钥对…" />
          </div>
        ) : pair === null ? (
          <EmptyState title="尚未生成" hint="选择参数后点击生成" />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <section aria-label="公钥" className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-1.5 py-1">
                <span className="text-[12px] text-muted">公钥</span>
                <span className="inline-flex items-center gap-1">
                  <CopyButton text={pair.publicKey} label="复制公钥" />
                  <DownloadButton
                    filename={publicKeyFormat === 'openssh' ? 'public.pub' : 'public.pem'}
                    text={pair.publicKey}
                  />
                </span>
              </div>
              <CodeArea value={pair.publicKey} readOnly />
            </section>

            <section aria-label="私钥" className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-1.5 py-1">
                <span className="text-[12px] text-muted">私钥</span>
                <span className="inline-flex items-center gap-1">
                  <CopyButton text={pair.privateKey} label="复制私钥" />
                  <DownloadButton filename="private.pem" text={pair.privateKey} />
                </span>
              </div>
              <CodeArea value={pair.privateKey} readOnly />
            </section>
          </div>
        )
      }
      status={
        error !== null ? (
          <span className="text-danger">{error.error}</span>
        ) : isGenerating ? (
          <span>正在生成…</span>
        ) : stale ? (
          <span className="text-danger">参数已变更，点击生成以应用</span>
        ) : pair === null ? (
          <span>尚未生成</span>
        ) : (
          <span>
            已生成 {pair.keySize} 位密钥对 · 私钥 {privateKeyFormat} · 公钥 {publicKeyFormat}
          </span>
        )
      }
    />
  )
}
```

**import 路径要点**：`Button` 与 `Select` 来自 `@/framework/ui/Inputs`（本任务把 `Button` 加在这个文件里，**不存在** `ui/Button.tsx`）；`CodeArea` / `CopyButton` / `DownloadButton` / `EmptyState` / `ErrorNote` / `Field` / `Spinner` 各自一个文件；`Button` / `Checkbox` / `ColorInput` / `NumberInput` / `SegmentedControl` / `Select` / `TextInput` / `ToolbarRow` 都从 `Inputs.tsx` 出。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run --project ui src/tools/crypto/rsa-key-generator src/framework/ui/Inputs.test.tsx > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t10-pass.log 2>&1; echo "exit=$?"; tail -25 .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t10-pass.log`

Expected: PASS，9 个用例全绿（RSA 8 + Button 1）

**若 `crypto.subtle` 相关报错**（`Cannot read properties of undefined (reading 'generateKey')`）：说明 Task 7 的 `src/test/setup.ts` 垫片没生效，先确认垫片存在再继续 —— 该文件是 `ui` project 的 `setupFiles`，对本任务所有用例生效。

- [ ] **Step 6: 跑门禁**

Run: `npm test > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t10-all.log 2>&1; echo "test=$?"; npm run typecheck > /dev/null 2>&1; echo "tc=$?"; npm run lint > /dev/null 2>&1; echo "lint=$?"; grep -aE "Test Files|Tests " .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t10-all.log | tail -2`

Expected: `test=0 tc=0 lint=0`，用例总数为 **392 + 9 = 401**

- [ ] **Step 7: 提交**

```bash
git add src/tools/crypto/rsa-key-generator src/framework/ui/Inputs.tsx src/framework/ui/Inputs.test.tsx src/framework/ui/index.ts
git commit -m "feat(crypto): 实现 RSA 密钥对生成器工具与 Button 原语（5.6）

- 改参数不自动重算，状态行提示「参数已变更，点击生成以应用」
- 私钥只存内存不落盘（useToolState 会写 localStorage），参数照常持久化
- 生成中禁用按钮，避免连点产生多份密钥对
- 公钥/私钥各用一个带 aria-label 的 region，便于按区域取值与导出
- 新增 Button 原语，沿用 CopyButton 的类名约定"
```

---

### Task 11: 覆盖核对、变异检验与本计划验收

对应 `tasks.md` **5.6**（「编写上述 Core 的 Vitest 用例，覆盖 spec 中全部 Scenario（含非法输入分支）」）—— 用例本身分布在前 10 个任务里，本任务负责**逐条核对覆盖**，并完成本计划的整体验收与 tasks.md 勾选。

**Files:**
- Modify: `openspec/changes/it-toolbox-app/tasks.md`（勾选 10 项）

**本任务不写新代码**（核对若发现缺口，才回补用例并在本任务内补跑门禁）。

- [ ] **Step 1: 逐条核对 spec Scenario 覆盖**

先列出 delta spec 里的全部 Scenario：

Run: `grep -n "^#### Scenario:" openspec/changes/it-toolbox-app/specs/crypto-tools/spec.md > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-scenarios.txt 2>&1; cat .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-scenarios.txt`

然后为**每一条** Scenario 填写下表并写入 `docs/superpowers/plans/2026-09-16-it-toolbox-crypto-tools.md` 的末尾（表格追加在本任务之后即可）：

| Requirement | Scenario | 覆盖用例（文件 :: 用例名） |
|---|---|---|
| Token 生成器 | <Scenario 原文> | `core/crypto/token.test.ts` :: <用例名> |
| … | … | … |

**判定标准（不许放宽）**：

1. 每条 Scenario 必须指到一个**具体的 `it(...)` 用例名**。指不到的，说明覆盖有缺口 —— 回补用例、跑绿、再填表。
2. 不许写「已由实现保证」「由类型系统保证」之类的替代答案。
3. 界面层的 Scenario 指到 `src/tools/crypto/*/Tool.test.tsx` 的用例；Core 层的指到 `src/core/**` 的用例。
4. `grep` 出来的 Scenario 条数应与下表填写后的行数**相等**（4 个 Requirement 合计）。不等则说明漏填。

- [ ] **Step 2: 变异检验（一变一命令）**

对三处关键逻辑各做一次变异，确认**失败的用例名正是预期的那条**。**落一处变异 → 单独一条命令跑目标文件 → 核对 → 用编辑工具反向还原**；不要用 `git checkout` 还原（对未提交文件整条命令会失败，对已提交文件会丢掉未提交的修复）。

| # | 变异位置 | 变异内容 | 预期失败的用例 |
|---|---|---|---|
| A | `src/core/crypto/token.ts` 的 `resolveCharset` | 去掉自定义字符集的去重（`new Set(...)` 那步） | `token.test.ts` :: 自定义字符集里的重复字符只按一次计权 |
| B | `src/core/der.ts` 的 `derInteger` | 把 `needsPad` 恒置为 `false` | `der.test.ts` :: 最高位为 1 时补一个 0x00（正数语义）**且** `rsa.test.ts` :: 独立读取器解析 PKCS#1 私钥后，CRT 参数满足数学恒等式 |
| C | `src/core/crypto/ulid.ts` 的 `generateUlids` | 删掉同毫秒内的 `incrementRandom` 分支（每次都重新取随机） | `ulid.test.ts` :: 同一毫秒内连续生成 200 个，字典序严格递增 |

每处变异的命令形态：

Run: `npx vitest run --project core src/core/der.test.ts > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-mut-B.log 2>&1; echo "exit=$?"; grep -aE "×|✓ .*失败|Tests " .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-mut-B.log | head -20`

Expected: `exit≠0`，且日志里失败的**用例名集合包含**上表「预期失败的用例」（一处变异可能同时打挂多条用例，不要求恰好一条）。

**若变异没有让任何用例失败**：说明该用例是「跟实现一起写死的伪测试」，回去把它改成能独立判定的断言（例如用外部向量或数学恒等式），而不是删掉变异。

- [ ] **Step 3: 跑全量门禁并记录最终数字**

Run: `npm test > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t11-all.log 2>&1; echo "test=$?"; npm run typecheck > /dev/null 2>&1; echo "tc=$?"; npm run lint > /dev/null 2>&1; echo "lint=$?"; npm run scan:egress > /dev/null 2>&1; echo "egress=$?"; grep -aE "Test Files|Tests " .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-t11-all.log | tail -2`

Expected: `test=0 tc=0 lint=0 egress=0`，用例总数 **401**，测试文件数 **36**。

**这两个数字的来历**：计划① 收尾（T20 记录）实测 25 个测试文件 / 289 个用例；本计划新增 11 个测试文件（6 个 core + 4 个工具 + 1 个 `Inputs.test.tsx`）与 112 个用例（14 + 19 + 15 + 17 + 7 + 9 + 9 + 6 + 7 + 9 = 112）。**若实测与预期不符，以实测为准并回报差异**，不要改计划里的数字去凑。

- [ ] **Step 4: 勾选 tasks.md**

把 `openspec/changes/it-toolbox-app/tasks.md` 里下面 10 行的 `- [ ]` 改为 `- [x]`（**其余内容一字不改**）：

```
- [ ] 5.1 实现 `core/crypto/token.ts`：安全随机、字符集（字母数字/hex/base64/base64url/自定义）、长度、数量、前缀
- [ ] 5.3 实现 `core/crypto/ulid.ts`：Crockford Base32 编解码、时间戳解析、同毫秒单调递增
- [ ] 5.4 实现 `core/crypto/hmac.ts`：SHA-1/256/384/512、密钥编码（UTF-8/hex/base64）、输出编码（hex/base64/base64url）
- [ ] 5.5 实现 `core/crypto/rsa.ts`：密钥对生成、PEM 导出（PKCS#1 / PKCS#8 / SPKI / OpenSSH）
- [ ] 5.6 编写上述 Core 的 Vitest 用例，覆盖 spec 中全部 Scenario（含非法输入分支）
- [ ] 5.7 实现 Token 生成器工具（含字符集为空的校验提示）
- [ ] 5.9 实现 ULID 生成器工具（展示解码出的时间戳）
- [ ] 5.10 实现 HMAC 生成器工具（含密钥为空与非法 hex 的提示）
- [ ] 5.11 实现 RSA 密钥对生成器工具（生成中禁用重复提交、参数变更不自动重算、公钥私钥分别复制与导出）
- [ ] 5.12 实现 `core/der.ts`（DER 最小写入器）与 `core/ssh-key.ts`（OpenSSH 公钥组装），并编写交叉验证用例：测试内独立 DER 读取器互校、`openssl rsa -check`（缺失则 skip）、`ssh-rsa` 与 JWK 的 n/e 比对
```

**5.2 与 5.8 已是 `[x]`（计划① 交付），本计划不动它们。** 勾完之后，`tasks.md` 里第 5 组应无 `- [ ]` 残留：

Run: `grep -c "^- \[ \] 5\." openspec/changes/it-toolbox-app/tasks.md; grep -c "^- \[x\] 5\." openspec/changes/it-toolbox-app/tasks.md`

Expected: 第一条输出 `0`，第二条输出 `12`（5.1–5.12 全部完成）

- [ ] **Step 5: 提交**

```bash
git add openspec/changes/it-toolbox-app/tasks.md docs/superpowers/plans/2026-09-16-it-toolbox-crypto-tools.md
git commit -m "chore(openspec): 勾选 tasks.md 第 5 组加密工具条目，计划②-1 收尾

- 10 项（5.1 / 5.3–5.7 / 5.9–5.12）全部完成，覆盖表与变异检验结果记入计划文件
- 全量门禁：401 用例 / 36 文件，typecheck、lint、egress 扫描全绿
- 剩余未完成条目属计划②-2 / ②-3 / ②-4（转换器 / Web / 图片与开发）"
```

---

## 收尾提示（给执行者）

本计划完成后**不要**自行进入 `/comet-verify`：`tasks.md` 仍有计划②-2 / ②-3 / ②-4 的条目未完成，verify 的入口检查会再次以 `phase=build` 阻塞。正确的下一步是**撰写计划②-2（转换器工具）**，沿用本计划的文件结构与任务模板。
