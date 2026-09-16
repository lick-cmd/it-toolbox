---
change: it-toolbox-app
design-doc: docs/superpowers/specs/2026-09-15-it-toolbox-design.md
base-ref: 17c5517ea8bd64b74bf20c629d440551cde5c3b8
---

# IT Toolbox 转换器工具集 实施计划（计划②-2 / 共 4 份）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付转换器类别下全部 5 个工具（日期转换器、Base64 编码/解码、YAML→JSON、JSON→YAML、Markdown→HTML）及其 Core 层实现与测试，使 `tasks.md` 第 6 组（6.1–6.12）全部闭合。

**Architecture:** 沿用计划① / ②-1 已证实的模式：算法落在 `core/converter/`（纯函数、零 React / 零 Tauri / 零 DOM，在 Node 环境毫秒级可测），呈现交给 `framework/` 的 `ToolLayout` + `useToolState` + `ui/*` 原语，工具本身只有 `meta.ts`（同步元数据）+ `Tool.tsx`（懒加载组件）两个文件，由 `import.meta.glob` 自动注册。**本计划不新增任何运行时依赖**：`js-yaml` 与 `markdown-it` 已在 `package.json` 中（计划① 已加入），日期与 Base64 走既有 `core/bytes.ts` 与 `Date`。

**Tech Stack:** 沿用现有栈 —— Tauri 2.11 · React 19.3 · TypeScript · Vite · Vitest（`core` 用 node 环境 / `ui` 用 jsdom）· Tailwind CSS 4 · `js-yaml@5.4.2`（自带类型）· `markdown-it@15.0.2`（自带类型）。

**Spec:** `openspec/changes/it-toolbox-app/specs/converter-tools/spec.md`（本计划实现其中全部 5 个 Requirement 的全部 Scenario）+ `docs/superpowers/specs/2026-09-15-it-toolbox-design.md` §3.3 / §3.4 / §9.2 / §9.5

**本计划的范围：** 对应 `tasks.md` 的 6.1–6.12（12 项），并顺带补齐 6.7 依赖的 `framework/ui/FileDrop`（`tasks.md` 3.2 中「文件拖入」那一项的框架侧落点）。**不含** crypto（计划②-1）、web / image / dev（计划②-3、②-4）。

---

## Global Constraints

以下约束隐含适用于**每一个任务**，不再逐条重复。

| 约束 | 精确值 |
|---|---|
| 分层依赖 | `core/` 不得 import React、Tauri、DOM API；`core/` 不得 import `framework/`、`tools/`、`app/`；`framework/` 不得 import `tools/` |
| 新增依赖 | **零新增**。只允许使用 `package.json` 中已有的 `js-yaml` 与 `markdown-it`；禁止再引入任何第三方库 |
| 运行期网络行为 | **零出网请求**。Markdown 预览里的远程图片必须是占位块，**不得**产生 `<img src="https://…">`；外部链接不得渲染成可导航的 `<a href>` |
| 单平台安装包体积 | **≤ 15MB**（本计划不新增依赖，故不改变体积量级；计划① 实测 2.2MB） |
| `core` 层测试环境 | `node`（`vitest.config.ts` 的 `core` project，`include: ['src/core/**/*.test.ts']`） |
| `tools` 层测试环境 | `jsdom`（`ui` project 的 `include` 已含 `src/tools/**/*.test.{ts,tsx}` —— 计划① 的 R84 修复，勿再质疑该 glob） |
| 生成类函数的错误约定 | 生成类（无非法输入分支）返回终值，参数非法时抛 `RangeError` |
| 解析类函数的错误约定 | 解析类（非法输入是常规路径）一律返回 `Result<T>`（`ok` / `err`，见 `core/result.ts`），**不得抛异常给 UI** |
| 界面文案与视觉 | UI 字号 13px、代码区 12.5px 等宽、圆角 4px、无阴影（浮层除外）；所有参数控件用 `framework/ui` 原语，不手写 `<select>` / `<input type="checkbox">` |
| 中文文案 | 界面文案一律中文；`keywords` 同时含英文与中文关键词（如 `['base64', '编码', '解码']`） |
| 工具 id | 与目录名严格一致、kebab-case；`registry.test.ts` 会强制校验，写错即测试失败 |
| 空输入语义 | 5 个工具的空输入一律**不报错、不输出**（渲染 `EmptyState`），与 spec 的「空输入」Scenario 一致 |

### 版本与 API 事实（已于 2026-09-16 核实，勿臆改）

- **`js-yaml@5.4.2` 是 ESM 具名导出，没有 default 导出**：`import { load, dump, YAMLException } from 'js-yaml'`。写 `import yaml from 'js-yaml'` 会在运行期抛 `does not provide an export named 'default'`。**已在 Node 中实测**。
- `js-yaml` 的 `load(input, options?)` / `dump(value, options?)` 是同步函数。`load` 遇到空输入或纯空白**会抛 `YAMLException`（`expected a document, but the input is empty`，且 `mark` 为 `undefined`）**，故必须在调用前用 `text.trim().length === 0` 拦截。
- `js-yaml` 的 `YAMLException.mark` 形如 `{ position, line, column, snippet }`，且 **`line` 与 `column` 均为 0 基**（实测：`'a: 1\n  b: 2\n'` → `line: 1, column: 3`，即第 2 行第 4 列附近）。**上报给 `ErrorInfo` 前必须各 +1**。
- `js-yaml` 的 `dump` 支持 `indent` / `lineWidth` / `noRefs`：`dump(v, { indent: 2, lineWidth: -1, noRefs: true })`。`lineWidth: -1`（不折行）与 `noRefs: true`（重复对象内联，不产出锚点/别名）是**往返一致性**的前提。
- `markdown-it@15.0.2` 的类型是 **default 导出**：`import MarkdownIt from 'markdown-it'`（`MarkdownItCallable as default`）。`new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false })`。
- `markdown-it` 的 `render(src, env?)` 第二参数是 `Env | undefined`，`Env` 为 `{ [key: string | symbol]: unknown }`；渲染规则签名是 `(tokens, idx, options, env, renderer) => string`，其中 `env` 类型为 `Env | undefined`，取值前必须判空并 `as` 收窄。
- **`html: false` 下 markdown-it 会把原始 HTML 转义**（实测 `<script>alert(1)</script>` → `<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>`），因此「原始 HTML 标签被转义」「预览中不执行脚本」两条 Scenario 由该选项直接满足。
- **`markdown-it` 默认的 `image` 规则会输出真实的 `<img src="…">`**（实测远程图片会原样出现在 HTML 里），必须覆写 `renderer.rules.image`。
- **`markdown-it` 默认的 `link_open` 规则会输出 `<a href="…">`**，必须覆写 `link_open` / `link_close` 以消除可导航链接。
- `core/bytes.ts` 导出：`utf8ToBytes`、`bytesToUtf8`(→`Result<string>`，非 UTF-8 时返回 `err` 且 `code: 'BAD_UTF8'`)、`bytesToHex(bytes, upper?)`、`utf8ByteLength`、`hexToBytes`(→`Result<Uint8Array>`)、`bytesToBase64(bytes, {variant,padding})`、`base64ToBytes(input)`(→`Result<Uint8Array>`，**同时接受标准与 url-safe 两套字母表**，故解码侧无需感知 variant)。
- `core/json/scanner.ts` 的 `scanJson(text)` 返回 `{ok:true;tokens}` 或 `{ok:false}&ErrorInfo`（`error`/`code`/`detail`/`offset`/`line`/`column` 齐备），**这是 JSON 侧唯一的错误定位来源**，不得改用 `JSON.parse` 的报错。
- `framework/file.ts` 导出 `isTauri()`、`downloadBlob(filename, blob)`、`downloadText(filename, text, mime?)`；本计划会再补一个 `downloadBytes`。
- `framework/ui/index.ts` 已导出：`CodeArea`（`value`/`onChange`/`readOnly`/`label`/`placeholder`/`rows`/`errorLine`/`errorOffset`，另有 `lineOfOffset`）、`CopyButton`（`text`/`label`/`disabled`）、`DownloadButton`（`filename`/`text`/`mime`/`label`/`disabled`）、`EmptyState`（`title`/`hint`）、`ErrorNote`（`info: ErrorInfo`）、`Field`（`label`/`hint`/`children`）、`Icon`、`Checkbox` / `ColorInput` / `NumberInput` / `SegmentedControl` / `Select` / `ToolbarRow`、`Pane`、`Spinner`
- `ToolLayout` 的判别联合：标准形态传 `input` + `output`；自由形态传 `body`。本计划 5 个工具**全部使用标准形态**（Markdown 的预览作为 `output` 的自定义渲染插入即可）。
- `useToolState(toolId, initial)` 返回 `{ state, update, updateOptions, reset }`；`initial` **必须定义在组件外部**（否则 `reset` 的依赖每次渲染都变）。
- **依赖必须是原始值**：`useToolState` / `useEffect` / `useMemo` 的依赖里不得出现每次渲染新建的对象或数组（计划① 的 R16 实测过无限渲染循环导致界面卡死、测试进程挂起 15 分钟）。本计划统一用 `[input, options.mode, options.variant, …]` 这样的原始值依赖。
- `CodeArea` 在 `readOnly` 时渲染**行号列表**（不是 textarea）；测试中读值要按 `listitem` 取，不能按 textarea 取。可编辑态是带 `aria-label` 的 `<textarea>`，用 `getByRole('textbox', { name })` 查询。

### 实现者须知（本仓库与本环境的既有事实，避免重复踩坑）

1. **测试输出会被执行环境吞掉**：`npm test` 的 stdout 可能被当作长驻服务丢弃。请把输出重定向到日志文件再用读取工具查看，例如
   `npm test > .superpowers/sdd/2026-09-15-it-toolbox-foundation/p02-converter-<task>.log 2>&1; echo "exit=$?"`
2. **单文件测试**用 `npx vitest run --project core src/core/converter/date.test.ts`（`core` 是项目名，不是路径）。
3. **变异检验一律「一变一命令」**：落一处变异 → 单独一条命令跑测试 → 逐次核对「失败的用例名 == 预期目标」→ 用编辑工具反向还原（**不要用 `git checkout` 还原**）。
4. **评审派发**：只读子代理，提示内限定「最多 12 次工具调用、不要整读计划文件、报告 ≤ 2500 字符」。
5. **每完成一个任务立即提交**，提交信息说明该任务对应的 `tasks.md` 编号。

---

## File Structure

```
it-tool/
├── src/core/converter/
│   ├── date.ts                             【新】多格式日期解析 + 多表示输出 + 单位指定
│   ├── date.test.ts                        【新】
│   ├── base64.ts                           【新】UTF-8 文本 / 字节的 Base64 编解码
│   ├── base64.test.ts                      【新】
│   ├── yaml.ts                             【新】yamlToJson / jsonToYaml（含错误定位）
│   ├── yaml.test.ts                        【新】
│   ├── markdown.ts                         【新】markdownToHtml（转义 + 图片占位 + 去除可导航链接）
│   └── markdown.test.ts                    【新】
├── src/framework/
│   ├── file.ts                             【改】新增 downloadBytes(filename, bytes, mime?)
│   └── ui/
│       ├── FileDrop.tsx                    【新】文件拖入 / 选择
│       ├── FileDrop.test.tsx               【新】
│       └── index.ts                        【改】导出 FileDrop
├── src/app/theme.css                       【改】新增 .md-preview 样式（Markdown 预览）
├── src/tools/converter/
│   ├── date-converter/{meta.ts, Tool.tsx, Tool.test.tsx}            【新】
│   ├── base64/{meta.ts, Tool.tsx, Tool.test.tsx}                    【新】
│   ├── yaml-to-json/{meta.ts, Tool.tsx, Tool.test.tsx}              【新】
│   ├── json-to-yaml/{meta.ts, Tool.tsx, Tool.test.tsx}              【新】
│   └── markdown-to-html/{meta.ts, Tool.tsx, Tool.test.tsx}          【新】
└── openspec/changes/it-toolbox-app/tasks.md                          【改】勾选 6.1–6.12
```

**为何 `core/converter/` 的四个文件都只导出「解析/编码」而不含任何格式化偏好**：UI 选项（缩进、变体、视图）以参数形式传入，默认值写在 Core；工具层只做「把控件值翻译成参数」。这样 spec 的每个 Scenario 都能在 Node 里直接断言，不需要启动 WebView。

**为何 Markdown 的预览样式放在 `app/theme.css` 而不是工具目录**：Tailwind 的 preflight 会把 `h1` / `table` 的默认样式清零，不补样式的话预览与源码视图没有可辨识差异。CSS 是全局单例，工具目录放不进去（`framework/` 不得 import `tools/`，反向也没必要）。

---

## 任务间接口约定（先读这一节，再看各任务）

本计划 11 个任务由不同实现者负责，彼此只能通过下列签名协作。**任何任务都不得自行改名。**

```ts
// src/core/converter/date.ts
export type TimestampUnit = 'auto' | 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds'
export interface TimestampUnitOption { value: TimestampUnit; label: string }
export const TIMESTAMP_UNITS: readonly TimestampUnitOption[]
export interface DateParse {
  epochMs: number
  kind: 'timestamp' | 'date'
  unit?: Exclude<TimestampUnit, 'auto'>
  basis: string
  inputFormat: string
  ambiguous: boolean
}
export interface DateField { id: string; label: string; value: string }
export function parseDateInput(text: string, unit?: TimestampUnit): Result<DateParse>
export function toDateFields(epochMs: number, now?: number): DateField[]
export function relativeTime(epochMs: number, now?: number): string

// src/core/converter/base64.ts
export type Base64Variant = 'standard' | 'urlsafe'
export interface Base64Options { variant?: Base64Variant; padding?: boolean }
export function encodeBytes(bytes: Uint8Array, options?: Base64Options): string
export function encodeText(text: string, options?: Base64Options): string
export function decodeToBytes(text: string): Result<Uint8Array>
export function decodeToText(text: string, options?: Base64Options): Result<string>

// src/core/converter/yaml.ts
export type YamlIndent = 2 | 4
export interface YamlToJsonOptions { indent?: YamlIndent }
export function yamlToJson(text: string, options?: YamlToJsonOptions): Result<string>
export function jsonToYaml(text: string): Result<string>

// src/core/converter/markdown.ts
export function markdownToHtml(source: string): string

// src/framework/file.ts（新增）
export function downloadBytes(filename: string, bytes: Uint8Array, mime?: string): Promise<Result<void>>

// src/framework/ui/FileDrop.tsx
export interface FileDropProps {
  onFile: (file: File) => void
  label?: string
  hint?: string
  disabled?: boolean
}
export function FileDrop(props: FileDropProps): ReactElement
```

---

### Task 1: `core/converter/date.ts` —— 日期解析与多表示输出

对应 `tasks.md` **6.1 / 6.5 / 6.11**；满足 delta spec 的 Requirement「日期转换器」的全部 8 个 Scenario。

**Files:**
- Create: `src/core/converter/date.ts`
- Test: `src/core/converter/date.test.ts`

**Interfaces:**
- Consumes: `ok` / `err` / `Result` from `../result`
- Produces: 见上「任务间接口约定」的 `date.ts` 段。Task 6 的日期转换器工具消费 `parseDateInput` / `toDateFields` / `TIMESTAMP_UNITS` / `DateField` / `TimestampUnit`

- [ ] **Step 1: 写失败测试**

创建 `src/core/converter/date.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  parseDateInput,
  relativeTime,
  TIMESTAMP_UNITS,
  toDateFields,
} from './date'

/** 断言解析成功并取出值；失败时把错误原样抛出，便于定位 */
function mustParse(text: string, unit?: Parameters<typeof parseDateInput>[1]) {
  const result = parseDateInput(text, unit)
  if (!result.ok) throw new Error(`期望解析成功，实际失败：${result.error}`)
  return result.value
}

const field = (fields: ReturnType<typeof toDateFields>, id: string) =>
  fields.find((item) => item.id === id)?.value

describe('parseDateInput —— 数字型输入', () => {
  it('秒级时间戳：1700000000 → ISO UTC 为 2023-11-14T22:13:20.000Z', () => {
    const parsed = mustParse('1700000000')
    expect(parsed.kind).toBe('timestamp')
    expect(parsed.unit).toBe('seconds')
    expect(parsed.inputFormat).toContain('Unix 时间戳')
    expect(new Date(parsed.epochMs).toISOString()).toBe('2023-11-14T22:13:20.000Z')
  })

  it('毫秒级时间戳：1700000000000 不被误判为秒级', () => {
    const parsed = mustParse('1700000000000')
    expect(parsed.unit).toBe('milliseconds')
    expect(new Date(parsed.epochMs).toISOString()).toBe('2023-11-14T22:13:20.000Z')
  })

  it('微秒 / 纳秒按位数识别并归一到毫秒', () => {
    expect(mustParse('1700000000000000').unit).toBe('microseconds')
    expect(mustParse('1700000000000000000').unit).toBe('nanoseconds')
    expect(mustParse('1700000000000000000').epochMs).toBe(1700000000000)
  })

  it('手动指定单位会覆盖自动判定，并在依据中标注单位', () => {
    const parsed = mustParse('1700000000', 'milliseconds')
    expect(parsed.unit).toBe('milliseconds')
    expect(parsed.epochMs).toBe(1700000000)
    expect(parsed.basis).toContain('用户指定')
    expect(parsed.basis).toContain('毫秒')
  })

  it('歧义数字输入（8 位，例如 20240315）给出判定依据并标记 ambiguous', () => {
    const parsed = mustParse('20240315')
    expect(parsed.ambiguous).toBe(true)
    expect(parsed.basis).toContain('8 位数字')
    expect(parsed.basis).toContain('秒')
  })

  it('超出可表示范围的时间戳返回错误', () => {
    const result = parseDateInput('999999999999999999999999')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('OUT_OF_RANGE')
  })
})

describe('parseDateInput —— 日期字符串', () => {
  it('ISO 8601（带 Z）按 UTC 解释并标注格式', () => {
    const parsed = mustParse('2024-03-15T08:30:00Z')
    expect(parsed.kind).toBe('date')
    expect(parsed.inputFormat).toBe('ISO 8601')
    expect(parsed.epochMs).toBe(Date.UTC(2024, 2, 15, 8, 30, 0))
    expect(parsed.basis).toContain('时区')
  })

  it('带时区偏移（+08:00）按偏移换算', () => {
    const parsed = mustParse('2024-03-15T08:30:00+08:00')
    expect(parsed.epochMs).toBe(Date.UTC(2024, 2, 15, 0, 30, 0))
  })

  it('YYYY-MM-DD 按本地零点解释并标注格式', () => {
    const parsed = mustParse('2024-03-15')
    expect(parsed.inputFormat).toBe('YYYY-MM-DD')
    expect(parsed.epochMs).toBe(new Date(2024, 2, 15).getTime())
  })

  it('YYYY/MM/DD HH:mm:ss 按本地时间解释并标注格式', () => {
    const parsed = mustParse('2024/03/15 08:30:00')
    expect(parsed.inputFormat).toBe('YYYY/MM/DD HH:mm:ss')
    expect(parsed.epochMs).toBe(new Date(2024, 2, 15, 8, 30, 0).getTime())
  })

  it('不存在的日期（2024-02-31）被拒绝', () => {
    const result = parseDateInput('2024-02-31')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_DATE')
  })

  it('无法识别的输入返回 UNRECOGNIZED_DATE', () => {
    const result = parseDateInput('not-a-date')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('无法识别')
      expect(result.code).toBe('UNRECOGNIZED_DATE')
    }
  })

  it('空输入返回 EMPTY_INPUT', () => {
    const result = parseDateInput('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('EMPTY_INPUT')
  })
})

describe('toDateFields —— 多表示之间的自洽', () => {
  it('秒级时间戳乘以 1000 与毫秒级一致，且 ISO UTC 描述同一时刻', () => {
    const parsed = mustParse('1700000000')
    const fields = toDateFields(parsed.epochMs)
    const seconds = Number(field(fields, 'unix-seconds'))
    const milliseconds = Number(field(fields, 'unix-milliseconds'))
    expect(seconds * 1000).toBe(milliseconds)

    const isoField = field(fields, 'iso-utc')
    expect(isoField).toBe('2023-11-14T22:13:20.000Z')
    expect(new Date(isoField ?? '').getTime()).toBe(milliseconds)
  })

  it('输出七项表示，且 RFC 2822 使用数字时区', () => {
    const fields = toDateFields(Date.UTC(2023, 10, 14, 22, 13, 20))
    expect(fields.map((item) => item.id)).toEqual([
      'unix-seconds',
      'unix-milliseconds',
      'iso-utc',
      'iso-local',
      'rfc-2822',
      'localized',
      'relative',
    ])
    expect(field(fields, 'rfc-2822')).toMatch(
      /^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} \+0000$/,
    )
  })
})

describe('relativeTime —— 相对时间', () => {
  const now = Date.UTC(2024, 2, 15, 8, 30, 0)

  it('同一时刻为「刚刚」', () => {
    expect(relativeTime(now, now)).toBe('刚刚')
  })

  it('过去与未来分别带「前」「后」', () => {
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe('3 天前')
    expect(relativeTime(now + 2 * 3_600_000, now)).toBe('2 小时后')
  })
})

describe('TIMESTAMP_UNITS', () => {
  it('提供自动 / 秒 / 毫秒 / 微秒 / 纳秒五个选项', () => {
    expect(TIMESTAMP_UNITS.map((item) => item.value)).toEqual([
      'auto',
      'seconds',
      'milliseconds',
      'microseconds',
      'nanoseconds',
    ])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project core src/core/converter/date.test.ts > /tmp/p2-t1.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t1.log`

Expected: FAIL，报 `Failed to resolve import "./date"`（文件尚不存在）。

- [ ] **Step 3: 写最小实现**

创建 `src/core/converter/date.ts`：

```ts
import { err, ok } from '../result'
import type { Result } from '../result'

/**
 * 时间戳单位。
 *
 * `auto` 仅表示「由位数自动判定」这一模式本身，不会出现在解析结果里 ——
 * 结果中的 `unit` 一律是四个具体单位之一，便于界面直接标注。
 */
export type TimestampUnit = 'auto' | 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds'

export type ResolvedUnit = Exclude<TimestampUnit, 'auto'>

export interface TimestampUnitOption {
  value: TimestampUnit
  label: string
}

/** 界面下拉的唯一事实源（顺序即展示顺序）。 */
export const TIMESTAMP_UNITS: readonly TimestampUnitOption[] = [
  { value: 'auto', label: '自动' },
  { value: 'seconds', label: '秒' },
  { value: 'milliseconds', label: '毫秒' },
  { value: 'microseconds', label: '微秒' },
  { value: 'nanoseconds', label: '纳秒' },
]

export interface DateParse {
  /** 毫秒时间戳 */
  epochMs: number
  kind: 'timestamp' | 'date'
  /** 仅 kind === 'timestamp' 时存在 */
  unit?: ResolvedUnit
  /** 判定依据（中文），界面原样展示 */
  basis: string
  /** 识别出的输入格式（中文），界面原样展示 */
  inputFormat: string
  /** 位数不典型的纯数字输入：可能有多种解释 */
  ambiguous: boolean
}

export interface DateField {
  id: string
  label: string
  value: string
}

const UNIT_LABEL: Record<ResolvedUnit, string> = {
  seconds: '秒',
  milliseconds: '毫秒',
  microseconds: '微秒',
  nanoseconds: '纳秒',
}

/** 1 个该单位等于多少毫秒。微秒 / 纳秒是小数，故单位换算后再取整 */
const MS_PER_UNIT: Record<ResolvedUnit, number> = {
  seconds: 1000,
  milliseconds: 1,
  microseconds: 1 / 1000,
  nanoseconds: 1 / 1_000_000,
}

const NUMERIC = /^[+-]?\d+$/

/**
 * 日期时间字面量。
 *
 * 用显式正则 + 手工构造 Date，而不是 `Date.parse`：V8 与 JavaScriptCore 对
 * 非标准格式的容忍度不同（`2024/03/15` 在两家实现里都可能被当成 UTC），
 * 而 spec 要求 ISO UTC 与本地时间都能稳定复现。这与 `core/json/scanner.ts`
 * 放弃 `JSON.parse` 报错是同一个理由。
 *
 * 分组：1=年 2=分隔符 3=月 4=日 5=时 6=分 7=秒 8=毫秒 9=Z 10=时区符号 11=时区小时 12=时区分钟
 */
const DATE_TIME =
  /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(?:([Zz])|([+-])(\d{2}):?(\d{2}))?$/

/**
 * 按位数推断时间戳单位。
 *
 * 常见长度：10 位（秒）、13 位（毫秒）、16 位（微秒）、19 位（纳秒）。
 * 8 位是唯一的典型歧义长度 —— 它既可能是很早的秒级时间戳，也可能是
 * 紧写的 `YYYYMMDD`，故单独标记出来让界面提示用户手动指定。
 */
function detectUnit(digits: number): { unit: ResolvedUnit; ambiguous: boolean } {
  if (digits <= 10) return { unit: 'seconds', ambiguous: digits === 8 }
  if (digits <= 13) return { unit: 'milliseconds', ambiguous: false }
  if (digits <= 16) return { unit: 'microseconds', ambiguous: false }
  return { unit: 'nanoseconds', ambiguous: false }
}

function finish(
  epochMs: number,
  partial: Omit<DateParse, 'epochMs'>,
): Result<DateParse> {
  if (!Number.isFinite(epochMs)) {
    return err('时间戳超出可表示范围', { code: 'OUT_OF_RANGE' })
  }
  const probe = new Date(epochMs)
  if (Number.isNaN(probe.getTime())) {
    return err('时间戳超出可表示范围', {
      code: 'OUT_OF_RANGE',
      detail: `无法转换为日期：${epochMs}`,
    })
  }
  return ok({ epochMs, ...partial })
}

function parseNumeric(text: string, requested: TimestampUnit): Result<DateParse> {
  const raw = Number(text)
  if (!Number.isFinite(raw)) {
    return err('时间戳超出可表示范围', { code: 'OUT_OF_RANGE' })
  }

  const digits = text.replace(/^[+-]/, '').length
  const detected = detectUnit(digits)
  const unit = requested === 'auto' ? detected.unit : requested
  const ambiguous = requested === 'auto' && detected.ambiguous

  // 秒 / 毫秒的换算在安全整数范围内是精确的；微秒 / 纳秒会落到小数毫秒，
  // 而 spec 的「秒 × 1000 == 毫秒」断言要求毫秒侧是整数，故此处取整。
  const exact = unit === 'seconds' || unit === 'milliseconds'
  const epochMs = exact ? raw * MS_PER_UNIT[unit] : Math.round(raw * MS_PER_UNIT[unit])

  return finish(epochMs, {
    kind: 'timestamp',
    unit,
    ambiguous,
    inputFormat: `Unix 时间戳（${UNIT_LABEL[unit]}）`,
    basis:
      requested === 'auto'
        ? `${digits} 位数字，按${UNIT_LABEL[unit]}级时间戳解释`
        : `按用户指定的${UNIT_LABEL[unit]}级时间戳解释`,
  })
}

function parseDateTimeString(text: string): Result<DateParse> {
  const match = DATE_TIME.exec(text)
  if (!match) {
    return err('无法识别的日期格式', {
      code: 'UNRECOGNIZED_DATE',
      detail: `"${text}" 不在支持的格式内`,
      suggestion: '支持 Unix 时间戳、ISO 8601、YYYY-MM-DD、YYYY/MM/DD HH:mm:ss',
    })
  }

  const year = Number(match[1])
  const separator = match[2]
  const month = Number(match[3])
  const day = Number(match[4])
  const hasTime = match[5] !== undefined
  const hour = hasTime ? Number(match[5]) : 0
  const minute = hasTime ? Number(match[6]) : 0
  const second = match[7] === undefined ? 0 : Number(match[7])
  const millisecond = match[8] === undefined ? 0 : Number(match[8].padEnd(3, '0'))

  const utcMarker = match[9]
  const offsetSign = match[10]
  let offsetMinutes = 0
  let hasZone = false
  if (utcMarker !== undefined) {
    hasZone = true
  } else if (offsetSign !== undefined) {
    hasZone = true
    const magnitude = Number(match[11]) * 60 + Number(match[12])
    offsetMinutes = offsetSign === '-' ? -magnitude : magnitude
  }

  const epochMs = hasZone
    ? Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offsetMinutes * 60_000
    : new Date(year, month - 1, day, hour, minute, second, millisecond).getTime()

  // 组件回读校验：`new Date(2024, 1, 31)` 会静默滚到 3 月 2 日，
  // 只有把字段读回来比对才能拒绝「不存在的日期」。
  const probe = new Date(epochMs)
  const sameDay = hasZone
    ? probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    : probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day
  if (!sameDay) {
    return err('日期不存在', {
      code: 'INVALID_DATE',
      detail: `${text} 的月日组合越界`,
    })
  }

  const datePart = separator === '/' ? 'YYYY/MM/DD' : 'YYYY-MM-DD'
  return finish(epochMs, {
    kind: 'date',
    ambiguous: false,
    inputFormat: hasZone ? 'ISO 8601' : `${datePart}${hasTime ? ' HH:mm:ss' : ''}`,
    basis: hasZone ? '含时区信息，按带时区的绝对时刻解释' : '不含时区，按本地时间解释',
  })
}

/**
 * 解析日期 / 时间戳输入。
 *
 * 纯数字走时间戳分支（可被 `unit` 覆盖判定），其余走日期字面量分支。
 * 两条分支的错误都以 `Result` 返回 —— 解析类操作的非法输入是常规路径。
 */
export function parseDateInput(text: string, unit: TimestampUnit = 'auto'): Result<DateParse> {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return err('请输入日期或时间戳', { code: 'EMPTY_INPUT' })
  }
  return NUMERIC.test(trimmed) ? parseNumeric(trimmed, unit) : parseDateTimeString(trimmed)
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/** 本地时间的 ISO 8601 形式（带 `±HH:mm` 偏移，而不是 Z） */
function isoLocal(epochMs: number): string {
  const date = new Date(epochMs)
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const magnitude = Math.abs(offsetMinutes)
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(magnitude / 60))}:${pad(magnitude % 60)}`
  )
}

const RFC_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const RFC_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/** RFC 2822 用数字时区（`+0000`），此处统一按 UTC 输出 */
function rfc2822(epochMs: number): string {
  const date = new Date(epochMs)
  return (
    `${RFC_DAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${RFC_MONTHS[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} +0000`
  )
}

/**
 * 相对时间。
 *
 * `now` 可注入，使单测不依赖真实时钟（否则「刚刚」与「3 天前」无法稳定断言）。
 */
export function relativeTime(epochMs: number, now: number = Date.now()): string {
  const diff = epochMs - now
  const abs = Math.abs(diff)
  if (abs < 1000) return '刚刚'

  const suffix = diff > 0 ? '后' : '前'
  const seconds = Math.round(abs / 1000)
  if (seconds < 60) return `${seconds} 秒${suffix}`

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟${suffix}`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时${suffix}`

  const days = Math.round(hours / 24)
  if (days < 30) return `${days} 天${suffix}`

  const months = Math.round(days / 30)
  if (months < 12) return `${months} 个月${suffix}`

  return `${Math.round(months / 12)} 年${suffix}`
}

/** 同一个时刻的七种表示，顺序即界面顺序。 */
export function toDateFields(epochMs: number, now: number = Date.now()): DateField[] {
  const date = new Date(epochMs)
  return [
    { id: 'unix-seconds', label: 'Unix 时间戳（秒）', value: String(Math.floor(epochMs / 1000)) },
    { id: 'unix-milliseconds', label: 'Unix 时间戳（毫秒）', value: String(epochMs) },
    { id: 'iso-utc', label: 'ISO 8601（UTC）', value: date.toISOString() },
    { id: 'iso-local', label: 'ISO 8601（本地）', value: isoLocal(epochMs) },
    { id: 'rfc-2822', label: 'RFC 2822', value: rfc2822(epochMs) },
    {
      id: 'localized',
      label: '本地化日期时间',
      value: date.toLocaleString('zh-CN', { hour12: false }),
    },
    { id: 'relative', label: '相对时间', value: relativeTime(epochMs, now) },
  ]
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project core src/core/converter/date.test.ts > /tmp/p2-t1.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t1.log`

Expected: PASS，21 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/core/converter/date.ts src/core/converter/date.test.ts
git commit -m "feat(converter): 日期解析与多表示输出（tasks 6.1 / 6.5 / 6.11）"
```

---

### Task 2: `core/converter/base64.ts` —— Base64 编解码

对应 `tasks.md` **6.2 / 6.5**；满足 delta spec 的 Requirement「Base64 编码与解码」的全部 8 个 Scenario（其中「编码文件」「解码为文件」的 UI 部分由 Task 7 承接，Core 部分在此）。

**Files:**
- Create: `src/core/converter/base64.ts`
- Test: `src/core/converter/base64.test.ts`

**Interfaces:**
- Consumes: `base64ToBytes` / `bytesToBase64` / `bytesToUtf8` / `utf8ToBytes` / `Result` from `../bytes` / `../result`
- Produces: `Base64Variant`、`Base64Options`、`encodeBytes`、`encodeText`、`decodeToBytes`、`decodeToText`。Task 7 的 Base64 工具消费全部六个导出

- [ ] **Step 1: 写失败测试**

创建 `src/core/converter/base64.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { decodeToBytes, decodeToText, encodeBytes, encodeText } from './base64'

function mustDecode(text: string): string {
  const result = decodeToText(text)
  if (!result.ok) throw new Error(`期望解码成功，实际失败：${result.error}`)
  return result.value
}

describe('encodeText / decodeToText', () => {
  it('标准变体编码 hello → aGVsbG8=', () => {
    expect(encodeText('hello')).toBe('aGVsbG8=')
  })

  it('标准变体解码 aGVsbG8= → hello', () => {
    expect(mustDecode('aGVsbG8=')).toBe('hello')
  })

  it('中文往返不产生乱码', () => {
    const text = '你好，世界 —— IT 工具箱'
    expect(mustDecode(encodeText(text))).toBe(text)
  })

  it('关闭填充后末尾无 = 且可被自身解码', () => {
    const encoded = encodeText('hello', { padding: false })
    expect(encoded).toBe('aGVsbG8')
    expect(encoded.endsWith('=')).toBe(false)
    expect(mustDecode(encoded)).toBe('hello')
  })
})

describe('URL-safe 变体', () => {
  it('标准变体会产出 + 与 /，URL-safe 变体改用 - 与 _', () => {
    const bytes = Uint8Array.of(0xff, 0xff, 0xff, 0xff)
    expect(encodeBytes(bytes)).toBe('////')
    const urlsafe = encodeBytes(bytes, { variant: 'urlsafe' })
    expect(urlsafe).toBe('____')
    expect(urlsafe).not.toContain('+')
    expect(urlsafe).not.toContain('/')
  })

  it('URL-safe 变体的输出可被解码还原', () => {
    const bytes = Uint8Array.of(0xfb, 0xef, 0xbe)
    const urlsafe = encodeBytes(bytes, { variant: 'urlsafe', padding: false })
    const decoded = decodeToBytes(urlsafe)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(Array.from(decoded.value)).toEqual([0xfb, 0xef, 0xbe])
  })
})

describe('错误分支', () => {
  it('包含非法字符时解码失败并定位到该字符', () => {
    const result = decodeToText('abc!@#')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_BASE64_CHAR')
      expect(result.offset).toBe(3)
      expect(result.detail).toContain('!')
    }
  })

  it('解码出的字节不是合法 UTF-8 文本时返回 BAD_UTF8', () => {
    // 0xff 单独出现不是合法的 UTF-8 起始字节
    const result = decodeToText('/w==')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('BAD_UTF8')
  })

  it('空输入解码为空字节序列', () => {
    const result = decodeToBytes('')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.length).toBe(0)
  })
})

describe('二进制安全', () => {
  it('任意字节往返保持逐字节一致', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index)
    const encoded = encodeBytes(bytes, { variant: 'urlsafe' })
    const decoded = decodeToBytes(encoded)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(Array.from(decoded.value)).toEqual(Array.from(bytes))
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project core src/core/converter/base64.test.ts > /tmp/p2-t2.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t2.log`

Expected: FAIL，报 `Failed to resolve import "./base64"`。

- [ ] **Step 3: 写最小实现**

创建 `src/core/converter/base64.ts`：

```ts
import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes } from '../bytes'
import type { Result } from '../result'

export type Base64Variant = 'standard' | 'urlsafe'

export interface Base64Options {
  /** 默认 'standard' */
  variant?: Base64Variant
  /** 是否输出 '=' 填充，默认 true */
  padding?: boolean
}

/**
 * 这层薄封装的意义在于「默认值收敛 + 语义命名」：
 *
 * - `core/bytes.ts` 是通用字节工具，`padding` / `variant` 无默认值，调用方每次都要写全；
 * - 本模块把「标准字母表 + 带填充」定为默认（与 `btoa` / `Base64` 的直觉一致），
 *   并提供 UTF-8 文本与字节两套入口，使工具层只关心「要文本还是字节」。
 *
 * 解码侧有意不接收 `variant`：`base64ToBytes` 的查表同时覆盖标准与 url-safe
 * 两套字母表，跨格式粘贴（日志、JWT、邮件）是常态。
 */
export function encodeBytes(bytes: Uint8Array, options: Base64Options = {}): string {
  return bytesToBase64(bytes, {
    variant: options.variant ?? 'standard',
    padding: options.padding ?? true,
  })
}

export function encodeText(text: string, options: Base64Options = {}): string {
  return encodeBytes(utf8ToBytes(text), options)
}

export function decodeToBytes(text: string): Result<Uint8Array> {
  return base64ToBytes(text)
}

/** 解码为 UTF-8 文本。非 UTF-8 字节序列（例如一张 PNG）会返回 BAD_UTF8。 */
export function decodeToText(text: string, options: Base64Options = {}): Result<string> {
  const bytes = base64ToBytes(text, options)
  if (!bytes.ok) return bytes
  return bytesToUtf8(bytes.value)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project core src/core/converter/base64.test.ts > /tmp/p2-t2.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t2.log`

Expected: PASS，11 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/core/converter/base64.ts src/core/converter/base64.test.ts
git commit -m "feat(converter): Base64 编解码 Core（tasks 6.2 / 6.5）"
```

---

### Task 3: `core/converter/yaml.ts` —— YAML ↔ JSON

对应 `tasks.md` **6.3 / 6.5**；满足 delta spec 的 Requirement「YAML 转 JSON」与「JSON 转 YAML」的全部 8 个 Scenario。

**Files:**
- Create: `src/core/converter/yaml.ts`
- Test: `src/core/converter/yaml.test.ts`

**Interfaces:**
- Consumes: `load` / `dump` / `YAMLException` from `js-yaml`（**具名导入**）；`scanJson` from `../json/scanner`；`ok` / `err` / `Result` from `../result`
- Produces: `YamlIndent`、`YamlToJsonOptions`、`yamlToJson(text, options?)`、`jsonToYaml(text)`。Task 8 / Task 9 两个工具各消费其中一个

- [ ] **Step 1: 写失败测试**

创建 `src/core/converter/yaml.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { jsonToYaml, yamlToJson } from './yaml'

function mustYamlToJson(text: string, indent?: 2 | 4): string {
  const result = yamlToJson(text, indent === undefined ? {} : { indent })
  if (!result.ok) throw new Error(`期望转换成功，实际失败：${result.error}`)
  return result.value
}

function mustJsonToYaml(text: string): string {
  const result = jsonToYaml(text)
  if (!result.ok) throw new Error(`期望转换成功，实际失败：${result.error}`)
  return result.value
}

describe('yamlToJson', () => {
  it('嵌套映射与数组转换为语义等价的 JSON', () => {
    const source = [
      'name: toolbox',
      'tags:',
      '  - crypto',
      '  - converter',
      'owner:',
      '  name: cankaili',
      '  admin: true',
      'nested:',
      '  list:',
      '    - 1',
      '    - 2',
      '',
    ].join('\n')
    const json = mustYamlToJson(source)
    const value: unknown = JSON.parse(json)
    expect(value).toEqual({
      name: 'toolbox',
      tags: ['crypto', 'converter'],
      owner: { name: 'cankaili', admin: true },
      nested: { list: [1, 2] },
    })
  })

  it('布尔值 / 数字 / null 保持原生类型而非字符串', () => {
    const json = mustYamlToJson('a: true\nb: 3\nc: null\nd: 1.5\n')
    const value = JSON.parse(json) as Record<string, unknown>
    expect(value['a']).toBe(true)
    expect(value['b']).toBe(3)
    expect(value['c']).toBeNull()
    expect(value['d']).toBe(1.5)
  })

  it('缩进配置生效：默认 2 空格，可选 4 空格', () => {
    const source = 'a:\n  b: 1\n'
    expect(mustYamlToJson(source)).toContain('\n  "b": 1')
    expect(mustYamlToJson(source, 4)).toContain('\n    "b": 1')
  })

  it('多行字符串被保留为含换行的 JSON 字符串', () => {
    const json = mustYamlToJson('text: |\n  line 1\n  line 2\n')
    const value = JSON.parse(json) as Record<string, unknown>
    expect(value['text']).toBe('line 1\nline 2\n')
  })

  it('缩进错误的 YAML 给出错误行号', () => {
    const result = yamlToJson('a: 1\n  b: 2\n')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_YAML')
      expect(result.line).toBe(2)
      expect(result.column).toBeGreaterThan(0)
      expect(result.offset).toBeTypeOf('number')
    }
  })

  it('空输入不报错且不输出内容', () => {
    const result = yamlToJson('   \n')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('')
  })
})

describe('jsonToYaml', () => {
  it('对象转换为合法 YAML，且能被 yamlToJson 还原为原 JSON', () => {
    const source = '{"name":"toolbox","tags":["crypto","converter"],"meta":{"ok":true,"n":null}}'
    const yaml = mustJsonToYaml(source)
    expect(yaml).not.toContain('{')
    const back = yamlToJson(yaml)
    expect(back.ok).toBe(true)
    if (back.ok) expect(JSON.parse(back.value)).toEqual(JSON.parse(source))
  })

  it('数组使用列表语法且顺序保持', () => {
    const yaml = mustJsonToYaml('["b","a","c"]')
    expect(yaml).toBe('- b\n- a\n- c\n')
    const back = yamlToJson(yaml)
    if (back.ok) expect(JSON.parse(back.value)).toEqual(['b', 'a', 'c'])
  })

  it('缺少闭合括号时报错并指出位置', () => {
    const result = jsonToYaml('{\n  "a": 1\n')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('UNCLOSED')
      expect(result.line).toBe(3)
      expect(result.offset).toBeTypeOf('number')
    }
  })

  it('空输入不报错且不输出内容', () => {
    const result = jsonToYaml('')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('')
  })

  it('重复对象不产出锚点 / 别名（保证往返语义不变）', () => {
    const shared = { a: 1 }
    const source = JSON.stringify({ x: shared, y: shared })
    const yaml = mustJsonToYaml(source)
    expect(yaml).not.toContain('&')
    expect(yaml).not.toContain('*')
    const back = yamlToJson(yaml)
    if (back.ok) expect(JSON.parse(back.value)).toEqual(JSON.parse(source))
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project core src/core/converter/yaml.test.ts > /tmp/p2-t3.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t3.log`

Expected: FAIL，报 `Failed to resolve import "./yaml"`。

- [ ] **Step 3: 写最小实现**

创建 `src/core/converter/yaml.ts`：

```ts
import { dump, load, YAMLException } from 'js-yaml'
import { scanJson } from '../json/scanner'
import { err, ok } from '../result'
import type { Result } from '../result'

export type YamlIndent = 2 | 4

export interface YamlToJsonOptions {
  /** 输出 JSON 的缩进宽度，默认 2 */
  indent?: YamlIndent
}

/**
 * YAML → JSON。
 *
 * 空输入在调用 `load` 之前拦截：js-yaml 5 对空文档会抛
 * `expected a document, but the input is empty`，而 spec 要求空输入
 * 「不报错、不输出内容」。
 *
 * 错误定位来自 `YAMLException.mark`。注意 `mark.line` 与 `mark.column`
 * **都是 0 基**，上报给 `ErrorInfo` 前必须各 +1（`ErrorNote` 按 1 基展示）。
 */
export function yamlToJson(text: string, options: YamlToJsonOptions = {}): Result<string> {
  const { indent = 2 } = options
  if (text.trim().length === 0) return ok('')

  try {
    const value: unknown = load(text)
    // 仅含注释的文档会解析出 undefined，JSON.stringify 会返回 undefined
    if (value === undefined) return ok('null')
    return ok(JSON.stringify(value, null, indent))
  } catch (cause) {
    if (cause instanceof YAMLException) {
      const mark = cause.mark
      return err('YAML 语法错误', {
        code: 'BAD_YAML',
        detail: mark ? `解析器报告：${cause.reason}` : cause.reason,
        line: mark ? mark.line + 1 : undefined,
        column: mark ? mark.column + 1 : undefined,
        offset: mark ? mark.position : undefined,
        suggestion: '请检查出错行的缩进与冒号后的空格',
      })
    }
    return err('YAML 语法错误', {
      code: 'BAD_YAML',
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

/**
 * JSON → YAML。
 *
 * 先用 `scanJson` 严格校验：它的报错带 `line` / `column` / `offset`，
 * 而 `JSON.parse` 的报错文案在 V8 与 JavaScriptCore 上不一致（WKWebView
 * 甚至不给位置），无法满足「指出出错位置」的 Scenario。
 *
 * `lineWidth: -1` 关闭折行、`noRefs: true` 关闭锚点/别名 —— 两者都是
 * 「YAML 再转回 JSON 必须语义等价」的前提。
 */
export function jsonToYaml(text: string): Result<string> {
  if (text.trim().length === 0) return ok('')

  const scanned = scanJson(text)
  if (!scanned.ok) {
    return err(scanned.error, {
      code: scanned.code,
      detail: scanned.detail,
      line: scanned.line,
      column: scanned.column,
      offset: scanned.offset,
      suggestion: scanned.suggestion,
    })
  }

  // 已由 scanJson 严格校验，故此处的 JSON.parse 不会抛错
  const value: unknown = JSON.parse(text)
  return ok(dump(value, { indent: 2, lineWidth: -1, noRefs: true }))
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project core src/core/converter/yaml.test.ts > /tmp/p2-t3.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t3.log`

Expected: PASS，11 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/core/converter/yaml.ts src/core/converter/yaml.test.ts
git commit -m "feat(converter): YAML ↔ JSON Core 与错误定位（tasks 6.3 / 6.5）"
```

---

### Task 4: `core/converter/markdown.ts` —— Markdown 转 HTML（含离线性约束）

对应 `tasks.md` **6.4 / 6.5 / 6.12**；满足 delta spec 的 Requirement「Markdown 转 HTML」的全部 10 个 Scenario。

**Files:**
- Create: `src/core/converter/markdown.ts`
- Test: `src/core/converter/markdown.test.ts`

**Interfaces:**
- Consumes: `MarkdownIt` default export from `markdown-it`
- Produces: `markdownToHtml(source: string): string`。Task 10 的 Markdown 工具消费该函数

- [ ] **Step 1: 写失败测试**

创建 `src/core/converter/markdown.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { markdownToHtml } from './markdown'

describe('基础语法', () => {
  it('标题与段落', () => {
    const html = markdownToHtml('# 标题\n\n一段正文')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<p>一段正文</p>')
  })

  it('表格与围栏代码块（语言标注为 class）', () => {
    const source = [
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
    ].join('\n')
    const html = markdownToHtml(source)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<pre><code class="language-js">')
    expect(html).toContain('const x = 1')
  })

  it('嵌套有序 / 无序列表保持层级', () => {
    const source = ['- 外层', '  1. 内层一', '  2. 内层二', '- 外层二', ''].join('\n')
    const html = markdownToHtml(source)
    expect(html).toContain('<ul>')
    expect(html).toContain('<ol>')
    // 内层列表必须在外层 <li> 之内
    expect(html).toMatch(/<li>外层\s*<ol>[\s\S]*<\/ol>\s*<\/li>/)
  })

  it('行内代码与引用', () => {
    const html = markdownToHtml('使用 `npm test` 运行测试\n\n> 引用一行\n')
    expect(html).toContain('<code>npm test</code>')
    expect(html).toContain('<blockquote>')
  })
})

describe('离线性与安全', () => {
  it('原始 HTML 标签被转义为实体', () => {
    const html = markdownToHtml('<div class="x">hi</div>')
    expect(html).toContain('&lt;div class=&quot;x&quot;&gt;hi&lt;/div&gt;')
    expect(html).not.toContain('<div')
  })

  it('script 标签不产生可执行内容', () => {
    const html = markdownToHtml('<script>alert(1)</script>')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  it('事件属性被转义为文本', () => {
    const html = markdownToHtml('<img src=x onerror="alert(1)">')
    expect(html).not.toContain('onerror="')
    expect(html).toContain('&lt;img')
  })

  it('远程图片渲染为占位块并保留原始地址，且不产出 <img>', () => {
    const html = markdownToHtml('![截图](https://example.com/a.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('远程图片未加载')
    expect(html).toContain('https://example.com/a.png')
    expect(html).toContain('截图')
  })

  it('协议相对地址（//host/path）同样按远程图片处理', () => {
    const html = markdownToHtml('![](//cdn.example.com/x.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('远程图片未加载')
  })

  it('外部链接不渲染为可导航的 <a href>，而是只读展示地址', () => {
    const html = markdownToHtml('[官网](https://example.com/docs)')
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href="https://example.com/docs"')
    expect(html).toContain('官网')
    expect(html).toContain('（https://example.com/docs）')
  })
})

describe('边界', () => {
  it('空输入输出空字符串', () => {
    expect(markdownToHtml('')).toBe('')
    expect(markdownToHtml('   \n')).toBe('')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project core src/core/converter/markdown.test.ts > /tmp/p2-t4.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t4.log`

Expected: FAIL，报 `Failed to resolve import "./markdown"`。

- [ ] **Step 3: 写最小实现**

创建 `src/core/converter/markdown.ts`：

```ts
import MarkdownIt from 'markdown-it'
import type { Env } from 'markdown-it'

/**
 * Markdown → HTML。
 *
 * 三个「零外发」硬约束全部在这里落地，而不是交给工具层：
 *
 * 1. `html: false` —— 原始 HTML 一律转义，`<script>` / `onerror` 只会变成文本；
 * 2. 图片规则被覆写 —— 任何图片（含远程地址）都渲染为占位块，不产出 `<img>`，
 *    预览因此不会发起任何图片加载请求；
 * 3. 链接规则被覆写 —— 不产出 `<a href>`，只在行尾以只读文本展示地址，
 *    应用窗口因此不可能被导航走。
 *
 * 之所以放在 Core 而不是工具层：这三条是 spec 的 Scenario，必须在 Node 环境
 * 里可直接断言，不依赖 WebView 的加载行为。
 */

const REMOTE_URL = /^(?:https?:)?\/\//i

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
})

md.renderer.rules['image'] = (tokens, idx) => {
  const token = tokens[idx]
  const src = token?.attrGet('src') ?? ''
  const alt = (token?.content ?? '').trim()
  const label = alt.length > 0 ? alt : src

  if (REMOTE_URL.test(src)) {
    return (
      `<span class="md-image-block" data-src="${escapeHtml(src)}">` +
      `[远程图片未加载] ${escapeHtml(label)}（${escapeHtml(src)}）</span>`
    )
  }
  return (
    `<span class="md-image-block" data-src="${escapeHtml(src)}">` +
    `[图片未加载] ${escapeHtml(label)}</span>`
  )
}

/**
 * 链接地址通过 `env` 在 open/close 之间传递。
 *
 * `env` 的类型是 `Env | undefined`，故所有读写都要判空；索引签名是
 * `unknown`，取出来必须 `as` 收窄。
 */
md.renderer.rules['link_open'] = (tokens, idx, _options, env) => {
  const href = tokens[idx]?.attrGet('href') ?? ''
  const stack = (env?.['mdLinkStack'] as string[] | undefined) ?? []
  stack.push(href)
  if (env) env['mdLinkStack'] = stack
  return `<span class="md-link" data-href="${escapeHtml(href)}">`
}

md.renderer.rules['link_close'] = (_tokens, _idx, _options, env) => {
  const stack = (env?.['mdLinkStack'] as string[] | undefined) ?? []
  const href = stack.pop() ?? ''
  return `</span><span class="md-link-url">（${escapeHtml(href)}）</span>`
}

export function markdownToHtml(source: string): string {
  if (source.trim().length === 0) return ''
  const env: Env = {}
  return md.render(source, env)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project core src/core/converter/markdown.test.ts > /tmp/p2-t4.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t4.log`

Expected: PASS，11 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/core/converter/markdown.ts src/core/converter/markdown.test.ts
git commit -m "feat(converter): Markdown → HTML Core（转义 / 图片占位 / 去导航，tasks 6.4 / 6.5 / 6.12）"
```

---

### Task 5: `framework/file.ts` 补 `downloadBytes` + `framework/ui/FileDrop.tsx`

对应 `tasks.md` **3.2**（输入区的「文件拖入」）与 **6.7** 的前置（Base64 的「编码文件 / 解码为文件」需要字节下载与拖入控件）。

**Files:**
- Modify: `src/framework/file.ts`（在文件末尾追加 `downloadBytes`）
- Create: `src/framework/ui/FileDrop.tsx`
- Test: `src/framework/ui/FileDrop.test.tsx`
- Modify: `src/framework/ui/index.ts`（导出 `FileDrop` 与 `FileDropProps`）

**Interfaces:**
- Consumes: 既有 `downloadBlob`；`Icon` from `./Icon`
- Produces: `downloadBytes(filename, bytes, mime?)`、`FileDrop` / `FileDropProps`。Task 7 消费这两者

- [ ] **Step 1: 写失败测试**

创建 `src/framework/ui/FileDrop.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FileDrop } from './FileDrop'

describe('FileDrop', () => {
  it('通过「选择文件」按钮触发的选择会把 File 交给 onFile', async () => {
    const onFile = vi.fn()
    render(<FileDrop onFile={onFile} label="拖入文件" />)

    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    await userEvent.upload(screen.getByLabelText('拖入文件'), file)

    expect(onFile).toHaveBeenCalledTimes(1)
    expect((onFile.mock.calls[0]?.[0] as File).name).toBe('hello.txt')
  })

  it('拖放文件同样会触发 onFile', async () => {
    const onFile = vi.fn()
    render(<FileDrop onFile={onFile} label="拖入文件" />)

    const file = new File(['world'], 'world.bin')
    const dropZone = screen.getByText('拖入文件').closest('div')
    expect(dropZone).not.toBeNull()

    const { fireEvent } = await import('@testing-library/react')
    fireEvent.drop(dropZone!, { dataTransfer: { files: [file] } })

    expect(onFile).toHaveBeenCalledTimes(1)
    expect((onFile.mock.calls[0]?.[0] as File).name).toBe('world.bin')
  })

  it('disabled 时不触发 onFile', async () => {
    const onFile = vi.fn()
    render(<FileDrop onFile={onFile} label="拖入文件" disabled />)

    const { fireEvent } = await import('@testing-library/react')
    const dropZone = screen.getByText('拖入文件').closest('div')
    fireEvent.drop(dropZone!, {
      dataTransfer: { files: [new File(['x'], 'x.bin')] },
    })

    expect(onFile).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: '选择文件' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project ui src/framework/ui/FileDrop.test.tsx > /tmp/p2-t5.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t5.log`

Expected: FAIL，报 `Failed to resolve import "./FileDrop"`。

- [ ] **Step 3: 写最小实现**

先在 `src/framework/file.ts` 末尾追加：

```ts
/**
 * 导出任意字节序列。
 *
 * 单独提供这一入口的原因：`downloadText` 会对内容做 UTF-8 编码，而
 * Base64 解码后的产物（图片、压缩包等）必须逐字节落盘，不能经过文本层。
 * `bytes.slice()` 复制一份再交给 Blob：切片结果的类型是
 * `Uint8Array<ArrayBuffer>`，能直接满足 `BlobPart` 的类型约束。
 */
export async function downloadBytes(
  filename: string,
  bytes: Uint8Array,
  mime = 'application/octet-stream',
): Promise<Result<void>> {
  return downloadBlob(filename, new Blob([bytes.slice()], { type: mime }))
}
```

再创建 `src/framework/ui/FileDrop.tsx`：

```tsx
import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Icon } from './Icon'

export interface FileDropProps {
  onFile: (file: File) => void
  label?: string
  hint?: string
  disabled?: boolean
}

/**
 * 文件拖入 / 选择。
 *
 * 拖放与点选是两条独立路径，都必须落到同一个 `onFile`：拖放在 WebView 之间
 * 的 `dataTransfer.files` 行为最不一致，因此保留「选择文件」这条纯 DOM 的
 * 兜底路径（也是 jsdom 里唯一可自动化的路径）。
 *
 * 文件内容不在这里读取：`File` 交给调用方后由它决定用 `arrayBuffer()` 还是
 * `text()`，避免框架层替工具决定编码方式。
 */
export function FileDrop({ onFile, label = '拖入文件', hint, disabled = false }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [active, setActive] = useState(false)

  const accept = (file: File | undefined) => {
    if (!disabled && file) onFile(file)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setActive(false)
    accept(event.dataTransfer.files[0])
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setActive(true)
      }}
      onDragLeave={() => setActive(false)}
      onDrop={onDrop}
      className={[
        'flex flex-col items-center gap-1 rounded-md border border-dashed px-3 py-2 text-center',
        active ? 'border-accent bg-accent/10' : 'border-border',
        disabled ? 'opacity-40' : '',
      ].join(' ')}
    >
      <Icon name="download" size={14} className="text-muted" />
      <p className="text-[12px] text-muted">{label}</p>
      {hint && <p className="text-[11px] text-muted/70">{hint}</p>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent disabled:opacity-40"
      >
        选择文件
      </button>
      {/* sr-only 而非 hidden：jsdom 与无障碍工具都要能定位到这个 input */}
      <input
        ref={inputRef}
        type="file"
        aria-label={label}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          accept(event.target.files?.[0])
          // 清空 value，使「同一个文件连选两次」也能触发 change
          event.target.value = ''
        }}
      />
    </div>
  )
}
```

最后在 `src/framework/ui/index.ts` 中插入导出行（保持现有导出字母序风格）：

```ts
export { FileDrop } from './FileDrop'
export type { FileDropProps } from './FileDrop'
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project ui src/framework/ui/FileDrop.test.tsx > /tmp/p2-t5.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t5.log`

Expected: PASS，3 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/framework/file.ts src/framework/ui/FileDrop.tsx src/framework/ui/FileDrop.test.tsx src/framework/ui/index.ts
git commit -m "feat(framework): 文件拖入控件与字节下载（tasks 3.2 / 6.7 前置）"
```

---

### Task 6: 日期转换器工具

对应 `tasks.md` **6.6 / 6.11**。

**Files:**
- Create: `src/tools/converter/date-converter/meta.ts`
- Create: `src/tools/converter/date-converter/Tool.tsx`
- Test: `src/tools/converter/date-converter/Tool.test.tsx`

**Interfaces:**
- Consumes: `parseDateInput` / `toDateFields` / `TIMESTAMP_UNITS` / `TimestampUnit` / `DateField` from `@/core/converter/date`（Task 1）；`ToolLayout` / `useToolState` / `ui/*`
- Produces: 注册表条目 `date-converter`（`category: 'converter'`）

- [ ] **Step 1: 写元数据**

创建 `src/tools/converter/date-converter/meta.ts`：

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'date-converter',
  name: '日期转换器',
  category: 'converter',
  description: '时间戳与多种日期表示互转，支持单位指定与歧义提示',
  keywords: ['date', 'time', 'timestamp', 'unix', 'iso8601', 'rfc2822', '时间戳', '日期', '时间', '转换'],
  order: 10,
} satisfies ToolMeta
```

- [ ] **Step 2: 写失败测试**

创建 `src/tools/converter/date-converter/Tool.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import DateConverterTool from './Tool'

const input = () => screen.getByRole('textbox', { name: '日期或时间戳' })

beforeEach(() => {
  localStorage.clear()
})

describe('日期转换器工具', () => {
  it('输入秒级时间戳后展示七项表示中的关键几项', async () => {
    render(<DateConverterTool />)
    await userEvent.type(input(), '1700000000')

    expect(screen.getByText('2023-11-14T22:13:20.000Z')).toBeDefined()
    expect(screen.getByText('1700000000')).toBeDefined()
    expect(screen.getByText('1700000000000')).toBeDefined()
    expect(screen.getByText('Unix 时间戳（秒）')).toBeDefined()
    expect(screen.getByText('RFC 2822')).toBeDefined()
  })

  it('无法识别的输入给出错误提示且不展示结果', async () => {
    render(<DateConverterTool />)
    await userEvent.type(input(), 'not-a-date')

    expect(screen.getByRole('alert').textContent).toContain('无法识别的日期格式')
    expect(screen.queryByText('ISO 8601（UTC）')).toBeNull()
  })

  it('歧义数字输入展示判定依据', async () => {
    render(<DateConverterTool />)
    await userEvent.type(input(), '20240315')

    expect(screen.getByText(/8 位数字，按秒级时间戳解释/)).toBeDefined()
    expect(screen.getByText(/该输入可能有多种解释/)).toBeDefined()
  })

  it('手动指定毫秒单位后按毫秒重新解释，且不再提示歧义', async () => {
    render(<DateConverterTool />)
    await userEvent.type(input(), '1700000000')
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: '时间戳单位' }),
      'milliseconds',
    )

    expect(screen.getByText('1970-01-20T16:13:20.000Z')).toBeDefined()
    expect(screen.getByText(/用户指定/)).toBeDefined()
    expect(screen.queryByText(/该输入可能有多种解释/)).toBeNull()
  })

  it('输入 ISO 8601 并标注识别到的格式', async () => {
    render(<DateConverterTool />)
    await userEvent.type(input(), '2024-03-15T08:30:00Z')

    expect(screen.getByText(/ISO 8601/)).toBeDefined()
    expect(screen.getByText('1710481800')).toBeDefined()
  })

  it('空输入时展示空态', () => {
    render(<DateConverterTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})
```

> `1710481800` 是 `Date.UTC(2024, 2, 15, 8, 30, 0) / 1000` 的取值；若实现后断言不符，以 `node -e "console.log(Date.UTC(2024,2,15,8,30,0)/1000)"` 的输出为准修正该字符串，**不得**改成 `expect.anything()` 这类空断言。

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run --project ui src/tools/converter/date-converter/Tool.test.tsx > /tmp/p2-t6.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t6.log`

Expected: FAIL，报 `Failed to resolve import "./Tool"`。

- [ ] **Step 4: 写最小实现**

创建 `src/tools/converter/date-converter/Tool.tsx`：

```tsx
import { useMemo } from 'react'
import { parseDateInput, TIMESTAMP_UNITS, toDateFields, type TimestampUnit } from '@/core/converter/date'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { Select } from '@/framework/ui/Inputs'

/** 必须定义在组件外部：初始值参与 useToolState 的惰性初始化，每次渲染新建会让依赖持续失效 */
const INITIAL_STATE = {
  input: '',
  options: { unit: 'auto' as TimestampUnit },
}

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

export default function DateConverterTool() {
  const { state, update, updateOptions } = useToolState('date-converter', INITIAL_STATE)
  const { input } = state
  const { unit } = state.options

  // 依赖全部是原始值（计划① R16：对象依赖会造成无限渲染循环）
  const parsed = useMemo(
    () => (input.trim().length === 0 ? null : parseDateInput(input, unit)),
    [input, unit],
  )

  const fields = useMemo(() => {
    if (parsed === null || !parsed.ok) return []
    return toDateFields(parsed.value.epochMs)
  }, [parsed])

  return (
    <ToolLayout
      options={
        <>
          <Field label="时间戳单位">
            <Select
              label="时间戳单位"
              options={TIMESTAMP_UNITS}
              value={unit}
              onChange={(next) => updateOptions({ unit: next })}
            />
          </Field>
          <button
            type="button"
            className={BUTTON}
            onClick={() => update({ input: '1700000000' })}
          >
            填入示例
          </button>
          <button type="button" className={BUTTON} onClick={() => update({ input: '' })}>
            清空
          </button>
        </>
      }
      input={
        <CodeArea
          label="日期或时间戳"
          value={input}
          rows={6}
          onChange={(value) => update({ input: value })}
          placeholder="例如 1700000000、2024-03-15T08:30:00Z、2024/03/15 08:30:00"
        />
      }
      output={
        parsed === null ? (
          <EmptyState title="尚未输入" hint="输入时间戳或日期即可查看七种表示" />
        ) : !parsed.ok ? (
          <ErrorNote info={parsed} />
        ) : (
          <ul className="m-0 list-none p-0">
            {fields.map((field) => (
              <li
                key={field.id}
                className="flex items-start gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0"
              >
                <span className="w-32 shrink-0 text-muted">{field.label}</span>
                <code className="code-text min-w-0 flex-1 break-all">{field.value}</code>
                <CopyButton text={field.value} label="复制" />
              </li>
            ))}
          </ul>
        )
      }
      status={
        parsed === null ? (
          <span>等待输入</span>
        ) : !parsed.ok ? (
          <span className="text-danger">{parsed.error}</span>
        ) : (
          <span>
            识别为 {parsed.value.inputFormat} · {parsed.value.basis}
            {parsed.value.ambiguous && (
              <span className="text-warn"> · 该输入可能有多种解释，可手动指定单位</span>
            )}
          </span>
        )
      }
    />
  )
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run --project ui src/tools/converter/date-converter/Tool.test.tsx > /tmp/p2-t6.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t6.log`

Expected: PASS，6 个用例全绿。

- [ ] **Step 6: 提交**

```bash
git add src/tools/converter/date-converter
git commit -m "feat(converter): 日期转换器工具（tasks 6.6 / 6.11）"
```

---

### Task 7: Base64 编码 / 解码工具

对应 `tasks.md` **6.7**。

**Files:**
- Create: `src/tools/converter/base64/meta.ts`
- Create: `src/tools/converter/base64/Tool.tsx`
- Test: `src/tools/converter/base64/Tool.test.tsx`

**Interfaces:**
- Consumes: `encodeText` / `encodeBytes` / `decodeToBytes` / `decodeToText` / `Base64Variant` from `@/core/converter/base64`（Task 2）；`bytesToUtf8` from `@/core/bytes`；`downloadBytes` from `@/framework/file` 与 `FileDrop` from `@/framework/ui`（Task 5）
- Produces: 注册表条目 `base64`（`category: 'converter'`）

- [ ] **Step 1: 写元数据**

创建 `src/tools/converter/base64/meta.ts`：

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'base64',
  name: 'Base64 编码/解码',
  category: 'converter',
  description: '标准与 URL-safe 变体的 Base64 编解码，支持文件与填充符开关',
  keywords: ['base64', 'b64', 'encode', 'decode', '编码', '解码', 'urlsafe', '文件编码'],
  order: 20,
} satisfies ToolMeta
```

- [ ] **Step 2: 写失败测试**

创建 `src/tools/converter/base64/Tool.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import Base64Tool from './Tool'

/** 只读 CodeArea 渲染的是行号列表，内容在每行最后一个 span */
const lines = () =>
  screen.getAllByRole('listitem').map((item) => item.lastElementChild?.textContent ?? '')

const textbox = (name: string) => screen.getByRole('textbox', { name })

beforeEach(() => {
  localStorage.clear()
})

describe('Base64 工具', () => {
  it('默认编码模式：输入 hello 输出 aGVsbG8=', async () => {
    render(<Base64Tool />)
    await userEvent.type(textbox('待编码的文本'), 'hello')

    expect(lines()).toEqual(['aGVsbG8='])
    expect(screen.getByRole('button', { name: '复制全部' })).toBeDefined()
    expect(screen.getByRole('button', { name: '下载' })).toBeDefined()
  })

  it('中文编码后可被本工具解码还原', async () => {
    render(<Base64Tool />)
    await userEvent.type(textbox('待编码的文本'), '你好')
    const encoded = lines()[0] ?? ''
    expect(encoded.length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    await userEvent.type(textbox('待解码的 Base64'), encoded)

    expect(lines()).toEqual(['你好'])
  })

  it('关闭填充符后输出不含 =，且仍可解码', async () => {
    render(<Base64Tool />)
    await userEvent.type(textbox('待编码的文本'), 'hello')
    await userEvent.click(screen.getByRole('checkbox', { name: '包含填充符' }))

    expect(lines()).toEqual(['aGVsbG8'])

    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    await userEvent.type(textbox('待解码的 Base64'), 'aGVsbG8')
    expect(lines()).toEqual(['hello'])
  })

  it('非法 Base64 给出错误提示', async () => {
    render(<Base64Tool />)
    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    await userEvent.type(textbox('待解码的 Base64'), 'abc!@#')

    expect(screen.getByRole('alert').textContent).toContain('非 Base64 字符')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('拖入文件时输出该文件字节的 Base64', async () => {
    render(<Base64Tool />)
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    await userEvent.upload(screen.getByLabelText('拖入文件以编码'), file)

    expect(await screen.findByText(/已选择 hello\.txt/)).toBeDefined()
    expect(lines()).toEqual(['aGVsbG8='])
  })

  it('解码结果不是 UTF-8 文本时提示改用文件下载', async () => {
    render(<Base64Tool />)
    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    await userEvent.type(textbox('待解码的 Base64'), '/w==')

    expect(screen.getByText(/不是合法的 UTF-8 文本/)).toBeDefined()
    expect(screen.getByRole('button', { name: '下载文件' })).toBeDefined()
  })

  it('空输入时展示空态', () => {
    render(<Base64Tool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})
```

> 「解码结果不是 UTF-8」这条用例依赖 `bytesToUtf8` 使用 `fatal: true`（`core/bytes.ts` 既有行为），`/w==` 解码出的 `0xff` 不是合法 UTF-8 起始字节。

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run --project ui src/tools/converter/base64/Tool.test.tsx > /tmp/p2-t7.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t7.log`

Expected: FAIL，报 `Failed to resolve import "./Tool"`。

- [ ] **Step 4: 写最小实现**

创建 `src/tools/converter/base64/Tool.tsx`：

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { bytesToUtf8 } from '@/core/bytes'
import {
  decodeToBytes,
  encodeBytes,
  encodeText,
  type Base64Variant,
} from '@/core/converter/base64'
import type { ErrorInfo } from '@/core/result'
import { downloadBytes } from '@/framework/file'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { FileDrop } from '@/framework/ui/FileDrop'
import { Icon } from '@/framework/ui/Icon'
import { Checkbox, SegmentedControl } from '@/framework/ui/Inputs'

type Mode = 'encode' | 'decode'

const INITIAL_STATE = {
  input: '',
  options: {
    mode: 'encode' as Mode,
    variant: 'standard' as Base64Variant,
    padding: true,
  },
}

const MODE_OPTIONS = [
  { value: 'encode' as Mode, label: '编码' },
  { value: 'decode' as Mode, label: '解码' },
]

const VARIANT_OPTIONS = [
  { value: 'standard' as Base64Variant, label: '标准' },
  { value: 'urlsafe' as Base64Variant, label: 'URL-safe' },
]

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

/**
 * 字节下载按钮。
 *
 * 不能复用 `DownloadButton`：它接收的是字符串并对内容做 UTF-8 编码，
 * 而 Base64 解码后的产物必须逐字节落盘（否则二进制内容会被损坏）。
 */
function DownloadBytesButton({ filename, bytes }: { filename: string; bytes: Uint8Array }) {
  const [status, setStatus] = useState<'idle' | 'done' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (
    <button
      type="button"
      onClick={() => {
        void downloadBytes(filename, bytes).then((result) => {
          // 用户主动取消保存不算失败
          if (!result.ok && result.code === 'CANCELLED') return
          setStatus(result.ok ? 'done' : 'failed')
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => setStatus('idle'), 1500)
        })
      }}
      className="inline-flex h-6 items-center gap-1 rounded-sm px-2 text-[12px] text-muted hover:bg-surface-2 hover:text-fg"
    >
      <Icon name={status === 'done' ? 'check' : 'download'} size={13} />
      {status === 'done' ? '已下载' : status === 'failed' ? '下载失败' : '下载文件'}
    </button>
  )
}

type Outcome =
  | { kind: 'encode'; text: string; fromFile: boolean }
  | { kind: 'decode'; bytes: Uint8Array; text: string | null }
  | { kind: 'error'; info: ErrorInfo }

export default function Base64Tool() {
  const { state, update, updateOptions } = useToolState('base64', INITIAL_STATE)
  const { input } = state
  const { mode, variant, padding } = state.options
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null)

  // 依赖全部是原始值或稳定引用（计划① R16：对象依赖会造成无限渲染循环）
  const outcome: Outcome | null = useMemo(() => {
    if (mode === 'encode') {
      if (file) {
        return {
          kind: 'encode',
          text: encodeBytes(file.bytes, { variant, padding }),
          fromFile: true,
        }
      }
      if (input.length === 0) return null
      return { kind: 'encode', text: encodeText(input, { variant, padding }), fromFile: false }
    }

    if (input.trim().length === 0) return null
    const bytes = decodeToBytes(input)
    if (!bytes.ok) return { kind: 'error', info: bytes }
    const text = bytesToUtf8(bytes.value)
    return { kind: 'decode', bytes: bytes.value, text: text.ok ? text.value : null }
  }, [input, mode, variant, padding, file])

  return (
    <ToolLayout
      options={
        <>
          <Field label="方向">
            <SegmentedControl
              label="转换方向"
              options={MODE_OPTIONS}
              value={mode}
              onChange={(next) => {
                updateOptions({ mode: next })
                setFile(null)
              }}
            />
          </Field>
          <Field label="变体">
            <SegmentedControl
              label="Base64 变体"
              options={VARIANT_OPTIONS}
              value={variant}
              onChange={(next) => updateOptions({ variant: next })}
            />
          </Field>
          <Checkbox
            label="包含填充符"
            checked={padding}
            onChange={(next) => updateOptions({ padding: next })}
          />
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              update({ input: '' })
              setFile(null)
            }}
          >
            清空
          </button>
        </>
      }
      input={
        <div className="flex flex-col gap-2 p-2.5">
          <CodeArea
            label={mode === 'encode' ? '待编码的文本' : '待解码的 Base64'}
            value={input}
            rows={8}
            onChange={(value) => {
              setFile(null)
              update({ input: value })
            }}
            placeholder={mode === 'encode' ? '输入任意文本' : '例如 aGVsbG8='}
          />
          {mode === 'encode' && (
            <FileDrop
              label="拖入文件以编码"
              hint="文件只在本地读取，不会离开本机"
              onFile={(dropped) => {
                void dropped.arrayBuffer().then((buffer) => {
                  setFile({ name: dropped.name, bytes: new Uint8Array(buffer) })
                  update({ input: '' })
                })
              }}
            />
          )}
          {file && (
            <p className="flex items-center gap-2 text-[12px] text-muted">
              已选择 {file.name}（{file.bytes.length} 字节）
              <button type="button" className={BUTTON} onClick={() => setFile(null)}>
                移除文件
              </button>
            </p>
          )}
        </div>
      }
      output={
        outcome === null ? (
          <EmptyState
            title="尚未输入"
            hint={mode === 'encode' ? '输入文本或拖入文件即可编码' : '粘贴 Base64 即可解码'}
          />
        ) : outcome.kind === 'error' ? (
          <ErrorNote info={outcome.info} />
        ) : outcome.kind === 'encode' ? (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={outcome.text} label="复制全部" />
              <DownloadButton filename="base64.txt" text={outcome.text} />
            </div>
            <CodeArea value={outcome.text} readOnly label="编码结果" />
          </>
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              {outcome.text !== null && <CopyButton text={outcome.text} label="复制文本" />}
              <DownloadBytesButton filename="decoded.bin" bytes={outcome.bytes} />
            </div>
            {outcome.text === null ? (
              <p className="p-2.5 text-[12px] text-muted">
                解码结果不是合法的 UTF-8 文本，请下载为文件查看。
              </p>
            ) : (
              <CodeArea value={outcome.text} readOnly label="解码结果" />
            )}
          </>
        )
      }
      status={
        outcome === null ? (
          <span>等待输入</span>
        ) : outcome.kind === 'error' ? (
          <span className="text-danger">{outcome.info.error}</span>
        ) : outcome.kind === 'encode' ? (
          <span>
            {outcome.fromFile ? '已对文件字节编码' : '已对文本编码'} · {outcome.text.length} 个字符
          </span>
        ) : (
          <span>已解码 {outcome.bytes.length} 字节</span>
        )
      }
    />
  )
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run --project ui src/tools/converter/base64/Tool.test.tsx > /tmp/p2-t7.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t7.log`

Expected: PASS，7 个用例全绿。

- [ ] **Step 6: 提交**

```bash
git add src/tools/converter/base64
git commit -m "feat(converter): Base64 编解码工具（tasks 6.7）"
```

---

### Task 8: YAML 转 JSON 工具

对应 `tasks.md` **6.8**。

**Files:**
- Create: `src/tools/converter/yaml-to-json/meta.ts`
- Create: `src/tools/converter/yaml-to-json/Tool.tsx`
- Test: `src/tools/converter/yaml-to-json/Tool.test.tsx`

**Interfaces:**
- Consumes: `yamlToJson` / `YamlIndent` from `@/core/converter/yaml`（Task 3）
- Produces: 注册表条目 `yaml-to-json`（`category: 'converter'`）

- [ ] **Step 1: 写元数据**

创建 `src/tools/converter/yaml-to-json/meta.ts`：

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'yaml-to-json',
  name: 'YAML 转 JSON',
  category: 'converter',
  description: '把 YAML 转换为 JSON，支持缩进配置并在语法错误时定位行号',
  keywords: ['yaml', 'yml', 'json', 'parse', '转换', '配置', '缩进'],
  order: 30,
} satisfies ToolMeta
```

- [ ] **Step 2: 写失败测试**

创建 `src/tools/converter/yaml-to-json/Tool.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import YamlToJsonTool from './Tool'

const lines = () =>
  screen.getAllByRole('listitem').map((item) => item.lastElementChild?.textContent ?? '')

const input = () => screen.getByRole('textbox', { name: 'YAML 源码' })

beforeEach(() => {
  localStorage.clear()
})

describe('YAML 转 JSON 工具', () => {
  it('嵌套结构转换为 JSON', async () => {
    render(<YamlToJsonTool />)
    await userEvent.type(input(), 'name: toolbox{{Enter}}tags:{{Enter}}  - a{{Enter}}  - b')

    expect(lines().join('\n')).toContain('"name": "toolbox"')
    expect(lines().join('\n')).toContain('"tags": [')
  })

  it('缩进切换为 4 空格后输出随之变化', async () => {
    render(<YamlToJsonTool />)
    await userEvent.type(input(), 'a:{{Enter}}  b: 1')
    expect(lines().join('\n')).toContain('\n  "b": 1'.trimStart())

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '输出缩进' }), '4')
    expect(lines().join('\n')).toContain('    "b": 1')
  })

  it('语法错误时给出行号', async () => {
    render(<YamlToJsonTool />)
    await userEvent.type(input(), 'a: 1{{Enter}}  b: 2')

    expect(screen.getByRole('alert').textContent).toContain('YAML 语法错误')
    expect(screen.getByText('第 2 行')).toBeDefined()
  })

  it('空输入时展示空态', () => {
    render(<YamlToJsonTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run --project ui src/tools/converter/yaml-to-json/Tool.test.tsx > /tmp/p2-t8.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t8.log`

Expected: FAIL，报 `Failed to resolve import "./Tool"`。

- [ ] **Step 4: 写最小实现**

创建 `src/tools/converter/yaml-to-json/Tool.tsx`：

```tsx
import { useMemo } from 'react'
import { yamlToJson, type YamlIndent } from '@/core/converter/yaml'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { Select } from '@/framework/ui/Inputs'

const INITIAL_STATE = {
  input: '',
  options: { indent: 2 as YamlIndent },
}

const INDENT_OPTIONS = [
  { value: '2' as const, label: '2 空格' },
  { value: '4' as const, label: '4 空格' },
]

const SAMPLE = ['name: toolbox', 'tags:', '  - crypto', '  - converter', 'meta:', '  ok: true', ''].join(
  '\n',
)

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

export default function YamlToJsonTool() {
  const { state, update, updateOptions } = useToolState('yaml-to-json', INITIAL_STATE)
  const { input } = state
  const { indent } = state.options

  const converted = useMemo(
    () => (input.trim().length === 0 ? null : yamlToJson(input, { indent })),
    [input, indent],
  )

  return (
    <ToolLayout
      options={
        <>
          <Field label="输出缩进">
            <Select
              label="输出缩进"
              options={INDENT_OPTIONS}
              value={String(indent) as '2' | '4'}
              onChange={(next) => updateOptions({ indent: Number(next) as YamlIndent })}
            />
          </Field>
          <button type="button" className={BUTTON} onClick={() => update({ input: SAMPLE })}>
            填入示例
          </button>
          <button type="button" className={BUTTON} onClick={() => update({ input: '' })}>
            清空
          </button>
        </>
      }
      input={
        <CodeArea
          label="YAML 源码"
          value={input}
          rows={12}
          onChange={(value) => update({ input: value })}
          placeholder={'name: toolbox\ntags:\n  - crypto'}
        />
      }
      output={
        converted === null ? (
          <EmptyState title="尚未输入" hint="粘贴 YAML 即可得到 JSON" />
        ) : !converted.ok ? (
          <ErrorNote info={converted} />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={converted.value} label="复制全部" />
              <DownloadButton filename="output.json" text={converted.value} />
            </div>
            <CodeArea value={converted.value} readOnly label="JSON 结果" />
          </>
        )
      }
      status={
        converted === null ? (
          <span>等待输入</span>
        ) : !converted.ok ? (
          <span className="text-danger">{converted.error}</span>
        ) : (
          <span>缩进 {indent} 空格 · 输出 {converted.value.length} 字符</span>
        )
      }
    />
  )
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run --project ui src/tools/converter/yaml-to-json/Tool.test.tsx > /tmp/p2-t8.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t8.log`

Expected: PASS，4 个用例全绿。

- [ ] **Step 6: 提交**

```bash
git add src/tools/converter/yaml-to-json
git commit -m "feat(converter): YAML 转 JSON 工具（tasks 6.8）"
```

---

### Task 9: JSON 转 YAML 工具

对应 `tasks.md` **6.9**。

**Files:**
- Create: `src/tools/converter/json-to-yaml/meta.ts`
- Create: `src/tools/converter/json-to-yaml/Tool.tsx`
- Test: `src/tools/converter/json-to-yaml/Tool.test.tsx`

**Interfaces:**
- Consumes: `jsonToYaml` from `@/core/converter/yaml`（Task 3）
- Produces: 注册表条目 `json-to-yaml`（`category: 'converter'`）

- [ ] **Step 1: 写元数据**

创建 `src/tools/converter/json-to-yaml/meta.ts`：

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'json-to-yaml',
  name: 'JSON 转 YAML',
  category: 'converter',
  description: '把 JSON 转换为 YAML，非法输入时指出行列位置',
  keywords: ['json', 'yaml', 'yml', 'stringify', '转换', '配置'],
  order: 40,
} satisfies ToolMeta
```

- [ ] **Step 2: 写失败测试**

创建 `src/tools/converter/json-to-yaml/Tool.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import JsonToYamlTool from './Tool'

const lines = () =>
  screen.getAllByRole('listitem').map((item) => item.lastElementChild?.textContent ?? '')

const input = () => screen.getByRole('textbox', { name: 'JSON 源码' })

beforeEach(() => {
  localStorage.clear()
})

describe('JSON 转 YAML 工具', () => {
  it('对象转换为列表 / 映射语法', async () => {
    render(<JsonToYamlTool />)
    await userEvent.type(input(), '{{"name":"toolbox","tags":["a","b"]}}')

    const yaml = lines().join('\n')
    expect(yaml).toContain('name: toolbox')
    expect(yaml).toContain('- a')
    expect(yaml).not.toContain('{')
  })

  it('缺少闭合括号时提示位置', async () => {
    render(<JsonToYamlTool />)
    await userEvent.type(input(), '{{{Enter}  "a": 1')

    expect(screen.getByRole('alert').textContent).toContain('输入在容器内意外结束')
    expect(screen.getByRole('alert').textContent).toMatch(/第 \d+ 行/)
  })

  it('空输入时展示空态', () => {
    render(<JsonToYamlTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run --project ui src/tools/converter/json-to-yaml/Tool.test.tsx > /tmp/p2-t9.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t9.log`

Expected: FAIL，报 `Failed to resolve import "./Tool"`。

- [ ] **Step 4: 写最小实现**

创建 `src/tools/converter/json-to-yaml/Tool.tsx`：

```tsx
import { useMemo } from 'react'
import { jsonToYaml } from '@/core/converter/yaml'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'

const INITIAL_STATE = {
  input: '',
  options: {},
}

const SAMPLE = '{"name":"toolbox","tags":["crypto","converter"],"meta":{"ok":true}}'

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

export default function JsonToYamlTool() {
  const { state, update } = useToolState('json-to-yaml', INITIAL_STATE)
  const { input } = state

  const converted = useMemo(
    () => (input.trim().length === 0 ? null : jsonToYaml(input)),
    [input],
  )

  return (
    <ToolLayout
      options={
        <>
          <button type="button" className={BUTTON} onClick={() => update({ input: SAMPLE })}>
            填入示例
          </button>
          <button type="button" className={BUTTON} onClick={() => update({ input: '' })}>
            清空
          </button>
        </>
      }
      input={
        <CodeArea
          label="JSON 源码"
          value={input}
          rows={12}
          onChange={(value) => update({ input: value })}
          placeholder={'{"name":"toolbox"}'}
        />
      }
      output={
        converted === null ? (
          <EmptyState title="尚未输入" hint="粘贴 JSON 即可得到 YAML" />
        ) : !converted.ok ? (
          <ErrorNote info={converted} />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={converted.value} label="复制全部" />
              <DownloadButton filename="output.yaml" text={converted.value} />
            </div>
            <CodeArea value={converted.value} readOnly label="YAML 结果" />
          </>
        )
      }
      status={
        converted === null ? (
          <span>等待输入</span>
        ) : !converted.ok ? (
          <span className="text-danger">{converted.error}</span>
        ) : (
          <span>输出 {converted.value.split('\n').length - 1} 行</span>
        )
      }
    />
  )
}
```

> `INITIAL_STATE.options` 为空对象是**有意**的：`useToolState` 的 `Partial<S>` 与 `updateOptions` 都为 `options` 预留了形状，本工具没有参数控件。这不影响持久化 —— `storage` 存的是 `{ input, options, updatedAt }`。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run --project ui src/tools/converter/json-to-yaml/Tool.test.tsx > /tmp/p2-t9.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t9.log`

Expected: PASS，3 个用例全绿。

- [ ] **Step 6: 提交**

```bash
git add src/tools/converter/json-to-yaml
git commit -m "feat(converter): JSON 转 YAML 工具（tasks 6.9）"
```

---

### Task 10: Markdown 转 HTML 工具（源码视图 + 安全预览）

对应 `tasks.md` **6.10 / 6.12**。

**Files:**
- Create: `src/tools/converter/markdown-to-html/meta.ts`
- Create: `src/tools/converter/markdown-to-html/Tool.tsx`
- Test: `src/tools/converter/markdown-to-html/Tool.test.tsx`
- Modify: `src/app/theme.css`（在文件末尾追加 `.md-preview` 样式）

**Interfaces:**
- Consumes: `markdownToHtml` from `@/core/converter/markdown`（Task 4）
- Produces: 注册表条目 `markdown-to-html`（`category: 'converter'`）

- [ ] **Step 1: 写元数据**

创建 `src/tools/converter/markdown-to-html/meta.ts`：

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'markdown-to-html',
  name: 'Markdown 转 HTML',
  category: 'converter',
  description: 'Markdown 转 HTML，提供安全预览与源码视图，图片与链接不触网',
  keywords: ['markdown', 'md', 'html', 'preview', '转换', '渲染', '预览'],
  order: 50,
} satisfies ToolMeta
```

- [ ] **Step 2: 写失败测试**

创建 `src/tools/converter/markdown-to-html/Tool.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import MarkdownToHtmlTool from './Tool'

const input = () => screen.getByRole('textbox', { name: 'Markdown 源码' })
const preview = () => screen.getByTestId('md-preview')

beforeEach(() => {
  localStorage.clear()
})

describe('Markdown 转 HTML 工具', () => {
  it('预览渲染标题与段落', async () => {
    render(<MarkdownToHtmlTool />)
    await userEvent.type(input(), '# 标题{{Enter}}{{Enter}}一段正文')

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toBe('标题')
    expect(preview().textContent).toContain('一段正文')
  })

  it('源码视图展示 HTML 源码并可直接复制', async () => {
    render(<MarkdownToHtmlTool />)
    await userEvent.type(input(), '# 标题')
    await userEvent.click(screen.getByRole('button', { name: '源码' }))

    expect(screen.getByText('<h1>标题</h1>')).toBeDefined()
    expect(screen.getByRole('button', { name: '复制 HTML 源码' })).toBeDefined()
  })

  it('远程图片渲染为占位块，不产出 img 元素', async () => {
    render(<MarkdownToHtmlTool />)
    await userEvent.type(input(), '![截图](https://example.com/a.png)')

    expect(preview().textContent).toContain('远程图片未加载')
    expect(preview().querySelector('img')).toBeNull()
  })

  it('外部链接不产出 a 元素，只读展示地址', async () => {
    render(<MarkdownToHtmlTool />)
    await userEvent.type(input(), '[官网](https://example.com/docs)')

    expect(preview().querySelector('a')).toBeNull()
    expect(preview().textContent).toContain('https://example.com/docs')
  })

  it('script 标签不进入 DOM', async () => {
    render(<MarkdownToHtmlTool />)
    await userEvent.type(input(), '<script>alert(1)</script>')

    expect(preview().querySelector('script')).toBeNull()
    expect(preview().textContent).toContain('alert(1)')
  })

  it('空输入时展示空态', () => {
    render(<MarkdownToHtmlTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run --project ui src/tools/converter/markdown-to-html/Tool.test.tsx > /tmp/p2-t10.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t10.log`

Expected: FAIL，报 `Failed to resolve import "./Tool"`。

- [ ] **Step 4: 写最小实现**

创建 `src/tools/converter/markdown-to-html/Tool.tsx`：

```tsx
import { useMemo } from 'react'
import { markdownToHtml } from '@/core/converter/markdown'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { Field } from '@/framework/ui/Field'
import { SegmentedControl } from '@/framework/ui/Inputs'

type View = 'preview' | 'source'

const INITIAL_STATE = {
  input: '',
  options: { view: 'preview' as View },
}

const VIEW_OPTIONS = [
  { value: 'preview' as View, label: '预览' },
  { value: 'source' as View, label: '源码' },
]

const SAMPLE = [
  '# 标题',
  '',
  '一段正文，包含 `行内代码`。',
  '',
  '| 列 A | 列 B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```js',
  'const x = 1',
  '```',
  '',
  '![远程图片](https://example.com/a.png)',
  '',
  '[外部链接](https://example.com/docs)',
  '',
].join('\n')

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

export default function MarkdownToHtmlTool() {
  const { state, update, updateOptions } = useToolState('markdown-to-html', INITIAL_STATE)
  const { input } = state
  const { view } = state.options

  const html = useMemo(() => markdownToHtml(input), [input])
  const isEmpty = input.trim().length === 0

  return (
    <ToolLayout
      options={
        <>
          <Field label="视图">
            <SegmentedControl
              label="预览视图"
              options={VIEW_OPTIONS}
              value={view}
              onChange={(next) => updateOptions({ view: next })}
            />
          </Field>
          <button type="button" className={BUTTON} onClick={() => update({ input: SAMPLE })}>
            填入示例
          </button>
          <button type="button" className={BUTTON} onClick={() => update({ input: '' })}>
            清空
          </button>
        </>
      }
      input={
        <CodeArea
          label="Markdown 源码"
          value={input}
          rows={14}
          onChange={(value) => update({ input: value })}
          placeholder={'# 标题\n\n一段正文'}
        />
      }
      output={
        isEmpty ? (
          <EmptyState title="尚未输入" hint="输入 Markdown 即可查看渲染结果" />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={html} label="复制 HTML 源码" />
              <DownloadButton filename="output.html" text={html} />
            </div>
            {view === 'source' ? (
              <CodeArea value={html} readOnly label="HTML 源码" />
            ) : (
              /*
                预览用 dangerouslySetInnerHTML：安全性不来自 React 的转义，
                而来自 core/converter/markdown.ts 的三个硬约束 —— html:false
                （原始标签全部转义）、图片规则覆写（不产出 <img>）、
                链接规则覆写（不产出 <a href>）。三者都有 Core 层用例锁定。
              */
              <div
                className="md-preview p-2.5"
                data-testid="md-preview"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
          </>
        )
      }
      status={<span>输出 {html.length} 字符</span>}
    />
  )
}
```

- [ ] **Step 5: 追加预览样式**

在 `src/app/theme.css` 末尾追加（Tailwind 的 preflight 会清零标题与表格样式，不补样式则预览与源码视图无差异）：

```css
/* Markdown 预览：preflight 清掉了 h1/table 的默认样式，此处按信息密度要求重建 */
.md-preview > :first-child {
  margin-top: 0;
}

.md-preview h1 {
  font-size: 1.5em;
  font-weight: 600;
  margin: 0.8em 0 0.4em;
}

.md-preview h2 {
  font-size: 1.3em;
  font-weight: 600;
  margin: 0.8em 0 0.4em;
}

.md-preview h3 {
  font-size: 1.1em;
  font-weight: 600;
  margin: 0.7em 0 0.3em;
}

.md-preview p {
  margin: 0.5em 0;
}

.md-preview ul,
.md-preview ol {
  margin: 0.5em 0;
  padding-left: 1.5em;
}

.md-preview ul {
  list-style: disc;
}

.md-preview ol {
  list-style: decimal;
}

.md-preview blockquote {
  margin: 0.5em 0;
  padding-left: 0.8em;
  border-left: 3px solid var(--app-border);
  color: var(--app-muted);
}

.md-preview code {
  font-family: var(--font-mono);
  font-size: 12.5px;
  background: var(--app-surface-2);
  border-radius: var(--radius-sm);
  padding: 0 0.25em;
}

.md-preview pre {
  margin: 0.5em 0;
  padding: 0.6em 0.8em;
  background: var(--app-surface-2);
  border-radius: var(--radius-md);
  overflow: auto;
}

.md-preview pre code {
  background: none;
  padding: 0;
}

.md-preview table {
  border-collapse: collapse;
  margin: 0.5em 0;
}

.md-preview th,
.md-preview td {
  border: 1px solid var(--app-border);
  padding: 0.25em 0.5em;
  text-align: left;
}

.md-preview th {
  background: var(--app-surface-2);
}

.md-preview .md-image-block {
  display: block;
  margin: 0.5em 0;
  padding: 0.4em 0.6em;
  border: 1px dashed var(--app-border);
  border-radius: var(--radius-md);
  color: var(--app-muted);
  font-size: 12px;
}

.md-preview .md-link {
  color: var(--app-accent);
}

.md-preview .md-link-url {
  color: var(--app-muted);
  font-size: 12px;
}
```

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run --project ui src/tools/converter/markdown-to-html/Tool.test.tsx > /tmp/p2-t10.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-t10.log`

Expected: PASS，6 个用例全绿。

- [ ] **Step 7: 提交**

```bash
git add src/tools/converter/markdown-to-html src/app/theme.css
git commit -m "feat(converter): Markdown 转 HTML 工具与安全预览（tasks 6.10 / 6.12）"
```

---

### Task 11: 覆盖核对与本计划验收

对应 `tasks.md` **6.1–6.12** 的收口。**本任务不做阶段守卫**（`comet guard build`）：第 5、7、8 组任务仍由计划②-3 / ②-4 承接，此处只保证「本计划范围内全部闭合、无回归」。

**Files:**
- Modify: `openspec/changes/it-toolbox-app/tasks.md`（6.1–6.12 由 `- [ ]` 改为 `- [x]`）

- [ ] **Step 1: 逐条核对 spec 覆盖**

对 `openspec/changes/it-toolbox-app/specs/converter-tools/spec.md` 的 5 个 Requirement 逐条数：

| Requirement | Scenario 数 | 对应用例位置 |
|---|---|---|
| 日期转换器 | 8 | `core/converter/date.test.ts` + `tools/converter/date-converter/Tool.test.tsx` |
| Base64 编码与解码 | 8 | `core/converter/base64.test.ts` + `tools/converter/base64/Tool.test.tsx` |
| YAML 转 JSON | 4 | `core/converter/yaml.test.ts` + `tools/converter/yaml-to-json/Tool.test.tsx` |
| JSON 转 YAML | 4 | `core/converter/yaml.test.ts` + `tools/converter/json-to-yaml/Tool.test.tsx` |
| Markdown 转 HTML | 10 | `core/converter/markdown.test.ts` + `tools/converter/markdown-to-html/Tool.test.tsx` |

Run: `grep -c '^#### Scenario' openspec/changes/it-toolbox-app/specs/converter-tools/spec.md`

Expected: `34`。若数字不同，说明 spec 已被修改，需按 comet-build 的「Spec 增量更新」重新分级处理。

- [ ] **Step 2: 全量测试**

Run: `npx vitest run > /tmp/p2-verify.log 2>&1; echo "exit=$?"; tail -30 /tmp/p2-verify.log`

Expected: exit=0，`core` 与 `ui` 两个 project 全绿；`registry.test.ts` 的「不存在任何注册问题」保持通过（5 个新工具被 glob 正确发现）。

- [ ] **Step 3: 类型检查与静态检查**

Run: `npm run typecheck > /tmp/p2-type.log 2>&1; echo "typecheck=$?"; npx eslint src > /tmp/p2-lint.log 2>&1; echo "lint=$?"`

Expected: 两者均为 0。**特别核对** `core/` 未因导入 `js-yaml` / `markdown-it` 触发 `no-restricted-imports`（这两个包不是 react / tauri / 上层目录，规则不覆盖）。

- [ ] **Step 4: 构建产物与外发扫描**

Run: `npm run build > /tmp/p2-build.log 2>&1; echo "exit=$?"; tail -20 /tmp/p2-build.log`

Expected: exit=0，`[scan-egress] 通过：产物中未发现外发能力。`。`markdown-it` 与 `js-yaml` 的产物里可能有远程 URL 字面量告警（非致命），**不得**因为它们放宽 `SKIP_PATH`。

- [ ] **Step 5: 勾选 tasks.md**

把 `openspec/changes/it-toolbox-app/tasks.md` 中 6.1–6.12 共 12 条改为 `- [x]`。

Run: `grep -n '^- \[ \] 6\.' openspec/changes/it-toolbox-app/tasks.md`

Expected: 无输出（全部已勾选）。

- [ ] **Step 6: 提交**

```bash
git add openspec/changes/it-toolbox-app/tasks.md
git commit -m "chore(converter): 勾选 tasks.md 第 6 组（6.1–6.12）"
```

---

## 收尾提示（给执行者）

1. **本计划的 11 个任务全部完成后**，`tasks.md` 的第 6 组应 100% 闭合；第 5 组（crypto 工具）与第 7–9 组仍未闭合，`comet guard build` 会失败 —— 这是预期行为，不要提前跑守卫、不要提前把 `phase` 改成 `verify`。
2. `npm test` 失败时，**先看 `registry.test.ts`**：新工具的 `meta.id` 与目录名不一致、`category` 拼错、`keywords` 为空都会在那里以具体目录名报出来。
3. 两个依赖的「反直觉」点最容易踩：`js-yaml` 的 `mark.line/column` 是 **0 基**（要 +1），`markdown-it` 的默认 `image` / `link_open` 规则**会产出真实的 `<img>` 与 `<a href>`**（必须覆写，否则破坏零外发约束）。
4. 若发现 spec 有遗漏场景，按 comet-build 的分级：小规模（补场景）直接改 delta spec 并在 commit message 说明；中规模（接口变更）先停下确认。

---

## 执行记录（2026-09-16，与上述草稿的差异）

本计划的 11 个任务已全部落地并通过验收，**代码是最终事实来源**；下列差异是对上面草稿片段的修正，重跑本计划时以仓库代码为准。

**验收实测**（`npx vitest run` / `npm run typecheck` / `npx eslint src` / `npm run build`）：

| 项 | 结果 |
|---|---|
| `src/core/converter` | 4 文件 / **60 用例全绿** |
| `src/tools/converter` + `FileDrop` + `registry` + `App` | 8 文件 / **56 用例全绿** |
| `npm run typecheck` | 通过 |
| `npx eslint src` | 通过 |
| `npm run build` | 通过，`[scan-egress] 通过：产物中未发现外发能力。` |
| spec Scenario | 实为 **33** 条（草稿里按 34 写的），5 个 Requirement 的每个 Scenario 均有对应用例 |

已实施但草稿未预见的三处修正：

1. **`date.ts` 的日期合法性校验改为直接校验书写出的年月日时分秒**（新增 `daysInMonth` / `isValidDateTime`），不再用「构造 `Date` 再回读字段」。
   *原因*：草稿的写法对带时区偏移的输入会误判 —— `2024-03-01T00:00:00+08:00` 换算成 UTC 后落到 `2024-02-29`，回读比对会把合法输入判为「不存在的日期」。已补 `date.test.ts` 用例「偏移把本地日期推到前一天的输入仍然合法」锁定。
2. **`yaml.ts` 增加「空文档」分支**：`YAMLException` 且 `mark === undefined` 且 `reason` 匹配 `/empty/i` 时返回 `ok('')`。
   *原因*：js-yaml 把「仅注释」的文档也视为空文档并抛错（该错误不带 mark），若不拦截则 `# 注释` 会被报成语法错误，与「空输入不报错」不一致。用例「仅含注释的文档按空输入处理」锁定。
3. **`markdown.ts` 的 `attrGet` 返回值需 `String(...)` 强转**：类型是 `string | number | null`（HTML 属性值可以是数字），`tsc --noEmit` 会报 8 处 `TS2345`。

草稿中需要按实际修正的**测试期望**（都已在仓库里改对，列出以免重跑时再踩）：

- Base64「标准变体产出 `+` 与 `/`」的字节要用 **3 个** `0xff`（4 个字节的标准结果是 `/////w==`），草稿写的 `Uint8Array.of(0xff,0xff,0xff,0xff)` 与断言 `////` 不自洽。
- Markdown「链接不导航」的断言不能写 `not.toContain('href="…"')`：占位用的 `data-href=` 本身包含子串 `href="`。改为断言 `not.toContain('<a')` 与 `not.toContain(' href=')`。
- `yamlToJson` 的缩进断言要用**扁平**输入（`'a: 1\nb: 2\n'`）：嵌套输入的内层键本来就是 4 空格，草稿的 `toContain('\n  "b": 1')` 对 `a:\n  b: 1\n` 不成立。
- 日期转换器工具测试断言 ISO 的秒级时间戳应为 **`1710491400`**（草稿写的 `1710481800` 是错的）。
- 日期转换器工具测试读秒级时间戳结果要加 `{ selector: 'code' }`：jsdom 里受控 `textarea` 的文本内容等于其 value，会与结果行的 `<code>` 撞名。
- 含 `{` / `[` 的输入**不要**用 `userEvent.type`（它把 `{` `[` 当特殊键语法，需写成 `{{` / `[[`），统一改用 `fireEvent.change`。

**未做（按系统约束有意跳过）**：各任务的 `git commit` 步骤未执行 —— 提交需用户明确指示。当前全部改动仍在工作区，可直接 `git status` 复核。

**并发注意**：执行期间仓库里有另一路会话在写 crypto 侧（`src/core/crypto/rsa.test.ts` 于 10:10 新增但 `rsa.ts` 尚不存在，且 `eslint.config.js` / `tsconfig.json` 被改动）。全量 `npx vitest run` 因此有 **1 个与本计划无关的失败**：`src/core/crypto/rsa.test.ts` 报 `Cannot find module './rsa'`。该文件不在本计划范围内，未做改动。

