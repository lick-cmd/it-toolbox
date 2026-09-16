# 图片与开发工具实现计划（OpenSpec change: it-toolbox-app）

> 计划②-4（前半：第 8 组）。承接计划②-1（foundation）、②-2（converter）、②-3（web）。
>
> - base-ref: `a1e0fa9`（`fix(crypto): 参数校验与 core 同口径…`）
> - branch: `it-toolbox-app`
> - spec: `openspec/changes/it-toolbox-app/specs/image-tools/spec.md`（**1 个 Requirement / 11 条 Scenario**）
> - spec: `openspec/changes/it-toolbox-app/specs/dev-tools/spec.md`（**2 个 Requirement / 18 条 Scenario**）
> - 覆盖 `tasks.md`：**8.1–8.7**（8.8 / 8.9 / 8.10 已在计划①完成）
> - 本计划**不含**第 9 组全量验收；它按 R88 的「图片与开发+验收」拆分，后续追加到本文件
> - 前置已就绪：`core/result.ts`、`core/bytes.ts`、`core/json/{scanner,parse,minify,format}.ts`、`framework/ToolLayout.tsx`、`framework/ui/*`、`framework/file.ts`、`framework/clipboard.ts`、`useToolState`

## Global Constraints

1. **零外发**：新增 Core 与工具不得出现网络 API 或远程 URL 字面量（`npm run build` 的 `scan-egress` 会拦）。
2. **Core 无 UI 依赖**：`core/` 不得 import React / Tauri / `framework/`（ESLint `no-restricted-imports` + `no-restricted-globals` 强制）；`core/image/*` **尤其不得碰 DOM**（设计文档 `:208`：Core 只产出矩阵与 SVG 字符串，Canvas 渲染留在 Tool）。
3. **跨 WebView 一致性**：所有 JSON 解析走 `core/json/scanner.ts`/`parse.ts`；`JSON.parse` 的报错文案在 V8 与 JavaScriptCore 上不一致。
4. **解析类操作用 `Result<T>`**：非法输入是常规路径，不抛异常。
5. **定位一律 1 基**：`ErrorInfo.line`/`column` 上报 UI 前必须 1 基；`offset` 保持 0 基。
6. **工具目录结构**：`src/tools/<category>/<id>/{meta.ts,Tool.tsx}`，目录名必须与 `meta.id` 一致，`keywords` 非空，否则 `registry.test.ts` 的「不存在任何注册问题」失败。
7. **既定工具 id 不可改**：二维码 = `qrcode-generator`（`category: 'image'`）、JSON 压缩 = `json-minify`、JSON 美化 = `json-format`（`category: 'dev'`）。`qrcode-generator` 与 `json-minify` 的 id 已被既有测试写死（foundation 计划的 registry mock、`CommandPalette.test.tsx:29`）。
8. **不新增框架原语、不改共享文件**：`src/framework/ui/index.ts`、`src/framework/ui/Inputs.tsx`、`src/framework/file.ts`、`src/test/setup.ts` 均被并行工作流（crypto）改动 ⇒ 本次**零改动**。按钮沿用仓内既有的 `BUTTON` 类字符串内联写法。
9. **`INITIAL_STATE` 定义在组件外部**；`useMemo` 依赖只用原始值（计划① R16：对象依赖会造成无限渲染循环）。
10. **测试输入用 `fireEvent.change`**：`userEvent.type` 把 `{` `[` 当特殊键语法，JSON 样本里必然出现。
11. **不写 `toHaveTextContent`/`toHaveValue`**：仓库未装 jest-dom，会抛 `Invalid Chai property`（计划① T13 与计划②-1 T7 两次踩到）。用 `textContent` + `toContain`、`.value` + `toBe`。
12. **不断言实现的 `Error.message` 文案**（qrcode 库的异常文案可能变）；断言我方 `Result.code` 与自家文案。

## 任务间接口约定（先定死，避免实现期返工）

| 消费者 | 依赖符号 | 来源 |
|---|---|---|
| `core/web/json-diff.ts` | `typeOf`、`JSON_TYPE_LABEL`、`jsonChildPath`、`jsonIndexPath`、`JsonValueType` | 新建 `core/json/type-hints.ts`（Task 1，**原地搬家 + 再导出**） |
| 工具 8.7（美化） | `collectTypeHints`、`TypeHint` | `core/json/type-hints.ts` |
| 工具 8.7（美化） | `formatJson`、`FormatJsonResult`、`JsonIndent` | 既有 `core/json/format.ts`（8.10 已交付） |
| 工具 8.6（压缩） | `minifyJson`、`JsonTextResult` | 既有 `core/json/minify.ts`（8.10 已交付） |
| 工具 8.3（二维码） | `generateQrMatrix`、`qrToSvg`、`resolveQrRenderOptions`、`qrPixelSize`、`maxByteCapacity`、`qrByteLength`、`contrastRatio`、`isLowContrast`、`QR_EC_LEVELS`、`QR_MAX_BYTE_CAPACITY`、`QrMatrix`、`QrRenderOptions`、`QrEcLevel`、`QR_DEFAULT_*` | `core/image/qrcode.ts`（Task 2） |
| 工具 8.3 | `downloadBytes`、`downloadText` | 既有 `framework/file.ts` |
| 工具 8.3 | `copyImage` | 既有 `framework/clipboard.ts` |
| 工具 8.3 | `Spinner`、`ColorInput`、`NumberInput`、`SegmentedControl`、`Checkbox`、`Pane`、`Icon`、`CodeArea`、`EmptyState`、`ErrorNote`、`Field`、`CopyButton` | 既有 `framework/ui/*` |
| 工具 8.6 / 8.7 | 同上（不含图片相关件） | 既有 |

---

## 已实测确认的外部事实（不是记忆，逐条跑出来的）

| 事实 | 证据 |
|---|---|
| `QRCode.create()` 返回 `{ modules:{size,data:Uint8Array,reservedBit}, version, errorCorrectionLevel:{bit}, maskPattern, segments }` | `node -e` 实测 |
| 矩阵方向是 `data[row * size + col]` | v1（size 21）左上定位图案外环 `y=0..6,x=0` 与 `x=0..6,y=0` 均为 `1111111`，中心 `(3,3)=1`、`(1,1)=0` |
| **byte 模式容量表与设计文档 `:209` 逐字一致**：L=2953 / M=2331 / Q=1663 / H=1273 | `'a'.repeat(2953)` 各等级均 `ok v40`，`+1` 抛 `The amount of data is too big…` |
| 中文/emoji 走 byte 模式且按 UTF-8 计长 | `'中文'` → `Byte:6`；`'🚀'` → `Byte:4`；`'中'.repeat(424)` H → `v40 / Byte:1272` |
| 强制 byte 分段写法可行：`create([{data, mode:'byte'}], …)` | 纯数字 `'1234567890'` 自动模式为 `Numeric:10`，强制后为 `Byte:10`（同为 v1） |
| `@types/qrcode` 的 `QRCodeErrorCorrectionLevel` **同时接受** `'L'\|'M'\|'Q'\|'H'` | `node_modules/@types/qrcode/index.d.ts:5` |
| `qrcode` 浏览器入口（`lib/browser.js`）只依赖 `can-promise` / `core/qrcode` / `renderer/{canvas,svg-tag}`，**不含** `fs`/`pngjs`/`yargs`（`browser` 字段把 `./lib/index.js` 映射到 `./lib/browser.js`，并把 `fs` 置 false） | require 图逐个 grep |
| `qrcode/lib` 内**无任何网络 API**；远程 URL 仅出现在注释与 SVG 命名空间字面量 | `grep -rlE "(fetch\|XMLHttpRequest\|WebSocket)\s*\("` 无命中 |
| jsdom 30.0.1：`canvas.getContext('2d')` **返回 null**（并打印 `Not implemented`）；`toBlob`/`toDataURL` 存在但 `toDataURL()` 返回 `null` | `node -e` 起真 jsdom 实测 |
| `Spinner` 带 `role="status"`；`DownloadButton` **只接受字符串**（无字节入口） | 读组件源码 |

**这些事实决定了三处设计**：

1. **预览用内联 SVG，不用 canvas** —— jsdom 拿不到 2D 上下文，canvas 预览在测试里不可断言；SVG 是普通 DOM，`querySelector('svg')` 可断言，且在 WebView 里缩放更清晰。Canvas 只在**导出 PNG / 复制图片**时按需创建（设计文档允许「Canvas 渲染留在 Tool」）。
2. **SVG 由 Core 自己拼字符串，不用 `QRCode.toString`** —— 后者的 `toString(text, opts)` **返回 Promise**（实测 `svg.slice is not a function`），会让 Core 变异步；自拼还能让 `moduleSize` 只影响宽度、不影响编码内容（spec 明确要求）。
3. **强制 byte 模式** —— 容量上限才能与硬编码表**精确对齐**（数字/大写字母在自动模式下会走 numeric/alphanumeric 模式，容量可达 7089，届时「当前等级最大可容纳长度」这句提示就是错的）。代价：约 3000 位纯数字的输入会被拒。**这是有意的取舍，已记录**（见文末「已知偏离」）。

---

### Task 1: `core/json/type-hints.ts` —— 类型标签共享化 + 逐值类型提示

**为什么必须现在做**：`dev-tools/spec.md:54` 的 Requirement 明文要求「并 SHALL **展示每个值的数据类型提示**」。并行工作流的账本已把这条登记为**无承担者的覆盖风险**（`progress.md:240`）：

> 该要求应由 UI 层从解析后的值对象渲染类型标签来满足，T8 不承担。**风险**：若 T13/T15/T16 的任务书同样都不含它，则该 Requirement 到归档时**无人实现**。

T15/T16 就是本计划的 Task 5/Task 6（压缩 / 美化）。**本任务补上这个承担者**。

同时消除重复：`typeOf` / `JSON_TYPE_LABEL` / 路径拼接目前长在 `core/web/json-diff.ts` 里，而「JSON 值的类型标签」是 `core/json/` 的职责（json-diff 只是它的消费者之一）。

**Files:**
- Create: `src/core/json/type-hints.ts`
- Test: `src/core/json/type-hints.test.ts`
- Modify: `src/core/web/json-diff.ts`（改为从新模块 import 并**再导出**，对外接口逐一不变）
- 不动 `src/tools/web/json-diff/*`（其 import 的是 `JSON_TYPE_LABEL`，经再导出仍然可用）

**Interfaces:**
- Produces（`core/json/type-hints.ts`）：
  - `type JsonValueType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null' | 'absent'`
  - `JSON_TYPE_LABEL: Record<JsonValueType, string>`（对象/数组/字符串/数字/布尔/空值/缺失）
  - `typeOf(value: unknown): JsonValueType`
  - `jsonChildPath(base: string, key: string): string`（合法标识符用 `.key`，否则 `["key"]`）
  - `jsonIndexPath(base: string, index: number): string`
  - `interface TypeHint { path: string; type: JsonValueType; label: string; summary: string }`
  - `const TYPE_HINT_MAX_DEPTH = 256`
  - `collectTypeHints(value: unknown): TypeHint[]`
- Consumes: 无（纯函数，零依赖，**不 import qrcode，也不 import 任何上层**）

**实现要点（必须照此，否则用例不过）：**

```ts
/**
 * 前序遍历整棵值树，每个节点产出一条提示。
 *
 * `summary` 只给「有信息量」的三种容器与字符串：对象给键数、数组给长度、
 * 字符串给码点数（用 [...s].length 而非 s.length —— 后者对 emoji 会多算）。
 * 标量不给概要（值本身就是最好的说明，重复一遍是噪声）。
 */
export function collectTypeHints(value: unknown): TypeHint[] {
  const out: TypeHint[] = []
  walk(value, '$', out, 0)
  return out
}
```

- 深度超过 `TYPE_HINT_MAX_DEPTH` 时**停止下钻并保留该节点**（与 `json-diff.diffValues` 的 256 同一口径；`scanJson`/`sortDeep` 的无界递归是账本已登记的 MINOR，此处不再新开口子）。
- 数组的键路径用 `jsonIndexPath`，对象用 `jsonChildPath` —— 与 json-diff 的输出逐字一致，两个工具的路径写法才不会打架。

**Step 1: 写失败测试** —— `src/core/json/type-hints.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { collectTypeHints, JSON_TYPE_LABEL, jsonChildPath, typeOf } from './type-hints'

describe('typeOf', () => {
  it('覆盖七种取值', () => {
    expect(typeOf({})).toBe('object')
    expect(typeOf([])).toBe('array')
    expect(typeOf('s')).toBe('string')
    expect(typeOf(1)).toBe('number')
    expect(typeOf(true)).toBe('boolean')
    expect(typeOf(null)).toBe('null')
    expect(typeOf(undefined)).toBe('absent')
  })

  it('null 不落进 object 分支', () => {
    // 这是最容易写错的一处：typeof null === 'object'
    expect(typeOf(null)).not.toBe('object')
  })

  it('每种类型都有中文标签', () => {
    expect(JSON_TYPE_LABEL.string).toBe('字符串')
    expect(JSON_TYPE_LABEL.absent).toBe('缺失')
  })
})

describe('jsonChildPath', () => {
  it('合法标识符用点号', () => {
    expect(jsonChildPath('$', 'abc')).toBe('$.abc')
    expect(jsonChildPath('$', '_x1')).toBe('$._x1')
  })

  it('含点、空格、中文、引号的键改用方括号', () => {
    expect(jsonChildPath('$', 'a.b')).toBe('$["a.b"]')
    expect(jsonChildPath('$', 'a b')).toBe('$["a b"]')
    expect(jsonChildPath('$', '中文')).toBe('$["中文"]')
    expect(jsonChildPath('$', 'a"b')).toBe('$["a\\"b"]')
  })
})

describe('collectTypeHints', () => {
  it('前序输出：根在最前，子节点跟随父节点', () => {
    expect(collectTypeHints({ a: 1, b: { c: 'x' } }).map((h) => h.path)).toEqual([
      '$',
      '$.a',
      '$.b',
      '$.b.c',
    ])
  })

  it('容器与字符串给出概要，标量不给', () => {
    const hints = collectTypeHints({ o: { a: 1 }, arr: [1, 2, 3], s: '中文', n: 1, t: true })
    const by = (path: string) => hints.find((h) => h.path === path)
    expect(by('$.o')?.summary).toBe('1 个键')
    expect(by('$.arr')?.summary).toBe('长度 3')
    expect(by('$.s')?.summary).toBe('长度 2')
    expect(by('$.n')?.summary).toBe('')
    expect(by('$.t')?.summary).toBe('')
  })

  it('字符串长度按码点计，emoji 不算两个', () => {
    // '🚀'.length === 2，码点数才是 1
    expect(collectTypeHints('🚀')[0]?.summary).toBe('长度 1')
  })

  it('数组元素用索引路径，嵌套不丢层级', () => {
    expect(collectTypeHints({ list: [{ x: null }] }).map((h) => h.path)).toEqual([
      '$',
      '$.list',
      '$.list[0]',
      '$.list[0].x',
    ])
  })

  it('null 与缺失的区分：顶层 null 是 null 而非 absent', () => {
    expect(collectTypeHints(null)[0]?.type).toBe('null')
    expect(collectTypeHints(undefined)[0]?.type).toBe('absent')
  })

  it('每个条目的 label 与其类型一致', () => {
    for (const hint of collectTypeHints({ a: [1, 'x', null, true] })) {
      expect(hint.label).toBe(JSON_TYPE_LABEL[hint.type])
    }
  })

  it('超过深度上限时停止下钻但仍保留该节点', () => {
    // 迭代构造 300 层嵌套对象
    let deep: unknown = 1
    for (let i = 0; i < 300; i++) deep = { n: deep }
    const hints = collectTypeHints(deep)
    expect(hints.length).toBeGreaterThan(0)
    expect(hints.length).toBeLessThanOrEqual(258) // 根 + 256 层 + 截断节点
  })

  it('空容器只产出自身一条', () => {
    expect(collectTypeHints({})).toHaveLength(1)
    expect(collectTypeHints([])).toHaveLength(1)
  })
})
```

**Step 2: 跑测试确认失败**（`Cannot find module './type-hints'`）。

**Step 3: 实现**，并把 `core/web/json-diff.ts` 改为：

```ts
import {
  jsonChildPath,
  jsonIndexPath,
  JSON_TYPE_LABEL,
  typeOf,
  type JsonValueType,
} from '../json/type-hints'

// 对外接口逐一保持不变：7.7 的工具与用例都从这里取标签与类型
export { JSON_TYPE_LABEL, typeOf }
export type { JsonValueType }
```

删除 json-diff 内的 `JsonValueType` / `typeOf` / `JSON_TYPE_LABEL` / `childPath` / `indexPath` 五处定义，改为调用 `jsonChildPath` / `jsonIndexPath`。

**Step 4: 回归验证** —— `npx vitest run --project core src/core/json src/core/web`，**计划②-3 的 98 条 web 用例必须全绿**（这是「搬家不破接口」的证据）。

**Step 5: 提交**（用户明确指示后）

---

### Task 2: `core/image/qrcode.ts`（8.1）

**Files:**
- Create: `src/core/image/qrcode.ts`
- Test: `src/core/image/qrcode.test.ts`（Task 3）
- 依赖：`qrcode@1.5.4`（已在 `dependencies`）+ `@types/qrcode`（已在 `devDependencies`）

**Interfaces:**

```ts
export type QrEcLevel = 'L' | 'M' | 'Q' | 'H'

export const QR_EC_LEVELS: readonly { value: QrEcLevel; label: string; hint: string }[]
export const QR_MAX_BYTE_CAPACITY: Record<QrEcLevel, number>  // L 2953 / M 2331 / Q 1663 / H 1273
export const QR_MAX_VERSION = 40
export const QR_MODULE_SIZE: { min: number; max: number; default: number }   // 1 / 16 / 4
export const QR_MARGIN: { min: number; max: number; default: number }         // 0 / 16 / 4（单位：模组）
export const QR_DEFAULT_FOREGROUND = '#000000'
export const QR_DEFAULT_BACKGROUND = '#ffffff'
export const QR_CONTRAST_THRESHOLD = 3

export interface QrOptions {
  ecLevel?: QrEcLevel
  moduleSize?: number
  margin?: number
  foreground?: string
  background?: string
}

export interface QrMatrix {
  size: number          // 4 * version + 17
  version: number
  ecLevel: QrEcLevel
  maskPattern: number
  modules: boolean[][]  // modules[row][col]，true = 暗模组
}

export interface QrRenderOptions {
  moduleSize: number
  margin: number
  foreground: string
  background: string
}

export function generateQrMatrix(text: string, options?: QrOptions): Result<QrMatrix>
export function resolveQrRenderOptions(options?: QrOptions): QrRenderOptions
export function qrPixelSize(matrix: QrMatrix, render: QrRenderOptions): number
export function qrToSvg(matrix: QrMatrix, render: QrRenderOptions): string
export function qrByteLength(text: string): number
export function maxByteCapacity(ecLevel: QrEcLevel): number
export function darkModuleCount(matrix: QrMatrix): number
export function normalizeHexColor(input: string): string | null
export function relativeLuminance(color: string): number
export function contrastRatio(a: string, b: string): number
export function isLowContrast(a: string, b: string, threshold?: number): boolean
```

**实现要点：**

1. **强制 byte 模式 + 预检容量**：
   ```ts
   const bytes = qrByteLength(text)
   const capacity = maxByteCapacity(ecLevel)
   if (bytes > capacity) {
     return err('内容超出该纠错等级的容量上限', {
       code: 'TOO_LONG',
       detail: `当前内容 ${bytes} 字节，纠错等级 ${ecLevel} 最多可容纳 ${capacity} 字节`,
       suggestion: `请缩短内容，或把纠错等级改为 ${suggestLower(ecLevel)}`,
     })
   }
   ```
   预检保证「给出当前等级最大可容纳长度」这句永远准确；`QRCode.create` 仍包 try/catch 作安全网（`code: 'QR_FAILED'`），该分支在预检存在时不可达 —— **与计划②-3 的 `TOO_DEEP` 同类，属有意例外，需在报告里写明**。
2. **`err`/`ok` 从 `../result` 引入**，`utf8ByteLength` 从 `../bytes` 引入（不自己写 UTF-8 计数）。
3. **颜色归一化**：`<input type="color">` 只会给 `#rrggbb`，但 Core 不能信任调用方 —— `normalizeHexColor` 接受 `#rgb` 与 `#rrggbb`（大小写皆可），输出小写 `#rrggbb`，其余返回 `null`，`resolveQrRenderOptions` 遇到 `null` 时回落到默认色。**这是 SVG 注入面的唯一关口**：进入 `qrToSvg` 的颜色字符串必定匹配 `^#[0-9a-f]{6}$`。
4. **`resolveQrRenderOptions` 负责 clamp**：`moduleSize` 落到 `[1,16]` 并向下取整，`margin` 落到 `[0,16]` 并向下取整，非有限数回落默认值。
5. **`qrToSvg` 输出契约**（用例逐字钉住）：
   ```html
   <svg xmlns="http://www.w3.org/2000/svg" width="{px}" height="{px}"
        viewBox="0 0 {units} {units}" shape-rendering="crispEdges" role="img" aria-label="二维码">
     <rect width="{units}" height="{units}" fill="{background}"/>
     <path d="{d}" fill="{foreground}"/>
   </svg>
   ```
   `units = size + 2*margin`，`px = units * moduleSize`。`d` 按**行内游程合并**生成（`M{x} {y}h{run}v1h-{run}z`），否则 v40 会产生约 1.5 万条命令、300KB 的字符串。`viewBox` 用模组单位 ⇒ 矢量无损缩放，`width/height` 用像素 ⇒ 导出尺寸与模块尺寸匹配。
6. **`moduleSize` 绝不参与编码**：不传给 `QRCode.create`，因此「调整模块尺寸改变输出分辨率而不改变编码内容」由结构保证。

**Step 1–3**：先写 Task 3 的测试到失败，再实现到全绿。

---

### Task 3: `core/image/qrcode.test.ts`（8.2）

**Files:**
- Create: `src/core/image/qrcode.test.ts`

**为什么这里要自带一个解码器**：spec 的两条 Scenario（`image-tools:42-45` 中文内容、`:22-25` 自定义颜色后仍可识别）说的都是**「可被标准扫码器扫描还原」**。本机实测**无任何二维码解码器**（`zbarimg` / `qrencode` / `pyzbar` / `cv2` / python `qrcode` 全部不存在），因此「解码」这条证据链不能靠外部工具。改为在测试内写一个**只支持 version 1 的独立解码器**：

- **v1 的定位图案表可以完整手写**（21×21，无对齐图案、无版本信息），`保留(row,col)` = `row<=8&&col<=8` ∪ `row<=8&&col>=13` ∪ `row>=13&&col<=8` ∪ `row===6||col===6`；
- **v1 的四个纠错等级都是单 RS 块**（L=19 / M=16 / Q=13 / H=9 个数据码字），因此**不需要块结构表**：zigzag 取出的前若干码字就是数据流本身；
- 因而可以真的走完「取模组 → 用 `matrix.maskPattern` 反掩码 → 按锯齿序读比特 → 解析 4 位模式指示符 + 8 位长度 + UTF-8 字节」，把文本**解回来**。

这是「实现方不参与判定」的独立证据（同计划②-1 的 DER 读写互校、ssh-key 与 `ssh-keygen` 对照），代价是一次性的约 90 行测试代码。**明确边界**：只对 `version === 1` 成立 —— 多块符号需要块结构表，本计划不做，用例中以 `expect(matrix.version).toBe(1)` 把这个前提钉在明面上。

**测试清单**（分组列出，逐条都对得上 spec）：

1. **默认参数与结构**：`ecLevel` 默认 `M`；`size === 4 * version + 17`；`modules` 为 `size × size`；`resolveQrRenderOptions()` 默认 `moduleSize 4 / margin 4 / #000000 / #ffffff`。
2. **方向与三个定位图案**（钉死「复制矩阵时转置/翻转」这个本任务唯一的真实风险）：左上、右上、左下三个 7×7 图案的**外环全暗、次环全亮、中心 3×3 全暗**；右下角 `(size-7..size-1, size-7..size-1)` **不是**定位图案。
3. **时序图案**：第 6 行与第 6 列的暗/亮交替（在定位图案之外的范围）。
4. **暗模组**：`modules[4 * version + 9][8] === true`。
5. **格式信息两副本一致**：按 ISO 18004 的两处坐标各读 15 位，断言两串**逐位相同**（转置或翻转的矩阵必然破坏这条）。
6. **容量上限**（对应 `image-tools:37-40`）：对四个等级各取 `maxByteCapacity(level)` 个 `'a'` → 成功且 `version === 40`；取 `+1` 个 → `code === 'TOO_LONG'`，`detail` 同时含内容字节数与该等级容量，`suggestion` 含建议的等级；`QR_MAX_BYTE_CAPACITY` 逐值与设计文档 `:209` 对齐。
7. **中文与 emoji 真往返**（对应 `image-tools:42-45`）：`'中'` / `'中文'` / `'🚀'` / `'中文 abc 🚀'` 各生成后**用测试内解码器解回**，断言 `=== 原文`；并断言 `qrByteLength('中') === 3`、`qrByteLength('🚀') === 4`（`String.length` 分别是 1 与 2，是错的）。
8. **中文容量边界**：H 等级下 `'中'.repeat(424)` 成功（`v40`），`'中'.repeat(425)` → `TOO_LONG`（424 × 3 = 1272 ≤ 1273，425 × 3 = 1275 > 1273）。
9. **颜色选项**（对应 `image-tools:22-25`）：`qrToSvg` 的 `<rect>` fill 等于背景色、`<path>` fill 等于前景色；`#1565c0` / `#fffde7` 原样生效；大写输入被归一化为小写。
10. **模块尺寸只改分辨率**（对应 `image-tools:34-35`）：同输入下 `moduleSize` 2 与 8 的**矩阵逐位相同**，SVG 的 `width`/`height` 成比例变化而 `viewBox` 完全不变。
11. **纠错等级提高使模组数增加**（对应 `image-tools:32-36`）：取足够长的文本，断言 `version(L) <= version(M) <= version(Q) <= version(H)` 且严格递增（用能拉开差距的长度，避免等级间恰好同版本导致断言脆弱 —— 若实测同级，改用更长的样本而不是放宽成 `<=` 了事）。
12. **SVG 契约**：含 `xmlns`、`shape-rendering="crispEdges"`、`role="img"`；`<rect>` 覆盖整个 `viewBox`；`d` 的首个命令落在 `margin` 偏移处（margin=0 与 margin=4 两种）；**不含** `<script`、`onload`、`javascript:`。
13. **颜色归一化与注入面**：`normalizeHexColor('#FFF') === '#ffffff'`、`'#1565C0' → '#1565c0'`；`'red'` / `'#12345'` / `'#gggggg'` / `''` → `null`；`qrToSvg` 在传入非法颜色时回落到默认色（**这是 Core 唯一的注入关口，必须有断言**）。
14. **对比度**（对应 `image-tools:27-30`）：`relativeLuminance('#ffffff') === 1`、`('#000000') === 0`；`contrastRatio('#000000','#ffffff')` ≈ 21；`contrastRatio('#1565c0','#fffde7')` ≈ 5.5975（spec 举的例子，>3 不告警）；`isLowContrast('#ffffff','#fffffe') === true`、`('#888888','#ffffff') === false`（3.5449，阈值上方）、`('#cccccc','#ffffff') === true`、阈值可参数化（`('#888888','#ffffff',4) === true`）。**以上数值均由 Node 实算，不是估计**。
15. **选项归一化**：`resolveQrRenderOptions` 对越界值 clamp 并取整（`moduleSize 0 → 1`、`99 → 16`、`2.7 → 2`；`margin -1 → 0`、`99 → 16`）、对 `NaN`/非有限数回落默认值。
16. **空输入**：`generateQrMatrix('')` → `code === 'EMPTY_INPUT'`；`' '`（单个空格）**是合法内容**，正常生成（Core 只拒绝真正的空串，空态判定属 UI 职责）。
17. **`darkModuleCount`** 与逐格统计一致，且随版本单调不减。

**Step 1–3**：写测试到失败（`Cannot find module './qrcode'`）→ 实现 Task 2 → 全绿。

---

### Task 4: 二维码生成器工具（8.3）

**Files:**
- Create: `src/tools/image/qrcode-generator/meta.ts`
- Create: `src/tools/image/qrcode-generator/canvas.ts`（**唯一碰 DOM 的地方**）
- Create: `src/tools/image/qrcode-generator/Tool.tsx`
- Test: `src/tools/image/qrcode-generator/Tool.test.tsx`

**meta.ts**（id 已被既有测试写死，不可改）：

```ts
export default {
  id: 'qrcode-generator',
  name: '二维码生成器',
  category: 'image',
  description: '把文本生成为二维码，支持颜色、纠错等级与模块尺寸，可导出 PNG / SVG',
  keywords: ['qrcode', 'qr', '二维码', '二维条码', 'barcode', '生成'],
  order: 10,
} satisfies ToolMeta
```

`keywords` 必须含 `qrcode`、`qr`、`二维码`、`二维条码`（`searchTools` 的既有用例按这几个词取命中）。

**布局**：用 `body` 形态（设计文档 `:304` 明确二维码走 `body`；`ToolLayoutProps` 是判别联合，`body` 与 `input/output` 互斥）。

```
[OptionsBar] 纠错等级 L|M|Q|H    模块尺寸 [4]    前景 [■] 背景 [■]    填入示例 清空
[Body]  左：输入文本 CodeArea(rows=6) + 信息行    右：Pane「预览」内嵌 SVG + 操作行（导出 PNG / 导出 SVG / 复制图片）
[Status] 版本 v3 · 29×29 模组 · 输出 232×232 像素 · 内容 17 字节
```

**关键实现点：**

1. **预览用内联 SVG**：`dangerouslySetInnerHTML={{ __html: svg }}`，其中 `svg = qrToSvg(matrix, render)`。
   **安全性不来自 React 的转义，而来自 Core 的三条硬约束**：颜色只可能是 `normalizeHexColor` 产出的 `^#[0-9a-f]{6}$`，其余进入 SVG 的都是 `Number` 与 `boolean`，文本内容**从不进入 SVG**。三条都有 Task 3 的断言锁定（第 12、13 条）。
2. **导出 PNG / 复制图片**走 `canvas.ts`：
   ```ts
   export function renderQrToCanvas(canvas: HTMLCanvasElement, matrix: QrMatrix, render: QrRenderOptions): boolean
   export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Result<Blob>>
   ```
   `renderQrToCanvas` 在 `getContext('2d')` 返回 `null` 时**返回 false 而不抛错**（jsdom 实测就是 null）；`canvasToPngBlob` 在 `toBlob` 不可用或回调给出 `null` 时返回 `err('PNG_UNAVAILABLE', …)`。两者都不新增依赖。
3. **PNG 尺寸 = 预览尺寸**：canvas 的 `width/height = qrPixelSize(matrix, render)`，与 SVG 的 `width/height` 同源同值 ⇒ 「内容与预览一致、尺寸与所选模块尺寸匹配」（`image-tools:47-50`）由构造保证。
4. **复制图片**：`copyImage(blob)`。**界面始终渲染该按钮**（框架注释建议「不可用时隐藏」，但那会让 `image-tools:57-60` 在 WKWebView 上**永远不可达**）；点击后失败时把 `Result.error` 显示为提示并指向「改用导出 PNG」。**WKWebView 下 `ClipboardItem` 可能不存在**，这条留待第 9 组的 9.6 跨 WebView 冒烟定论，本任务只保证「不静默失败」。
5. **对比度警告**：`isLowContrast(foreground, background)` 为真时，预览上方显示警告条，**但仍照常生成**（spec 原文「但仍按用户选择生成」）。
6. **过长提示**：`generateQrMatrix` 返回 `TOO_LONG` 时，用 `ErrorNote` 展示 —— `detail` 里已含「当前内容 N 字节，纠错等级 X 最多可容纳 M 字节」，满足「给出当前等级的最大可容纳长度」。
7. **实时预览**：全部计算在 `useMemo` 里，随 `input` / 各参数变化自动重算，**不设「生成」按钮**。
8. 参数候选表（纠错等级）与 `INITIAL_STATE` 定义在组件外部。

**测试清单**（`vi.mock('@/framework/file')` + `vi.mock('@/framework/clipboard')`，用 `vi.hoisted` 承载 spy —— 计划②-1 的既有写法）：

1. 默认参数下渲染出 `<svg>`，状态栏含 `版本` 与 `模组`。
2. 修改输入文本后预览自动更新（状态栏字节数变化，无需点击任何按钮）。
3. 空输入（含纯空白）→ 显示「需要输入内容」空态且**无** `<svg>`。
4. 改前景色 `#1565c0` → 预览 SVG 的 `<path>` fill 变为该色（断言 `getByTestId('qr-preview')` 内 `path` 的 `fill` 属性）。
5. 选低对比度组合（`#ffffff` 前景 / `#fffffe` 背景）→ 出现警告文案，**且预览仍存在**。
6. 提高纠错等级 → 状态栏的模组数与版本数上升。
7. 改模块尺寸 → 预览的 `width/height` 变化、`viewBox` 与版本/模组数**不变**。
8. 超长内容 → `role="alert"` 含「超出」「最多」与当前等级字母，且预览消失。
9. 中文内容 → 正常生成预览。
10. 点「导出 SVG」→ `downloadText` 被调用，参数为 `('qrcode.svg', <含 `<svg` 的字符串>, 'image/svg+xml')`。
11. 点「导出 PNG」→ jsdom 无 2D 上下文 ⇒ 断言 `downloadBytes` **未**被调用且出现「当前环境不支持导出 PNG」类提示（**这是环境限制下的诚实断言**，真机行为留第 9 组冒烟）。
12. 点「复制图片」→ `copyImage` 返回失败时出现提示；返回成功时按钮变为已复制。

---

### Task 5: JSON 压缩工具（8.6）

**Files:**
- Create: `src/tools/dev/json-minify/meta.ts`
- Create: `src/tools/dev/json-minify/Tool.tsx`
- Test: `src/tools/dev/json-minify/Tool.test.tsx`

```ts
export default {
  id: 'json-minify',                       // 已被 CommandPalette.test.tsx:29 写死
  name: 'JSON 压缩',
  category: 'dev',
  description: '移除 JSON 中的多余空白，保留字符串内的转义字面量',
  keywords: ['json', 'minify', '压缩', '压缩json', '去空白', '单行'],
  order: 10,
} satisfies ToolMeta
```

**实现要点：**

1. 直接调 `minifyJson`（**不新建 `core/dev/json-format.ts`** —— 设计文档原列的组合层已被计划① Task 8 显式取消：`plans/2026-09-15-it-toolbox-foundation.md:2550`「它是多余的一跳，工具直接调用 `minifyJson` / `formatJson` 即可」）。
2. 状态栏：`{inputBytes} → {outputBytes} 字节 · 节省 {pct}%`，`pct` 保留一位小数；`inputBytes === 0` 时按 `0.0%` 处理（避免除零）。
3. 空输入 → `EmptyState`，**不报错**（`dev-tools:47-50`）；`trim()` 全空白同样按空处理。
4. 非法 JSON → `ErrorNote`（含 `第 X 行` / `第 X 列` / `偏移 N`，`dev-tools:42-45`），且不给输出区。
5. 输出区带 `CopyButton` 与 `DownloadButton filename="minified.json"`。
6. 标准 `input | output` 形态。

**测试清单**：多行输入 → 单行输出（`getAllByRole('listitem')` 取行，同 web 工具的既有写法）；键值内容与顺序不变；状态栏字节数与节省比例；已压缩输入的节省为 `0.0%`；`\u0041` 原样保留；非法 JSON → `role="alert"` 含 `第 1 行` 且无 `listitem`；空输入与纯空白 → 空态、**无 alert**。

---

### Task 6: JSON 美化格式化工具（8.7）

**Files:**
- Create: `src/tools/dev/json-format/meta.ts`
- Create: `src/tools/dev/json-format/Tool.tsx`
- Test: `src/tools/dev/json-format/Tool.test.tsx`

```ts
export default {
  id: 'json-format',
  name: 'JSON 美化',
  category: 'dev',
  description: '按 2 空格 / 4 空格 / 制表符缩进格式化 JSON，可选键排序与逐值类型提示',
  keywords: ['json', 'format', 'pretty', 'beautify', '美化', '格式化', '缩进', '类型'],
  order: 20,
} satisfies ToolMeta
```

**实现要点：**

1. **参数**：缩进（`SegmentedControl`：`2 空格` / `4 空格` / `制表符`，值 `2 | 4 | 'tab'`）、键排序（`Checkbox`）、视图（`SegmentedControl`：`JSON` / `类型提示`）。
2. **键排序的行为提示**（`dev-tools:81-84`，`3.4` 的 P5 决策）：开启时显示常驻提示条，文案**如实覆盖实际改写范围**，而不是只提转义 —— 账本已核实排序路径走 `JSON.parse` + `JSON.stringify`，还会**静默**改掉大整数精度、超范围指数（`1e999 → null`）、`-0` 与重复键（`progress.md:299`）：

   > 键排序会按值对象重建输出：字符串中的等价转义写法（如 `\u0041` → `A`）会被规范化，大整数精度、`1e999` 这类超范围指数、`-0` 与重复键也可能被改写。默认（不排序）路径不走重建，上述内容原样保留。

   同时若 `FormatJsonResult.normalizedEscapes` 为真，再补一句「本次输出确实发生了转义规范化」。
3. **类型提示视图（`dev-tools:54` 的承担者）**：对同一份输入 `parseJsonValue(input)` → `collectTypeHints(value)`，按行渲染 `路径` / 类型标签 / 概要。
   **为什么不把类型标注直接写进 JSON 输出**：`dev-tools:96-99` 要求美化输出可交给压缩工具（「与压缩互为逆操作」），一旦往输出里插注释就会破坏这条；视图切换是同时满足两者的唯一办法。切换本身不改变输出文本，`复制` / `下载` 永远给的是纯 JSON。
4. **大输入的处理中状态**（`dev-tools:91-94`，设计文档 `:211`：`> 512KB`）：
   ```ts
   const LARGE_INPUT_BYTES = 512 * 1024
   const large = utf8ByteLength(input) > LARGE_INPUT_BYTES
   const [settled, setSettled] = useState(input)
   useEffect(() => {
     if (!large) { if (settled !== input) setSettled(input); return }   // 小输入：立即同步
     const timer = setTimeout(() => setSettled(input), 0)               // 大输入：让出一帧
     return () => clearTimeout(timer)
   }, [input, large, settled])
   const computing = large && settled !== input
   ```
   小输入首帧即出结果（不会为每次按键闪一帧「处理中」）；大输入首帧渲染 `Spinner role="status"` 显示「正在处理…」，下一帧才计算 ⇒ 界面不出现无响应。**不用 `useDeferredValue`**：它的低优先级渲染在 `act()` 内会被一起冲刷掉，`处理中` 状态在测试里不可观测，等于把 spec 要求的可观测行为变成不可验证。
5. 错误定位、空输入、`复制`/`下载`（`formatted.json`）与 Task 5 同构。
6. 状态栏：`缩进 {2 空格|4 空格|制表符}[ · 键排序] · {inputBytes} → {outputBytes} 字节`。

**测试清单**：
1. 默认 2 空格缩进；切 4 空格与制表符输出随之变化。
2. 开启键排序 → 键按字典序、数组保持原序、提示条出现。
3. 关闭键排序 → 键序与输入一致、提示条消失。
4. 默认模式保留 `\u0041` 字面量；开启键排序后同一输入变为 `"A"`（`normalizedEscapes` 的界面体现）。
5. 切到「类型提示」视图 → 出现 `$.` 开头的路径与中文类型标签；切回「JSON」→ 输出仍是纯 JSON（断言首行不含 `//` 或 `类型`）。
6. 超过 512KB 的输入 → 先出现 `role="status"` 的「正在处理」，随后（`vi.waitFor`）出现结果且状态消失。**用真实时钟 + `vi.waitFor`，不用假时钟**（Harness notes：假时钟遇 `userEvent` 会死等）。
7. 非法 JSON → `role="alert"` 含行列；空输入 → 空态。

---

### Task 7: 往返一致性与大输入用例（8.5）

**Files:**
- Create: `src/core/json/roundtrip.test.ts`
- **不改** `minify.test.ts` / `format.test.ts`（计划① 已评审的既有文件，避免无谓扰动；8.5 要求的「往返一致性 + 大输入」在本文件里自成一套）

**契约（对应 `dev-tools:32-35`、`:96-99`）**：`minify(format(x))` 与 `minify(x)` **逐字节相同**（限「未开启键排序」，见文末 spec 缺陷 R60）。

**测试清单**：
1. 逐字节往返：对一组样本（转义字面量、`\u0041`、`\/`、中文键值、emoji、嵌套空容器、顶层数组、`-0`、`1e999`、重复键）断言 `minify(format(x)) === minify(x)`。
2. 三种缩进各跑一遍第 1 条（缩进不该影响往返结果）。
3. 语义等价：`parseJsonValue(minify(x))` 与 `parseJsonValue(x)` 深相等（`toEqual`）。
4. 美化输出可再解析：`parseJsonValue(format(x).output)` 成功。
5. **大输入**：构造 > 1MB 的 JSON（`JSON.stringify` 一个 20000 元素的数组，每个元素含多字段），断言：
   - `minifyJson` 成功且 `inputBytes > 1024 * 1024`；
   - `formatJson` 成功且输出行数 = 输入结构规模（或至少 `outputBytes > inputBytes`）；
   - `minify(format(x)) === minify(x)` 在大输入上同样成立；
   - 单次耗时在宽松阈值内（**不做严格的性能断言**：CI 机器差异会让它变成随机失败；只断言「在 vitest 默认 5s 超时内完成」这一可观测事实，并在报告里记录实测耗时）。
6. 深嵌套输入不炸：`'['.repeat(200)` 这一类的**非法**输入返回 `Result` 错误而不是抛异常（账本 `progress.md:300` 登记的 MINOR-2，这里只钉住「不抛」这个可观测契约）。

---

### Task 8: 勾选 tasks.md 与本计划验收

- `tasks.md` 勾选 `8.1 8.2 8.3 8.5 8.6 8.7`，并把 **8.4 标注为「已由 8.10 交付，`core/dev/json-format.ts` 组合层按计划① Task 8 的决定取消」**（计划原文 `plans/2026-09-15-it-toolbox-foundation.md:2550`）。**不新建 `core/dev/`**。
- 门禁：`npx vitest run`（全量）、`npm run typecheck`、`npx eslint src`、`npm run build`（含 `scan-egress`）。
- 预期新增文件 **13**：Core 3（`type-hints.ts`、`qrcode.ts`、`roundtrip.test.ts`）+ Core 测试 2（`type-hints.test.ts`、`qrcode.test.ts`）+ 工具 10（3 组 `{meta.ts, Tool.tsx}` + `canvas.ts` + 3 个 `Tool.test.tsx`）。
- 修改既有文件 **2**：`core/web/json-diff.ts`（搬家 + 再导出）、`openspec/changes/it-toolbox-app/tasks.md`。

---

## 任务与 spec Scenario 覆盖对照表

| Scenario | 承担测试 |
|---|---|
| 二维码 · 默认参数生成 | Task 3-1、Task 4-1 |
| 二维码 · 实时预览 | Task 4-2 |
| 二维码 · 空输入 | Task 3-16、Task 4-3 |
| 二维码 · 自定义前景色与背景色 | Task 3-9、Task 4-4 |
| 二维码 · 颜色对比度不足的警告 | Task 3-14、Task 4-5 |
| 二维码 · 调整二维码复杂度 | Task 3-10、Task 3-11、Task 4-6、Task 4-7 |
| 二维码 · 长文本容量 | Task 3-6、Task 3-8、Task 4-8 |
| 二维码 · 中文内容 | Task 3-7（测试内解码器真解回） |
| 二维码 · 导出 PNG | Task 4-11（环境限制下的诚实断言 + 第 9 组真机冒烟） |
| 二维码 · 导出 SVG | Task 3-12、Task 4-10 |
| 二维码 · 复制图片 | Task 4-12 |
| 压缩 · 压缩格式化的 JSON | Task 5 测试 1、2 |
| 压缩 · 语义等价 | Task 7-3 |
| 压缩 · 保留字符串内空白 | 既有 `minify.test.ts`（8.10） |
| 压缩 · 保留特殊字符转义 | 既有 `minify.test.ts`（8.10） |
| 压缩 · 转义字面量不被规范化 | 既有 `minify.test.ts`（8.10） |
| 压缩 · 压缩与美化逐字节往返 | Task 7-1、7-2 |
| 压缩 · 展示体积变化 | Task 5 测试 3 |
| 压缩 · 非法 JSON | Task 5 测试 6 |
| 压缩 · 空输入 | Task 5 测试 8 |
| 美化 · 默认缩进美化 | Task 6-1 |
| 美化 · 缩进选项 | Task 6-1 |
| 美化 · 键排序 | Task 6-2 |
| 美化 · 关闭键排序保持原序 | Task 6-3 |
| 美化 · 默认模式保留转义字面量 | Task 6-4 |
| 美化 · 键排序模式的行为提示 | Task 6-2（提示条文案覆盖转义 + 精度 + 重复键） |
| 美化 · 非法 JSON 定位 | Task 6-7 |
| 美化 · 大体积输入 | Task 6-6、Task 7-5 |
| 美化 · 与压缩互为逆操作 | Task 7-1（**限未开启键排序**，见下） |
| 「展示每个值的数据类型提示」（`dev-tools:54` 的 Requirement 正文，**无对应 Scenario**） | Task 1 + Task 6-5 |

## 已知偏离与风险（需在执行报告中逐条复述）

1. **`core/dev/json-format.ts` 不建**（8.4）：计划① Task 8 已决定取消该组合层，`minifyJson` / `formatJson` 由 `core/json/` 直接提供，工具直连。
2. **强制 byte 模式**：使容量上限与硬编码表精确对齐，代价是约 3000 位纯数字的输入被拒（numeric 模式理论上可容 7089 位）。**取舍理由**：设计文档 `:209` 明确用 v40 byte 容量表来回答「当前等级最大可容纳长度」，自动模式会让这句提示失真。
3. **spec 缺陷 R60（账本已登记，本计划不改 spec）**：`dev-tools:96-99`「与压缩互为逆操作」漏写「未开启键排序」这一限定，与 `:66-69` 的键排序场景字面互斥。本计划按「未开启键排序」实现并测试，**spec 文本的修订留给收尾阶段**（账本「待收尾时同步的文档」已列此项）。
4. **`image-tools:22-25` 的「仍能被标准扫码器识别」**：本机无解码器可做外部对照，证据链是「上游 `qrcode` 编码 + 测试内 v1 解码器真解回 + 几何一致性」。真机扫码不在本计划的可验证范围内。
5. **`image-tools:47-60`（导出 PNG / 复制图片）**：jsdom 无 2D 上下文，只能断言「守卫生效、错误可见、按钮在」；真实落盘与剪贴板写入留第 9 组 9.3 / 9.6 冒烟。
6. **`core/image/qrcode.ts` 的 `QR_FAILED` 兜底分支**在容量预检存在时不可达（与计划②-3 的 `TOO_DEEP` 同类），属有意保留的安全网，**不写无效用例**。
7. **本计划不碰任何共享文件**（`framework/ui/index.ts`、`Inputs.tsx`、`file.ts`、`test/setup.ts`），以避开与并行 crypto 工作流的写冲突。

---

## 执行记录（2026-09-16，与上述草稿的差异）

本计划的 8 个任务（8.1 / 8.2 / 8.3 / 8.5 / 8.6 / 8.7 及 8.4 的处置）已全部落地并通过四道门禁，**代码是最终事实来源**；下列差异是对上面草稿的修正，重跑本计划时以仓库代码为准。

**验收实测**（`npx vitest run` / `npm run typecheck` / `npx eslint src` / `npm run build`）：

| 项 | 结果 |
|---|---|
| `src/core/json` + `src/core/web`（含本计划新增的 `type-hints.test.ts` / `roundtrip.test.ts`） | 10 文件 / **189 用例全绿** |
| `src/core/image` | 1 文件 / **43 用例全绿** |
| `src/tools/image` + `src/tools/dev` | 4 文件 / **47 用例全绿** |
| 全量 `npx vitest run` | **61 文件 / 749 用例全绿** |
| `npm run typecheck` | 通过（修掉 3 处类型错误后，见下） |
| `npx eslint src` | 通过（修掉 1 处未使用导入后，见下） |
| `npm run build` | 通过；`[scan-egress] 网络 API 调用 0 处；远程 URL 字面量 7 处` → `通过：产物中未发现外发能力。` |
| `tasks.md` 第 8 组 | 8.1–8.7 全部勾选（8.4 以子条目注明「已由 8.10 交付，`core/dev/` 组合层取消」），8.8–8.10 承计划① 原有勾选 |

**文件账（修正草稿的算术）**：草稿「Task 8」写「预期新增文件 **13**」并自行枚举为 15 项，两处都不对 —— **实际新增 16**（枚举时漏了 `canvas.test.ts`）。构成：Core 5（`json/type-hints.ts`、`json/type-hints.test.ts`、`json/roundtrip.test.ts`、`image/qrcode.ts`、`image/qrcode.test.ts`）+ 工具 11（`image/qrcode-generator/` 5、`dev/json-minify/` 3、`dev/json-format/` 3）。修改既有文件 **2**：`core/web/json-diff.ts`（符号搬家 + 再导出）、`openspec/changes/it-toolbox-app/tasks.md`。

**草稿未预见、执行期新修的 4 处**：

1. **`core/image/qrcode.ts` 的 byte 模式入参类型**（`TS2322`）：`create([{ data: text, mode: 'byte' }])` 中 `@types/qrcode` 的 `data` 只接受字节序列，传 `string` 过不了 `tsc`。改为显式 `utf8ToBytes(text)`（`core/bytes.ts` 既有导出）。**行为等价**：`qrcode/lib/core/byte-data.js:5-9` 对字符串本来就自行 `new TextEncoder().encode(data)`；附带好处是「容量按 UTF-8 字节算」在代码里被写下一次，与 `qrByteLength` 的注释互相印证。
2. **两处 `Tool.test.tsx` 的 `fileMocks` 参数类型**（`TS2493` ×3 ×2）：`vi.fn(async () => ({ ok: true as const }))` 会被推成**零参**函数，于是 `mock.calls[0]` 是**长度 0 的元组**，`const [filename, text, mime] = …` 直接报「Tuple type '[]' of length '0' has no element at index '0'」。改为按 `@/framework/file` 的真实签名标注参数（`_` 前缀，命中 `argsIgnorePattern: '^_'`）。**这条是「测试断言读到的参数类型」而非运行期问题**，vitest 里一直是通过的，只有 `tsc` 能抓到。
3. **`qrcode-generator/Tool.test.tsx` 的 `within` 未使用**：`npx eslint src` 报 `no-unused-vars`。
4. **`roundtrip.test.ts` 大输入用例的断言写错**（Task 7 唯一一次红）：原写 `expect(back.value.outputBytes).toBeLessThan(formatted.value.inputBytes)`，而 `formatted.value.inputBytes` 正是**紧凑原串**的字节数（1131116），与压缩回来的长度必然相等 ⇒ `expected 1131116 to be less than 1131116`。改为先断言「美化确实把体积撑大」（`formatted.outputBytes > formatted.inputBytes`）再断言「压缩后小于美化产物」，这才对得上用例名里的「体积收回」；`back.outputBytes === BIG.length` 的逐字节要求本就由下一行保证。

**spec 覆盖与两处「无 Scenario」的 Requirement 正文**：

- `image-tools` 的 11 条 Scenario、`dev-tools` 的 18 条 Scenario 均已在对照表里落到具体用例。
- `dev-tools:54`「**展示每个值的数据类型提示**」是 Requirement **正文**、**没有对应 Scenario**，账本 `progress.md:474` 曾记「须确认由 T8/T13/T15/T16 承担，否则归档时无人实现」。本计划**主动认领为唯一载体**：Core 侧 `json/type-hints.ts`（`collectTypeHints`）+ 工具侧 8.7 的「类型提示」视图，共 16 条 Core 用例 + 3 条工具用例。**该归属需在收尾阶段回填账本**（本计划未改账本：同一份 `progress.md` 正被并行 crypto 工作流高频写入，避免写冲突）。
- **spec 缺陷 R60**（`dev-tools:96-99` 漏写「未开启键排序」限定）与 **R88**（计划② 拆 4 份）保持账本原状，**本计划不改 spec、不改 `tasks.md` 第 9 组**。

**未做（按系统约束有意跳过）**：

- 各任务的 `git commit` 未执行 —— 提交需用户明确指示；全部改动仍在工作区，`git status` 可直接复核。
- 第 9 组全量验收（`9.1`–`9.11`）不在本计划范围（按 R88 的「图片与开发 + 验收」拆分，后续追加到本文件）。

**并发注意**：执行期间仓库里有另一路会话在写 crypto 侧（`src/core/crypto/*`、`src/tools/crypto/rsa-key-generator/`，以及 `src/framework/ui/index.ts` / `src/framework/file.ts` / `src/app/theme.css` 等共享文件）。本计划**未触碰其中任何一个**，故全量 749 用例（含对方已交付部分）在本轮末尾一致全绿；草稿「本计划不碰任何共享文件」的约束得到保持。

---

# 第 9 组：全量验收与打包（9.1–9.11）

> 本节即 Task 8 所写「第 9 组不在本计划范围、后续追加到本文件」的那一部分，2026-09-16 追加。
> 约定与前三份计划一致：**以可机器复现的证据为准**；需真机 / GUI / 跨平台的项**不得**用推断代替 —— 保留未勾选并写清已做的替代证据。

## 可验证性分级（先定死，避免把「没测」写成「通过」）

| 类别 | 任务 | 本机（macOS arm64 + 仓库）可否自动验证 |
|---|---|---|
| A | 9.1 工具可发现性、9.2 Scenario 覆盖审计、9.5 安装包体积、9.7 README、9.8 `openspec validate`、9.9 离线四层 | ✅ 可 |
| B | 9.3 断网冒烟（GUI 逐个用 17 个工具）、9.4 四平台构建（本机只能产 arm64）、9.6 跨 WebView（需 Windows WebView2）、9.10 Windows 前置条件（需 Windows 机器） | ❌ 需真机 / 人工 |

**A 类完成后勾选；B 类一律不勾**，在账本与本文件中记录已做的替代证据与「需人工确认项」。

---

### Task G1: 9.1 17 个工具在侧栏与搜索中均可发现

**Files:**
- Create: `src/app/tool-discovery.test.tsx`

**为什么需要新用例**：`registry.test.ts` 只校验**注册表一致性**（配对 / id / 类别 / keywords 非空），`App.test.tsx` 与 `CommandPalette.test.tsx` 写于「仓库只有 1 个工具」时期（前者只断言 `listTools()[0]` 是 UUID 生成器、后者的选项来自 3 条 mock 清单）⇒ **没有任何用例断言「17 个工具全部可被侧栏渲染、全部可被搜索命中」**，而这正是 9.1 的字面要求。

- [ ] **Step 1: 写用例**（真实注册表，不 mock `listTools`）
  - 断言 `listTools()` 为 **17** 条，且 id 集合固定在用例内（新增/删除工具必须显式改这条用例）；
  - 渲染 `<App />`，按类别逐条断言侧栏出现全部 17 个工具名，且类别归属与 `meta.category` 一致；
  - 对每个工具，用它的 `name` 与**每一个** `keywords` 词调用搜索，断言结果首位是该工具（避免「关键词只挂在 meta 里、搜索层却漏了」）；
  - 断言类别计数：crypto 5 / converter 5 / web 4 / image 1 / dev 2。
- [ ] **Step 2: 跑**：`npx vitest run --project ui src/app/tool-discovery.test.tsx`
- [ ] **Step 3: Expected**：PASS；新增 3 条用例。（若失败，`registry.test.ts` 的先例说明问题会带具体目录名报出。）

---

### Task G2: 9.2 全量 Scenario 覆盖审计（②-2/②-3/②-4 的 95 条）

**对应范围**：`tasks.md` 9.2 要求「spec 中每个 Scenario 均有对应用例」。计划①（app-shell 26 / tool-registry 31）与本工作流 crypto（29）的审计已分别完成 ✅，本节负责 **converter 33 / web 33 / image 11 / dev 18 = 95 条**。

**Files:**
- Modify: 本文件（审计表追加在 Task G2 之后）

- [ ] **Step 1: 取全量 Scenario**
  Run: `for s in converter-tools web-tools image-tools dev-tools; do printf "%-16s %s\n" $s "$(grep -c '^#### Scenario:' openspec/changes/it-toolbox-app/specs/$s/spec.md)"; done`
  Expected: `33 / 33 / 11 / 18`。
- [ ] **Step 2: 逐条填表**（口径与 crypto 的 T11 完全一致）
  每条 Scenario 必须指到一个**具体 `it(...)` 用例名**；界面层指 `src/tools/**/Tool.test.tsx`，Core 层指 `src/core/**`；**不许**写「已由实现保证」之类替代答案；指不到的**当场回补用例**并跑绿。
- [ ] **Step 3: 行数自洽**：表行数必须**等于** Step 1 的条数（33/33/11/18）。

---

### Task G3: 9.5 安装包体积（≤ 15MB 硬约束）

- [ ] **Step 1: 用 17 个工具的产物重新打包**（计划① 的体积实测只含 1 个工具，不足以代表全量）
  Run: `npm run tauri:build`
- [ ] **Step 2: 量**：`stat -f "%z" src-tauri/target/release/bundle/dmg/*.dmg`
- [ ] **Step 3: Expected**：≤ **15,728,640** 字节（15MB）；实测值记入本文件与账本。

---

### Task G4: 9.7 + 9.11 README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 清掉过时陈述**（硬性）：开头的「当前进度」写「计划① 已交付 **1 个工具**… 其余 16 个工具属计划②，尚未实现」—— 现已 17 个全部交付，必须改写；否则 README 自述与产物矛盾。
- [ ] **Step 2: 核对 9.11 两条要求是否已在文中**（计划① 已写，此处只做核对，不重复添加）：
  - Windows 前置条件（Win10 2018-04+ / Win11 自带运行时；缺失时的自备途径）✅ 已在「Windows 前置条件」节；
  - 全离线安装包变体的构建方式与**体积代价**（约 140MB，内嵌 ~127MB 运行时）✅ 已在该节。
- [ ] **Step 3: 核对四层离线的描述与实现一致**：README 第 3 层现写「扫描网络 API 调用，发现即失败」——与实现一致（**R58**：spec 文本将在 Task G6 同步为同一表述）。

---

### Task G5: 9.8 `openspec validate` 与一致性校验

- [ ] **Step 1**: `npx openspec validate it-toolbox-app` → Expected: `Change 'it-toolbox-app' is valid`。
- [ ] **Step 2**: `npm test` → Expected: 全绿（**62 文件 / 761 用例**，基线值）。

---

### Task G6: 9.9 离线四层（每层都要具名证据）+ 收尾文档同步

**Files:**
- Modify: `openspec/changes/it-toolbox-app/specs/app-shell/spec.md`（R58）
- Modify: `openspec/changes/it-toolbox-app/specs/dev-tools/spec.md`（R60）
- Modify: `docs/superpowers/plans/2026-09-15-it-toolbox-foundation.md`（TypeScript 版本号）

- [ ] **Step 1: 第 1 层（结构/CSP）**：`strings src-tauri/target/release/it-toolbox | grep -i connect-src` ⇒ 应看到 `connect-src ipc:` 形式、且**不含**远程来源。
- [ ] **Step 2: 第 2 层（检测）**：`src/framework/offline-guard.test.ts`（6 用例，含 fetch/XHR/WebSocket 三路）。
- [ ] **Step 3: 第 3 层（预防/扫描）**：`npm run build` 的 `[scan-egress]` 输出（网络 API 调用应为 0 处）。
- [ ] **Step 4: 第 4 层（交互）**：`tools/converter/markdown-to-html/Tool.test.tsx` 的远程图片占位与「链接不导航」用例。
- [ ] **Step 5（R58，spec 与实现对齐）**：`app-shell/spec.md:89` 与 `:112-115` 改为「**网络 API 调用（fetch/XHR/WebSocket）致命**；远程 URL 字面量告警」——实现侧的判定见账本 R58（React 每次构建都注入 `https://react.dev/errors/` 字面量，按 spec 字面设为致命则构建恒红）。**改完必须重跑 `npx openspec validate`。**
- [ ] **Step 6（R60，补限定词）**：`dev-tools/spec.md:96-99` 的「与压缩互为逆操作」补「**未开启键排序**」限定词（该 spec 的 `:34` / `:78` 已主动带该限定词，`:96` 是漏写）。
- [ ] **Step 7（TS 版本）**：`plans/2026-09-15-it-toolbox-foundation.md:15` 与 `:479` 的「TypeScript 7.0 / TypeScript 7」→ 实际依赖 `typescript@^6.0.3`。

---

### Task G7: 勾选 tasks.md 与账本收尾

- [ ] **Step 1**: 勾选 A 类**确实完成**的 9.x（9.1 / 9.2 / 9.5 / 9.7 / 9.8 / 9.9）；**9.3 / 9.4 / 9.6 / 9.10 保留 `- [ ]`**（需真机），并在账本写明替代证据与需人工确认项。
- [ ] **Step 2**: 账本追加收尾条目（R58 / R60 / TS 三处文档同步 + B 类移交清单）。
- [ ] **Step 3**: 提交（沿用「共享文件用 blob 精确定位」手法，避免把并行工作流未提交的部分混入）。

---

## 第 9 组执行记录（2026-09-16）

**门禁实测（本机，改完所有文档后重跑）**：`npm test` → **63 文件 / 766 用例全绿**；`npm run typecheck` = 0；`npm run lint` = 0；`npm run build` = 0（`[scan-egress] 网络 API 调用 0 处；远程 URL 字面量 7 处` → `通过：产物中未发现外发能力。`）；`npx openspec validate it-toolbox-app` → `Change 'it-toolbox-app' is valid`。

### Task G1（9.1）执行记录

- 新增 `src/app/tool-discovery.test.tsx`，**4 条用例**（计划写 3，实际 4：把「按类别名也能搜到」单独立了一条）全绿。
- 基线写死 17 条的 id 集合与分类计数 ⇒ 今后新增/删除工具必须显式更新该用例。
- **验收发现（非缺陷，已记入账本）**：查询词恰为某工具全名时**不保证该工具排第一** —— 「JSON 转 YAML」与「YAML 转 JSON」互为镜像，三个 token 在两侧逐项同分、总分必然相等，首位由注册表顺序决定。spec 只要求「可发现」，故用例只断言命中；要「整名精确命中优先」得改 `search.ts` 的打分模型（计划① 既有行为，本次验收不改）。

### Task G2（9.2）执行记录 —— 95 条 Scenario 逐条对应

`grep -c '^#### Scenario:'` 实测：converter-tools **33** / web-tools **33** / image-tools **11** / dev-tools **18**，与下表行数相等（合计 95）。

| Requirement | Scenario | 覆盖用例（文件 :: 用例名） |
|---|---|---|
| 日期转换器 | 从时间戳（秒）解析 | `core/converter/date.test.ts` :: 秒级时间戳：1700000000 → ISO UTC 为 2023-11-14T22:13:20.000Z |
| 日期转换器 | 从时间戳（毫秒）解析 | `core/converter/date.test.ts` :: 毫秒级时间戳：1700000000000 不被误判为秒级 |
| 日期转换器 | 手动指定时间戳单位 | `core/converter/date.test.ts` :: 手动指定单位会覆盖自动判定，并在依据中标注单位 ＋ :: 提供自动 / 秒 / 毫秒 / 微秒 / 纳秒五个选项；`tools/converter/date-converter/Tool.test.tsx` :: 手动指定毫秒单位后按毫秒重新解释，且不再提示歧义 |
| 日期转换器 | 歧义数字输入 | `core/converter/date.test.ts` :: 歧义数字输入（8 位，例如 20240315）给出判定依据并标记 ambiguous；`tools/converter/date-converter/Tool.test.tsx` :: 歧义数字输入展示判定依据与提示 |
| 日期转换器 | 从 ISO 8601 解析 | `core/converter/date.test.ts` :: ISO 8601（带 Z）按 UTC 解释并标注格式 ＋ :: 带时区偏移（+08:00）按偏移换算 ＋ :: 带毫秒的 ISO 8601 保留毫秒；`tools/converter/date-converter/Tool.test.tsx` :: 输入 ISO 8601 并标注识别到的格式 |
| 日期转换器 | 从常见日期格式解析 | `core/converter/date.test.ts` :: YYYY-MM-DD 按本地零点解释并标注格式 ＋ :: YYYY/MM/DD HH:mm:ss 按本地时间解释并标注格式；`tools/converter/date-converter/Tool.test.tsx` :: 日期字符串走本地时间分支并标注格式 |
| 日期转换器 | 各表示可相互校验 | `core/converter/date.test.ts` :: 秒级时间戳乘以 1000 与毫秒级一致，且 ISO UTC 描述同一时刻 ＋ :: 输出七项表示，且 RFC 2822 使用数字时区 ＋ :: 本地 ISO 表示带 ±HH:mm 偏移而非 Z；`tools/converter/date-converter/Tool.test.tsx` :: 输入秒级时间戳后展示多项表示 |
| 日期转换器 | 无法识别的输入 | `core/converter/date.test.ts` :: 无法识别的输入返回 UNRECOGNIZED_DATE ＋ :: 空输入返回 EMPTY_INPUT；`tools/converter/date-converter/Tool.test.tsx` :: 无法识别的输入给出错误提示且不展示结果 |
| Base64 编码与解码 | 编码文本 | `core/converter/base64.test.ts` :: 标准变体编码 hello → aGVsbG8=；`tools/converter/base64/Tool.test.tsx` :: 默认编码模式：输入 hello 输出 aGVsbG8= |
| Base64 编码与解码 | 解码文本 | `core/converter/base64.test.ts` :: 标准变体解码 aGVsbG8= → hello；`tools/converter/base64/Tool.test.tsx` :: 中文编码后可被本工具解码还原 |
| Base64 编码与解码 | URL-safe 变体 | `core/converter/base64.test.ts` :: 标准变体会产出 + 与 /，URL-safe 变体改用 - 与 _ ＋ :: URL-safe 变体的输出可被解码还原 |
| Base64 编码与解码 | 不含填充字符 | `core/converter/base64.test.ts` :: 关闭填充后末尾无 = 且可被自身解码；`tools/converter/base64/Tool.test.tsx` :: 关闭填充符后输出不含 =，且仍可解码 |
| Base64 编码与解码 | 编码中文字符 | `core/converter/base64.test.ts` :: 中文往返不产生乱码 |
| Base64 编码与解码 | 非法 Base64 输入 | `core/converter/base64.test.ts` :: 包含非法字符时解码失败并定位到该字符 ＋ :: 解码出的字节不是合法 UTF-8 文本时返回 BAD_UTF8；`tools/converter/base64/Tool.test.tsx` :: 非法 Base64 给出错误提示且不给结果 ＋ :: 解码结果不是 UTF-8 文本时提示改用文件下载 |
| Base64 编码与解码 | 编码文件 | `tools/converter/base64/Tool.test.tsx` :: 拖入文件时输出该文件字节的 Base64 |
| Base64 编码与解码 | 解码为文件 | `tools/converter/base64/Tool.test.tsx` :: **下载文件交出解码后的原始字节（含非 UTF-8 的二进制）** ← 本次审计新补，见下 |
| YAML 转 JSON | 转换嵌套结构 | `core/converter/yaml.test.ts` :: 嵌套映射与数组转换为语义等价的 JSON；`tools/converter/yaml-to-json/Tool.test.tsx` :: 嵌套映射与数组转换为 JSON |
| YAML 转 JSON | 缩进配置生效 | `core/converter/yaml.test.ts` :: 缩进配置生效：默认 2 空格，可选 4 空格；`tools/converter/yaml-to-json/Tool.test.tsx` :: 缩进切换为 4 空格后输出随之变化 |
| YAML 转 JSON | 非字符串标量类型保持 | `core/converter/yaml.test.ts` :: 布尔值 / 数字 / null 保持原生类型而非字符串 |
| YAML 转 JSON | YAML 语法错误 | `core/converter/yaml.test.ts` :: 缩进错误的 YAML 给出错误行号（1 基）；`tools/converter/yaml-to-json/Tool.test.tsx` :: 语法错误时给出行号 |
| JSON 转 YAML | 转换对象 | `core/converter/yaml.test.ts` :: 对象转换为合法 YAML，且能被 yamlToJson 还原为原 JSON |
| JSON 转 YAML | 转换数组 | `core/converter/yaml.test.ts` :: 数组使用列表语法且顺序保持；`tools/converter/json-to-yaml/Tool.test.tsx` :: 对象转换为映射 / 列表语法 ＋ :: 数组保持顺序 |
| JSON 转 YAML | JSON 语法错误定位 | `core/converter/yaml.test.ts` :: 缺少闭合括号时报错并指出位置；`tools/converter/json-to-yaml/Tool.test.tsx` :: 缺少闭合括号时提示位置 |
| JSON 转 YAML | 空输入 | `core/converter/yaml.test.ts` :: 空输入不报错且不输出内容 ＋ :: 仅含注释的文档按空输入处理；`tools/converter/json-to-yaml/Tool.test.tsx` :: 空输入时展示空态 |
| Markdown 转 HTML | 转换标题与段落 | `core/converter/markdown.test.ts` :: 标题与段落；`tools/converter/markdown-to-html/Tool.test.tsx` :: 预览渲染标题与段落 |
| Markdown 转 HTML | 转换表格与代码块 | `core/converter/markdown.test.ts` :: 表格与围栏代码块（语言标注为 class）；`tools/converter/markdown-to-html/Tool.test.tsx` :: 表格与代码块渲染为对应结构 |
| Markdown 转 HTML | 列表嵌套 | `core/converter/markdown.test.ts` :: 嵌套有序 / 无序列表保持层级 |
| Markdown 转 HTML | 预览中不执行脚本 | `core/converter/markdown.test.ts` :: script 标签不产生可执行内容 ＋ :: 事件属性被转义为文本；`tools/converter/markdown-to-html/Tool.test.tsx` :: script 标签不进入 DOM |
| Markdown 转 HTML | 远程图片不发起加载 | `core/converter/markdown.test.ts` :: 远程图片渲染为占位块并保留原始地址，且不产出 `<img>`；`tools/converter/markdown-to-html/Tool.test.tsx` :: 远程图片渲染为占位块，不产出 img 元素 |
| Markdown 转 HTML | 外部链接不在应用内导航 | `core/converter/markdown.test.ts` :: 外部链接不渲染为可导航的 `<a>`，而是只读展示地址；`tools/converter/markdown-to-html/Tool.test.tsx` :: 外部链接不产出 a 元素，只读展示地址 |
| Markdown 转 HTML | 原始 HTML 标签被转义 | `core/converter/markdown.test.ts` :: 原始 HTML 标签被转义为实体 |
| Markdown 转 HTML | 复制 HTML 源码 | `tools/converter/markdown-to-html/Tool.test.tsx` :: 源码视图展示 HTML 源码并可直接复制 |
| Markdown 转 HTML | 非法或空输入 | `core/converter/markdown.test.ts` :: 空输入输出空字符串；`tools/converter/markdown-to-html/Tool.test.tsx` :: 空输入时展示空态 |
| URL 编码与解码 | 组件编码 | `core/web/url-codec.test.ts` :: 组件模式等价于 encodeURIComponent；`tools/web/url-codec/Tool.test.tsx` :: 默认组件模式编码 a b&c=d |
| URL 编码与解码 | 整体 URI 编码 | `core/web/url-codec.test.ts` :: 整体 URI 模式保留 :/?&= 等结构字符，只编码空格等非法字符；`tools/web/url-codec/Tool.test.tsx` :: 切到整体 URI 模式后保留结构字符 |
| URL 编码与解码 | 表单编码 | `core/web/url-codec.test.ts` :: 表单模式把空格编码为 +；`tools/web/url-codec/Tool.test.tsx` :: 切到表单模式后空格编码为 + |
| URL 编码与解码 | 解码 | `core/web/url-codec.test.ts` :: 组件模式解码；`tools/web/url-codec/Tool.test.tsx` :: 切换到解码方向后按当前模式解码 |
| URL 编码与解码 | 表单模式解码 | `core/web/url-codec.test.ts` :: 表单模式把 + 还原为空格；`tools/web/url-codec/Tool.test.tsx` :: 表单模式解码把 + 还原为空格 |
| URL 编码与解码 | 中文往返一致 | `core/web/url-codec.test.ts` :: 中文与 emoji 往返一致；`tools/web/url-codec/Tool.test.tsx` :: 中文与 emoji 编码后再解码还原 |
| URL 编码与解码 | 不完整转义序列 | `core/web/url-codec.test.ts` :: 以 % 结尾的不完整转义序列被拒绝并定位 ＋ :: 包含 %ZZ 的内容被拒绝 ＋ :: 合法的转义序列不被误报；`tools/web/url-codec/Tool.test.tsx` :: 以 % 结尾时提示非法转义且不给结果 ＋ :: %ZZ 提示非法转义 |
| JSON 差异比较 | 值修改 | `core/web/json-diff.test.ts` :: 值修改：给出路径、新旧值与两侧类型；`tools/web/json-diff/Tool.test.tsx` :: 值修改：展示路径与新旧值 |
| JSON 差异比较 | 新增字段 | `core/web/json-diff.test.ts` :: 新增字段：kind 为 added，左侧类型为 absent；`tools/web/json-diff/Tool.test.tsx` :: 新增与删除分别标注 |
| JSON 差异比较 | 删除字段 | `core/web/json-diff.test.ts` :: 删除字段：kind 为 removed，值取原值 ＋ :: 删除整个子树时只产出一条，值取子树本身 |
| JSON 差异比较 | 数组元素变化 | `core/web/json-diff.test.ts` :: 按索引定位元素修改 ＋ :: 区分元素删除与元素新增；`tools/web/json-diff/Tool.test.tsx` :: 数组按索引定位并区分修改与增删 |
| JSON 差异比较 | 嵌套对象深层差异 | `core/web/json-diff.test.ts` :: 深层差异的路径完整反映层级；`tools/web/json-diff/Tool.test.tsx` :: 嵌套差异的路径反映层级 |
| JSON 差异比较 | 类型变化 | `core/web/json-diff.test.ts` :: 类型变化标记为修改并同时给出两侧类型 ＋ :: 数组与对象互换视为修改而非深层展开；`tools/web/json-diff/Tool.test.tsx` :: 类型变化时并列展示两侧类型 |
| JSON 差异比较 | 无差异 | `core/web/json-diff.test.ts` :: 仅键序或空白不同时判定为无差异 ＋ :: 深层键序不同同样无差异；`tools/web/json-diff/Tool.test.tsx` :: 仅键序不同时展示无差异 ＋ :: 两侧都为空时展示空态 |
| JSON 差异比较 | 单侧非法 JSON | `core/web/json-diff.test.ts` :: 左侧非法时错误码为 LEFT_BAD_JSON，且带定位 ＋ :: 右侧非法时错误码为 RIGHT_BAD_JSON；`tools/web/json-diff/Tool.test.tsx` :: 左侧非法时在左侧提示且不给差异结果 ＋ :: 右侧非法时在右侧提示 |
| JSON 差异比较 | 交换两侧 | `core/web/json-diff.test.ts` :: 交换两侧后新增与删除互换；`tools/web/json-diff/Tool.test.tsx` :: 交换两侧后新增与删除互换 |
| JWT 解析器 | 解析标准 JWT | `core/web/jwt.test.ts` :: 分别解出头部与载荷的 JSON，并保留签名片段；`tools/web/jwt-parser/Tool.test.tsx` :: 展示解码后的头部与载荷 JSON ＋ :: 展示原始签名片段 |
| JWT 解析器 | 时间声明可读化 | `core/web/jwt.test.ts` :: exp / iat / nbf 都给出可读时间与中文含义；`tools/web/jwt-parser/Tool.test.tsx` :: 时间声明给出中文含义与可读时间 |
| JWT 解析器 | 过期状态提示 | `core/web/jwt.test.ts` :: exp 早于当前时间：判定过期并给出已过期时长；`tools/web/jwt-parser/Tool.test.tsx` :: exp 已过时提示过期并给出已过期时长 |
| JWT 解析器 | 未过期状态提示 | `core/web/jwt.test.ts` :: exp 晚于当前时间：判定有效并给出剩余时间；`tools/web/jwt-parser/Tool.test.tsx` :: exp 未到时提示仍在有效期并给出剩余时间 |
| JWT 解析器 | 无 exp 声明 | `core/web/jwt.test.ts` :: 不含 exp 时状态为 absent，时长为空；`tools/web/jwt-parser/Tool.test.tsx` :: 不含 exp 时提示未声明过期时间 |
| JWT 解析器 | 常见头部信息摘要 | `core/web/jwt.test.ts` :: 头部摘要给出 alg 与 typ ＋ :: 头部缺少 alg / typ 时摘要为 null 而不是报错；`tools/web/jwt-parser/Tool.test.tsx` :: 概览区展示算法与类型 |
| JWT 解析器 | 不校验签名的显式说明 | `tools/web/jwt-parser/Tool.test.tsx` :: 显式说明签名未被校验 |
| JWT 解析器 | 段数不合法 | `core/web/jwt.test.ts` :: 两段被拒绝并指出实际段数 ＋ :: 四段被拒绝；`tools/web/jwt-parser/Tool.test.tsx` :: 段数不合法时指出实际段数 |
| JWT 解析器 | 载荷非法 JSON | `core/web/jwt.test.ts` :: 载荷不是合法 JSON 时报错，但仍给出头部；`tools/web/jwt-parser/Tool.test.tsx` :: 载荷非法 JSON 时提示载荷失败但仍展示头部 |
| URL 分析器 | 完整 URL 拆解 | `core/web/url-analyzer.test.ts` :: 拆出协议 / 用户名 / 密码 / 主机名 / 端口 / 路径 / 片段；`tools/web/url-analyzer/Tool.test.tsx` :: 完整 URL 的各组成部分都被展示 |
| URL 分析器 | Origin 推导 | `core/web/url-analyzer.test.ts` :: Origin 含显式端口 ＋ :: 默认端口的 Origin 不含端口；`tools/web/url-analyzer/Tool.test.tsx` :: Origin 推导结果被展示 |
| URL 分析器 | 默认端口识别 | `core/web/url-analyzer.test.ts` :: 未写端口时补默认端口并标注 ＋ :: 显式写出默认端口时仍能识别为「用户写出的端口」＋ :: 非默认端口不算默认；`tools/web/url-analyzer/Tool.test.tsx` :: 未写端口时补默认端口并标注 |
| URL 分析器 | 路径分段 | `core/web/url-analyzer.test.ts` :: 路径拆成逐段展示 ＋ :: 路径为根时没有分段 ＋ :: 路径末尾的斜杠不产生空分段；`tools/web/url-analyzer/Tool.test.tsx` :: 路径分段逐项展示 |
| URL 分析器 | 查询参数以表格呈现 | `core/web/url-analyzer.test.ts` :: 同名查询参数的两个取值都保留且顺序不变；`tools/web/url-analyzer/Tool.test.tsx` :: 同名查询参数逐行展示且顺序保持 ＋ :: 无查询参数时不渲染参数表 |
| URL 分析器 | 相对 URL 或无协议输入 | `core/web/url-analyzer.test.ts` :: 无协议输入提示不是绝对 URL 并给出 https 补全建议 ＋ :: 相对路径同样提示不是绝对 URL；`tools/web/url-analyzer/Tool.test.tsx` :: 无协议输入提示不是绝对 URL 并给出补全建议 ＋ :: 点击补全建议后按补全的 URL 重新分析 |
| URL 分析器 | 非法 URL | `core/web/url-analyzer.test.ts` :: 补全后仍无法解析的输入按非法 URL 处理 ＋ :: 有协议但语法非法时按非法 URL 处理 ＋ :: 只有协议没有主机时按非法 URL 处理；`tools/web/url-analyzer/Tool.test.tsx` :: 非法 URL 提示解析失败且不展示分段结果 |
| URL 分析器 | 编码字符解码 | `core/web/url-analyzer.test.ts` :: 查询参数的键与值都给出两种形式 ＋ :: 路径中的百分号编码同时给出原始与解码形式 ＋ :: 片段也被解码；`tools/web/url-analyzer/Tool.test.tsx` :: 编码字符并列展示原始与解码形式 |
| 二维码生成器 | 默认参数生成 | `core/image/qrcode.test.ts` :: 默认纠错等级为 M，尺寸与版本自洽 ＋ :: 默认渲染选项为黑前景、白背景、模组 4、静默区 4；`tools/image/qrcode-generator/Tool.test.tsx` :: 默认参数下渲染出 SVG 预览与概要状态 |
| 二维码生成器 | 实时预览 | `tools/image/qrcode-generator/Tool.test.tsx` :: 实时预览：改输入即改输出，无需点击任何按钮 |
| 二维码生成器 | 空输入 | `core/image/qrcode.test.ts` :: 空串返回 EMPTY_INPUT ＋ :: 单个空格是合法内容（空态判定属界面职责）；`tools/image/qrcode-generator/Tool.test.tsx` :: 空输入（含纯空白）不生成预览 |
| 二维码生成器 | 自定义前景色与背景色 | `core/image/qrcode.test.ts` :: 自定义前景色与背景色如实进入 SVG ＋ :: 大写颜色被归一化为小写；`tools/image/qrcode-generator/Tool.test.tsx` :: 自定义前景色与背景色进入预览 |
| 二维码生成器 | 颜色对比度不足的警告 | `core/image/qrcode.test.ts` :: 近似同色判为对比度不足 ＋ :: spec 举的配色（深蓝 / 米白）在阈值之上 ＋ :: 阈值上方不告警；`tools/image/qrcode-generator/Tool.test.tsx` :: 对比度不足时给出警告，但仍按当前配色生成 ＋ :: 对比度充足时不出现警告 |
| 二维码生成器 | 调整二维码复杂度 | `core/image/qrcode.test.ts` :: 可指定纠错等级 ＋ :: 纠错等级提高不会减少模组数，且 H 严格多于 L ＋ :: 模块尺寸只改分辨率，不改编码内容；`tools/image/qrcode-generator/Tool.test.tsx` :: 提高纠错等级使模组数增加（编码内容不变）＋ :: 模块尺寸只改输出分辨率，不改版本与模组数 |
| 二维码生成器 | 长文本容量 | `core/image/qrcode.test.ts` :: 恰好达到上限时成功且为 version 40，超出 1 字节即报容量错误 ＋ :: 容量错误会给出容量更大的等级建议；`tools/image/qrcode-generator/Tool.test.tsx` :: 超出容量时提示内容过长并给出当前等级的上限 ＋ :: 换成容量更大的等级后同一内容可以生成 |
| 二维码生成器 | 中文内容 | `core/image/qrcode.test.ts` :: 中文按 3 字节计：H 等级 424 个汉字可生成，425 个超出 ＋ :: emoji 与中文混排也能逐字还原（测试内解码器真解回）；`tools/image/qrcode-generator/Tool.test.tsx` :: 中文内容正常生成 |
| 二维码生成器 | 导出 PNG | `tools/image/qrcode-generator/canvas.test.ts` :: 成功时返回 PNG blob（另有 4 条降级路径：无 2D 上下文 / toBlob 缺失 / 回调 null / toBlob 抛错）；`tools/image/qrcode-generator/Tool.test.tsx` :: jsdom 没有 2D 上下文时导出 PNG 给出明确提示而不是静默失败 —— ⚠️ 真实落盘留 9.3 冒烟 |
| 二维码生成器 | 导出 SVG | `core/image/qrcode.test.ts` :: 具备矢量与尺寸契约 ＋ :: 背景矩形覆盖整个画布（含静默区）；`tools/image/qrcode-generator/Tool.test.tsx` :: 导出 SVG 交出与预览同源的矢量内容 |
| 二维码生成器 | 复制图片 | `tools/image/qrcode-generator/canvas.test.ts` :: 成功时返回 PNG blob；`tools/image/qrcode-generator/Tool.test.tsx` :: 复制图片在无剪贴板能力时报出原因并指向 PNG 下载 —— ⚠️ 真实剪贴板写入留 9.6 跨 WebView |
| JSON 压缩 | 压缩格式化的 JSON | `core/json/minify.test.ts` :: 移除换行与缩进 ＋ :: 统计 UTF-8 字节数而非 UTF-16 码元数；`tools/dev/json-minify/Tool.test.tsx` :: 多行 JSON 压成一行且内容与键序不变 |
| JSON 压缩 | 语义等价 | `core/json/roundtrip.test.ts` :: 压缩后的输出同样语义等价 ＋ :: 美化后的输出仍可被解析，且与原文语义等价 |
| JSON 压缩 | 保留字符串内空白 | `core/json/minify.test.ts` :: 保留字符串内部的空白；`tools/dev/json-minify/Tool.test.tsx` :: 字符串内的空白被保留 |
| JSON 压缩 | 保留特殊字符转义 | `core/json/minify.test.ts` :: 保留 `\\n` `\\t` `\\\\` 等转义写法 |
| JSON 压缩 | 转义字面量不被规范化 | `core/json/minify.test.ts` :: 规范：`\\u0041` 不被改写为 A（逐字节保真的关键）＋ :: 规范：`\\/` 不被改写为 /；`tools/dev/json-minify/Tool.test.tsx` :: 字符串内的转义字面量不被规范化 |
| JSON 压缩 | 压缩与美化逐字节往返 | `core/json/roundtrip.test.ts` :: minify(format(x)) 与 minify(x) 逐字节相同（三种缩进）＋ :: 再往返一次结果不再变化（幂等）＋ :: 大输入上「美化 → 压缩」逐字节回到原样，且体积收回 |
| JSON 压缩 | 展示体积变化 | `tools/dev/json-minify/Tool.test.tsx` :: 状态栏展示前后字节数与节省比例 ＋ :: 已经紧凑的输入显示 0.0% |
| JSON 压缩 | 非法 JSON | `core/json/minify.test.ts` :: 非法输入透传错误定位；`tools/dev/json-minify/Tool.test.tsx` :: 非法 JSON 给出错误位置且不给输出 |
| JSON 压缩 | 空输入 | `tools/dev/json-minify/Tool.test.tsx` :: 空输入与纯空白都只显示空态，不报错；`tools/dev/json-format/Tool.test.tsx` :: 空输入不报错也不给输出 |
| JSON 美化 | 默认缩进美化 | `core/json/format.test.ts` :: 默认两空格缩进；`tools/dev/json-format/Tool.test.tsx` :: 默认按 2 空格缩进 |
| JSON 美化 | 缩进选项 | `core/json/format.test.ts` :: 四空格缩进 ＋ :: 制表符缩进；`tools/dev/json-format/Tool.test.tsx` :: 可切到 4 空格 ＋ :: 可切到制表符 |
| JSON 美化 | 键排序 | `core/json/format.test.ts` :: 对象键按字典序排列，数组顺序不变 ＋ :: 递归排序嵌套对象；`tools/dev/json-format/Tool.test.tsx` :: 开启后键按字典序排列，数组保持原序 |
| JSON 美化 | 关闭键排序保持原序 | `tools/dev/json-format/Tool.test.tsx` :: 不开启时保持原键序 |
| JSON 美化 | 默认模式保留转义字面量 | `core/json/format.test.ts` :: 默认模式下不改写转义字面量；`tools/dev/json-format/Tool.test.tsx` :: 默认模式保留转义字面量 |
| JSON 美化 | 键排序模式的行为提示 | `tools/dev/json-format/Tool.test.tsx` :: 开启键排序后同一输入被规范化为字符本身，并给出行为提示 ＋ :: 行为提示如实覆盖转义之外的改写面（大整数、超范围指数、重复键）＋ :: 排序路径确实会改写大整数精度（提示不是空话） |
| JSON 美化 | 非法 JSON 定位 | `tools/dev/json-format/Tool.test.tsx` :: 非法 JSON 给出行号列号与偏移；`core/json/scanner.test.ts` :: 错误同时给出 1 基的行号与列号 |
| JSON 美化 | 大体积输入 | `core/json/roundtrip.test.ts` :: 样本本身确实超过 1MB ＋ :: 压缩能算完，且不会让体积变大 ＋ :: 美化能算完，且体积变大并保留结构；`tools/dev/json-format/Tool.test.tsx` :: 先显示处理中，再给出结果 ＋ :: 大输入下切到类型提示视图仍可用，且同样是截断预览 |
| JSON 美化 | 与压缩互为逆操作 | `core/json/roundtrip.test.ts` :: 键排序路径是有损的，且只在开启时才有损 ＋ :: 默认路径保留转义字面量（这正是逐字节往返能成立的原因）—— **本 Scenario 原文漏「未开启键排序」限定词（R60），已在本轮补上** |
| （`dev-tools:54` Requirement 正文，无 Scenario） | 展示每个值的数据类型提示 | `core/json/type-hints.test.ts`（18 条：七种取值 / 标签 / 路径形式 / 前序输出 / 深度上限等）；`tools/dev/json-format/Tool.test.tsx` :: 逐值给出路径、类型与概要 ＋ :: 类型提示不会污染 JSON 输出，切回去仍是纯 JSON ＋ :: 下载的永远是纯 JSON，提示视图里不提供下载 |

**本次审计发现并当场回补 1 处真缺口**：`converter-tools`「解码为文件」的 THEN 是「系统提供下载，**下载内容为解码后的原始字节**」，而原用例只断言「下载文件按钮存在」⇒ 属交付面零覆盖（与 5.11 评审的 I-3 同类）。已在 `tools/converter/base64/Tool.test.tsx` 补：`下载文件交出解码后的原始字节（含非 UTF-8 的二进制）`（mock `@/framework/file` 的 `downloadBytes`，断言文件名 `decoded.bin` 与逐字节 `[0xff]`）。该文件 7 → **8 条**全绿。

### Task G3（9.5）执行记录

用**含全部 17 个工具**的产物重新打包（`npm run tauri:build`，release + LTO，全程离线）：

| 项 | 实测 |
|---|---|
| `IT Toolbox_0.1.0_aarch64.dmg` | **2,360,991 字节（2.36MB）** |
| release 可执行文件 | 3,916,256 字节（3.9MB） |
| 结论 | **远低于 15MB 硬约束**，不触发裁剪路径；对照计划① 单工具产物 2,255,842 字节 ⇒ 16 个新工具净增约 105KB |

### Task G4（9.7 / 9.11）执行记录

- README 开头进度段已改写：删掉「只交付 1 个工具 / 其余 16 个尚未实现」（该句与现在的产物直接矛盾），改为 17 个工具清单 + macOS arm64 实测体积 + 「其余平台需在对应平台构建」。
- 9.11 两项（Windows 前置条件与缺失时的自备途径、全离线变体的构建方式与约 140MB 体积代价）计划① 已在文中 ⇒ 本次核对通过，未重复添加。
- 第 3 层描述「扫描产物中的网络 API 调用，发现即失败」与实现一致（即 R58 的表述方向）。

### Task G6（9.9 + 收尾文档）执行记录

- **第 1 层（结构/CSP）**：生产 `csp` 为 `connect-src: ipc: http://ipc.localhost`（无任何远程来源）、`img-src: 'self' asset: http://asset.localhost data: blob:`、`font-src: 'self'`、`style-src: 'self' 'unsafe-inline'`、`script-src: 'self'`、`base-uri/form-action/frame-src/object-src` 全 `'none'`。
  ⚠️ **读法提醒**：`strings` 二进制的碎片里还能看到 `ws://localhost:1420` 与 `'unsafe-eval'` —— 那是同一份配置文件里的 **`devCsp`**（仅开发期生效），不是生产策略；勿据此判为缺陷。
- **第 2 层**：`framework/offline-guard.test.ts`（6 条，含 fetch / XHR / WebSocket 三路）。
- **第 3 层**：`npm run build` → `[scan-egress] 网络 API 调用 0 处；远程 URL 字面量 7 处` → `通过：产物中未发现外发能力。`
- **第 4 层**：`markdown-to-html` 的「远程图片渲染为占位块，不产出 img 元素」「外部链接不产出 a 元素，只读展示地址」。
- **R58 闭合**：`app-shell/spec.md:89` 与 Scenario「构建产物扫描」改为「致命 = 网络 API 调用（fetch / XHR / WebSocket）；远程 URL 字面量只告警」，与实现、README 三处一致。
- **R60 闭合**：`dev-tools/spec.md:96-99` 补「（**未开启键排序**）」限定词。
- **TS 版本**：`plans/2026-09-15-it-toolbox-foundation.md` 两处 `TypeScript 7.0 / TypeScript 7` → `6.0.3 / 6`（与 `package.json` 的 `typescript@^6.0.3` 一致）。
- 三处文档改完重跑 `npx openspec validate it-toolbox-app` → 仍 `valid`。

### Task G7（勾选与移交）执行记录

- **勾选**：9.1 / 9.2 / 9.5 / 9.7 / 9.8 / 9.9。
- **保留未勾（需真机/人工）**：9.3 断网冒烟、9.4 四平台构建（本次仅实测 macOS arm64）、9.6 跨 WebView、9.10 Windows 前置条件 —— 已做的替代证据见本记录与账本 R101／计划① T20 的「需人工确认项」。
- 账本追加收尾条目；提交沿用 blob 精确定位手法。

