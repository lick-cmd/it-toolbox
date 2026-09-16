# Web 工具实现计划（OpenSpec change: it-toolbox-app）

> 计划②-3。承接计划②-1（foundation）与②-2（converter）。覆盖 `tasks.md` 第 7 组（7.1–7.9）。
>
> - base-ref: `51ad833cfef0f0a3eb6b6b72e789ff7bf60af262`
> - branch: `it-toolbox-app`
> - spec: `openspec/changes/it-toolbox-app/specs/web-tools/spec.md`（4 个 Requirement / **33 条 Scenario**）
> - 前置已就绪：`core/result.ts`、`core/json/scanner.ts`、`core/bytes.ts`、`framework/ToolLayout.tsx`、`framework/ui/*`、`useToolState`

## Global Constraints

1. **零外发**：`core/web/*` 只做字符串与 JSON 计算，不得出现网络 API 或远程 URL 字面量（`npm run build` 的 `scan-egress` 会拦）。
2. **Core 无 UI 依赖**：`core/` 不得 import React / Tauri / `framework/`（ESLint `no-restricted-imports` 强制）。
3. **跨 WebView 一致性**：所有 JSON 解析必须走 `core/json/scanner.ts`（`JSON.parse` 的报错文案在 V8 与 JavaScriptCore 上不一致，WKWebView 甚至不给位置）。
4. **解析类操作用 `Result<T>`**：非法输入是常规路径，不抛异常。生成类才直接返回终值。
5. **定位一律 1 基**：`ErrorInfo.line` / `column` 上报给 UI 前必须是 1 基；`offset` 保持 0 基。
6. **工具目录结构**：`src/tools/web/<id>/{meta.ts,Tool.tsx}`，目录名必须与 `meta.id` 一致，`keywords` 非空，否则 `registry.test.ts` 的「不存在任何注册问题」会失败。
7. **参数候选表定义在组件外部**：`INITIAL_STATE` 参与 `useToolState` 的惰性初始化，组件内每次渲染新建会让依赖持续失效。
8. **`useMemo` 依赖只用原始值**：对象/数组依赖会造成无限渲染循环。
9. **测试输入用 `fireEvent.change`**：`userEvent.type` 把 `{` `[` 当特殊键语法，JSON / URL 样本里必然出现这两个字符。

## 任务间接口约定（先定死，避免实现期返工）

| 消费者 | 依赖符号 | 来源 |
|---|---|---|
| `core/web/json-diff.ts`、`core/web/jwt.ts` | `parseJsonValue` | 新建 `core/json/parse.ts`（Task 1） |
| 工具 7.7 / 7.8 | `DiffEntry`、`DiffKind`、`compareJson`、`failedSide`、`DIFF_KIND_LABEL`、`JSON_TYPE_LABEL` | `core/web/json-diff.ts` |
| 工具 7.8 | `JwtDecoded`、`JwtPart`、`decodeJwt` | `core/web/jwt.ts` |
| 工具 7.6 | `encodeUrl`、`decodeUrl`、`URL_CODEC_MODES`、`URL_DIRECTIONS` | `core/web/url-codec.ts` |
| 工具 7.9 | `analyzeUrl`、`UrlAnalysis`、`AnalyzedText` | `core/web/url-analyzer.ts` |
| 全部 4 个工具 | `ToolLayout`（`input`/`output` 或 `body` 形态）、`ui/*`、`useToolState` | 既有框架 |

---

### Task 1: `core/json/parse.ts` 严格解析入口（8.9 的缺失交付物）

`tasks.md` 8.9 已勾选，但 `src/core/json/parse.ts` **在仓库中不存在**（`core/json/` 只有 `scanner.ts` / `minify.ts` / `format.ts` 及其测试）。本计划的两个 web 模块（json-diff 取值、jwt 载荷）都需要「带定位的严格解析」，且 8.9 的原文明确把 json-diff 与 jwt 载荷列为使用点，故在此补齐该文件。

**Files:**
- Create: `src/core/json/parse.ts`
- Test: `src/core/json/parse.test.ts`

**Interfaces:**
- Consumes: `scanJson` / `JsonToken` from `./scanner`；`Result` / `ok` / `err` from `../result`
- Produces: `parseJson(text): Result<ParsedJson>`、`parseJsonValue(text): Result<unknown>`
- 不改动 `scanner.ts` / `minify.ts` / `format.ts`，避免与并发的第 8 组工作冲突

- [ ] **Step 1: 写失败测试**

创建 `src/core/json/parse.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { parseJson, parseJsonValue } from './parse'

describe('parseJson', () => {
  it('解析成功时同时给出值与原样 token', () => {
    const result = parseJson('{"a":[1,true,null],"b":"x"}')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.value).toEqual({ a: [1, true, null], b: 'x' })
    expect(result.value.tokens.length).toBeGreaterThan(0)
    // token 的 raw 是原文切片，不做规范化
    expect(result.value.tokens.some((token) => token.raw === '"a"')).toBe(true)
  })

  it('保留大整数之外的原始数字字面量不做改动', () => {
    const result = parseJson('{"n":1.50e2}')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.tokens.some((token) => token.raw === '1.50e2')).toBe(true)
    expect(result.value.value).toEqual({ n: 150 })
  })

  it('把 scanner 的定位信息原样透传（1 基行号列号 + 0 基偏移）', () => {
    const result = parseJson('{\n  "a": 1\n')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('UNCLOSED')
    expect(result.line).toBe(3)
    expect(result.column).toBe(1)
    expect(result.offset).toBe(11)
  })

  it('空输入返回 UNEXPECTED_EOF', () => {
    const result = parseJson('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('UNEXPECTED_EOF')
  })

  it('尾随内容被拒绝', () => {
    const result = parseJson('{} {}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('TRAILING_CONTENT')
  })
})

describe('parseJsonValue', () => {
  it('只返回值的形态与 parseJson 的值一致', () => {
    const value = parseJsonValue('[1,2,3]')
    expect(value.ok).toBe(true)
    if (value.ok) expect(value.value).toEqual([1, 2, 3])
  })

  it('失败时错误信息与 parseJson 一致', () => {
    const value = parseJsonValue('{')
    expect(value.ok).toBe(false)
    if (!value.ok) {
      expect(value.code).toBe('UNCLOSED')
      expect(value.line).toBe(1)
    }
  })

  it('顶层标量（JSON 允许）可解析', () => {
    const value = parseJsonValue('"just a string"')
    expect(value.ok).toBe(true)
    if (value.ok) expect(value.value).toBe('just a string')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project core src/core/json/parse.test.ts > /tmp/p3-t1.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t1.log`

Expected: FAIL，报 `Failed to resolve import "./parse"`。

- [ ] **Step 3: 写实现**

创建 `src/core/json/parse.ts`：

```ts
import { err, ok } from '../result'
import type { Result } from '../result'
import { scanJson } from './scanner'
import type { JsonToken } from './scanner'

export interface ParsedJson {
  value: unknown
  /** 原样 token 序列，供 minify / format 这类需要保留字面量的消费者使用 */
  tokens: readonly JsonToken[]
}

/**
 * 严格 JSON 解析入口。
 *
 * 两步走：先用 `scanJson` 做逐 token 的 RFC 8259 校验（错误自带行号 / 列号 / 偏移），
 * 再用 `JSON.parse` 取回真实值。之所以还要 `JSON.parse`：从 token 重建值等于
 * 重写一遍解析器，而 `scanJson` 已保证文本合法，此处只剩它自身的实现限制要兜。
 *
 * 那个限制是真实存在的：`JSON.parse` 在 V8 里是迭代实现（实测 50 万层嵌套仍能
 * 解析），但在 JavaScriptCore 里是递归实现，超深嵌套会抛 `RangeError`。
 * 本应用的 macOS 运行时正是 WKWebView（JSC），因此这一层 try/catch 不可省。
 * 该分支在 Node 环境无法构造出来，故没有对应用例 —— 这是有意的例外，不是遗漏。
 */
export function parseJson(text: string): Result<ParsedJson> {
  const scanned = scanJson(text)
  if (!scanned.ok) {
    return err(scanned.error, {
      code: scanned.code,
      detail: scanned.detail,
      offset: scanned.offset,
      line: scanned.line,
      column: scanned.column,
      suggestion: scanned.suggestion,
    })
  }

  try {
    return ok({ value: JSON.parse(text) as unknown, tokens: scanned.tokens })
  } catch (cause) {
    return err('JSON 嵌套层级过深，无法解析', {
      code: 'TOO_DEEP',
      detail: cause instanceof Error ? cause.message : String(cause),
      suggestion: '请减少嵌套层数后重试',
    })
  }
}

/** 只要值、不要 token 的便捷入口。 */
export function parseJsonValue(text: string): Result<unknown> {
  const parsed = parseJson(text)
  // 注意取 parsed.value.value：parsed.value 是整个 ParsedJson（含 tokens），
  // 少一层解构会把 { value, tokens } 当成解析结果传出去
  return parsed.ok ? ok(parsed.value.value) : parsed
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project core src/core/json/parse.test.ts > /tmp/p3-t1.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t1.log`

Expected: PASS，8 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/core/json/parse.ts src/core/json/parse.test.ts
git commit -m "feat(core): 补齐 core/json/parse.ts 严格解析入口（tasks 8.9 的缺失交付物）"
```

---

### Task 2: `core/web/url-codec.ts`（7.1）

对应 spec `URL 编码与解码`（7 条 Scenario）。

**Files:**
- Create: `src/core/web/url-codec.ts`
- Test: `src/core/web/url-codec.test.ts`

**Interfaces:**
- Produces: `encodeUrl(text, mode): Result<string>`、`decodeUrl(text, mode): Result<string>`、`URL_CODEC_MODES`、`URL_DIRECTIONS`、`UrlCodecMode`、`UrlDirection`

- [ ] **Step 1: 写失败测试**

创建 `src/core/web/url-codec.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { decodeUrl, encodeUrl, URL_CODEC_MODES, URL_DIRECTIONS } from './url-codec'

/** 断言成功并取值；失败时把错误原样抛出，便于定位 */
function mustEncode(text: string, mode: Parameters<typeof encodeUrl>[1]): string {
  const result = encodeUrl(text, mode)
  if (!result.ok) throw new Error(`期望编码成功，实际失败：${result.error}`)
  return result.value
}

function mustDecode(text: string, mode: Parameters<typeof decodeUrl>[1]): string {
  const result = decodeUrl(text, mode)
  if (!result.ok) throw new Error(`期望解码成功，实际失败：${result.error}`)
  return result.value
}

describe('encodeUrl', () => {
  it('组件模式等价于 encodeURIComponent', () => {
    expect(mustEncode('a b&c=d', 'component')).toBe('a%20b%26c%3Dd')
  })

  it('整体 URI 模式保留 :/?&= 等结构字符，只编码空格等非法字符', () => {
    const encoded = mustEncode('https://a.com/b c?d=e&f=g', 'uri')
    expect(encoded).toBe('https://a.com/b%20c?d=e&f=g')
    expect(encoded).toContain('://')
    expect(encoded).toContain('?d=e&f=g')
  })

  it('表单模式把空格编码为 +', () => {
    expect(mustEncode('a b', 'form')).toBe('a+b')
    expect(mustEncode('a b', 'form')).not.toContain('%20')
  })

  it('落单代理项返回 BAD_SURROGATE 而不是抛异常', () => {
    const result = encodeUrl('\uD800', 'component')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_SURROGATE')
      expect(result.suggestion).toBeTruthy()
    }
  })

  it('空输入原样返回空串', () => {
    expect(mustEncode('', 'component')).toBe('')
  })
})

describe('decodeUrl', () => {
  it('组件模式解码', () => {
    expect(mustDecode('a%20b%26c%3Dd', 'component')).toBe('a b&c=d')
  })

  it('表单模式把 + 还原为空格', () => {
    expect(mustDecode('a+b', 'form')).toBe('a b')
  })

  it('整体 URI 模式保留结构字符不被解码', () => {
    expect(mustDecode('https://a.com/b%20c?d=e&f=g', 'uri')).toBe('https://a.com/b c?d=e&f=g')
  })

  it('中文与 emoji 往返一致', () => {
    const source = '你好，世界 —— 🚀 emoji'
    for (const mode of ['component', 'uri', 'form'] as const) {
      expect(mustDecode(mustEncode(source, mode), mode)).toBe(source)
    }
  })

  it('以 % 结尾的不完整转义序列被拒绝并定位', () => {
    const result = decodeUrl('abc%', 'component')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_ESCAPE')
      expect(result.offset).toBe(3)
      expect(result.detail).toContain('%')
    }
  })

  it('包含 %ZZ 的内容被拒绝', () => {
    const result = decodeUrl('%ZZ', 'component')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_ESCAPE')
      expect(result.offset).toBe(0)
    }
  })

  it('转义合法但解码后不是合法 UTF-8 时同样被拒绝', () => {
    const result = decodeUrl('%E4%BD', 'component')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_ESCAPE')
      expect(result.error).toContain('非法')
    }
  })

  it('表单模式下 `+` 先还原为空格再判断转义', () => {
    expect(mustDecode('a+b%20c', 'form')).toBe('a b c')
  })
})

describe('选项常量', () => {
  it('提供三种编码模式与两个方向', () => {
    expect(URL_CODEC_MODES.map((item) => item.value)).toEqual(['component', 'uri', 'form'])
    expect(URL_DIRECTIONS.map((item) => item.value)).toEqual(['encode', 'decode'])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project core src/core/web/url-codec.test.ts > /tmp/p3-t2.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t2.log`

Expected: FAIL，报 `Failed to resolve import "./url-codec"`。

- [ ] **Step 3: 写实现**

创建 `src/core/web/url-codec.ts`：

```ts
import { err, ok } from '../result'
import type { Result } from '../result'

/** 组件（encodeURIComponent）/ 整体 URI（encodeURI）/ 表单（空格记为 +） */
export type UrlCodecMode = 'component' | 'uri' | 'form'
export type UrlDirection = 'encode' | 'decode'

export interface UrlCodecModeOption {
  value: UrlCodecMode
  label: string
}

export const URL_CODEC_MODES: readonly UrlCodecModeOption[] = [
  { value: 'component', label: '组件' },
  { value: 'uri', label: '整体 URI' },
  { value: 'form', label: '表单' },
]

export const URL_DIRECTIONS: readonly { value: UrlDirection; label: string }[] = [
  { value: 'encode', label: '编码' },
  { value: 'decode', label: '解码' },
]

const HEX_PAIR = /^[0-9a-fA-F]{2}$/

/**
 * 扫描第一个非法的百分号转义。
 *
 * 自己扫而不是只靠 `decodeURIComponent` 抛错，是因为异常里没有位置信息，
 * 而 spec 要求提示「存在非法的转义序列」并尽量定位。
 */
function findBadEscape(text: string): { offset: number; detail: string } | null {
  for (let i = 0; i < text.length; i++) {
    if (text.charAt(i) !== '%') continue
    const hex = text.slice(i + 1, i + 3)
    if (hex.length < 2) {
      return { offset: i, detail: `输入以不完整的转义序列 "%${hex}" 结尾` }
    }
    if (!HEX_PAIR.test(hex)) {
      return { offset: i, detail: `"%${hex}" 不是合法的百分号转义（应为 % 加两位十六进制）` }
    }
    i += 2
  }
  return null
}

function encodeFailure(): Result<never> {
  return err('文本包含无法编码的字符', {
    code: 'BAD_SURROGATE',
    detail: '存在落单的代理项（不完整的 emoji 或增补字符），URI 编码无法处理',
    suggestion: '请检查输入中是否有被截断的 emoji 或特殊字符',
  })
}

/**
 * URI 编码。
 *
 * `encodeURI` 对 `:/?&=#` 等保留字符不编码 —— 这正是「整体 URI」模式需要的语义；
 * 组件模式用 `encodeURIComponent`。表单模式在组件模式的基础上把 `%20` 换成 `+`。
 */
export function encodeUrl(text: string, mode: UrlCodecMode): Result<string> {
  const encode = mode === 'uri' ? encodeURI : encodeURIComponent
  let encoded: string
  try {
    encoded = encode(text)
  } catch {
    return encodeFailure()
  }
  return ok(mode === 'form' ? encoded.replaceAll('%20', '+') : encoded)
}

/**
 * URI 解码。
 *
 * 表单模式先做 `+` → 空格（与 `x-www-form-urlencoded` 的语义一致），再解百分号转义。
 * 整体 URI 模式用 `decodeURI`：保留字符即使被编码也维持不解码，避免把路径里的
 * `%2F` 还原成 `/` 而改变 URL 结构。
 */
export function decodeUrl(text: string, mode: UrlCodecMode): Result<string> {
  const normalized = mode === 'form' ? text.replaceAll('+', ' ') : text

  const bad = findBadEscape(normalized)
  if (bad) {
    return err('存在非法的转义序列', {
      code: 'BAD_ESCAPE',
      offset: bad.offset,
      detail: bad.detail,
      suggestion: '请检查 % 后是否紧跟两位十六进制数字',
    })
  }

  try {
    return ok(mode === 'uri' ? decodeURI(normalized) : decodeURIComponent(normalized))
  } catch {
    // 转义语法合法但仍可能解不出字符：例如 %E4%BD 是被截断的 UTF-8 序列
    return err('存在非法的转义序列', {
      code: 'BAD_ESCAPE',
      detail: '转义序列可被识别，但解码后不是合法的 UTF-8 字符',
      suggestion: '该内容可能来自其他字符集（如 GBK）的百分号编码',
    })
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project core src/core/web/url-codec.test.ts > /tmp/p3-t2.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t2.log`

Expected: PASS，12 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/core/web/url-codec.ts src/core/web/url-codec.test.ts
git commit -m "feat(web): URL 编解码 Core（tasks 7.1）"
```

---

### Task 3: `core/web/json-diff.ts`（7.2）

对应 spec `JSON 差异比较`（9 条 Scenario）。

**Files:**
- Create: `src/core/web/json-diff.ts`
- Test: `src/core/web/json-diff.test.ts`

**Interfaces:**
- Consumes: `parseJsonValue`（Task 1）
- Produces: `compareJson`、`diffValues`、`failedSide`、`typeOf`、`DiffEntry`、`DiffKind`、`JsonValueType`、`DiffFailureCode`、`DIFF_KIND_LABEL`、`JSON_TYPE_LABEL`

**两个已定的语义（spec 未写死，实现必须一致）**：
- **子树粒度**：某键在左侧有、右侧无时，只在**该键的路径**产出一条 `removed`，值取整个子树（而不是逐叶展开）。这与 spec 的「右侧比左侧多出 `{"b":3}` → 标记路径 `$.b` 为新增，值为 `3`」一致。
- **数组按索引对照**：不做 LCS 对齐。索引 i 两侧都存在则递归比较；仅左侧存在→`removed`；仅右侧存在→`added`。这样「元素修改」与「元素增删」自然区分开。

- [ ] **Step 1: 写失败测试**

创建 `src/core/web/json-diff.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { compareJson, failedSide, JSON_TYPE_LABEL, type DiffEntry } from './json-diff'

function diff(left: string, right: string): DiffEntry[] {
  const result = compareJson(left, right)
  if (!result.ok) throw new Error(`期望比较成功，实际失败：${result.error}`)
  return result.value
}

/** 按路径取唯一一条变更 */
function entryAt(entries: DiffEntry[], path: string): DiffEntry {
  const found = entries.find((entry) => entry.path === path)
  if (!found) throw new Error(`未找到路径 ${path}，实际路径为 ${entries.map((e) => e.path).join(', ')}`)
  return found
}

describe('compareJson —— 基本变更', () => {
  it('值修改：给出路径、新旧值与两侧类型', () => {
    const entries = diff('{"a":1}', '{"a":2}')
    expect(entries).toHaveLength(1)
    const entry = entryAt(entries, '$.a')
    expect(entry.kind).toBe('changed')
    expect(entry.left).toBe(1)
    expect(entry.right).toBe(2)
    expect(entry.leftType).toBe('number')
    expect(entry.rightType).toBe('number')
  })

  it('新增字段：kind 为 added，左侧类型为 absent', () => {
    const entries = diff('{"a":1}', '{"a":1,"b":3}')
    expect(entries).toHaveLength(1)
    const entry = entryAt(entries, '$.b')
    expect(entry.kind).toBe('added')
    expect(entry.right).toBe(3)
    expect(entry.rightType).toBe('number')
    expect(entry.leftType).toBe('absent')
  })

  it('删除字段：kind 为 removed，值取原值', () => {
    const entries = diff('{"a":1,"c":4}', '{"a":1}')
    expect(entries).toHaveLength(1)
    const entry = entryAt(entries, '$.c')
    expect(entry.kind).toBe('removed')
    expect(entry.left).toBe(4)
    expect(entry.leftType).toBe('number')
    expect(entry.rightType).toBe('absent')
  })

  it('删除整个子树时只产出一条，值取子树本身', () => {
    const entries = diff('{"a":1,"c":{"x":1,"y":2}}', '{"a":1}')
    expect(entries).toHaveLength(1)
    expect(entryAt(entries, '$.c').kind).toBe('removed')
    expect(entryAt(entries, '$.c').left).toEqual({ x: 1, y: 2 })
  })
})

describe('compareJson —— 数组', () => {
  it('按索引定位元素修改', () => {
    const entries = diff('{"list":[1,2,3]}', '{"list":[1,9,3]}')
    expect(entries).toHaveLength(1)
    const entry = entryAt(entries, '$.list[1]')
    expect(entry.kind).toBe('changed')
    expect(entry.left).toBe(2)
    expect(entry.right).toBe(9)
  })

  it('区分元素删除与元素新增', () => {
    const removed = diff('{"list":[1,2,3]}', '{"list":[1,2]}')
    expect(entryAt(removed, '$.list[2]').kind).toBe('removed')

    const added = diff('{"list":[1,2]}', '{"list":[1,2,3]}')
    expect(entryAt(added, '$.list[2]').kind).toBe('added')
    expect(entryAt(added, '$.list[2]').right).toBe(3)
  })

  it('顶层数组的元素路径为 $[i]', () => {
    const entries = diff('[1,2]', '[1,3]')
    expect(entryAt(entries, '$[1]').kind).toBe('changed')
  })
})

describe('compareJson —— 嵌套与类型', () => {
  it('深层差异的路径完整反映层级', () => {
    const entries = diff('{"a":{"b":{"c":1}}}', '{"a":{"b":{"c":2}}}')
    expect(entries).toHaveLength(1)
    expect(entryAt(entries, '$.a.b.c').kind).toBe('changed')
  })

  it('类型变化标记为修改并同时给出两侧类型', () => {
    const entries = diff('{"a":1}', '{"a":"1"}')
    const entry = entryAt(entries, '$.a')
    expect(entry.kind).toBe('changed')
    expect(entry.leftType).toBe('number')
    expect(entry.rightType).toBe('string')
    expect(JSON_TYPE_LABEL.number).toBe('数字')
    expect(JSON_TYPE_LABEL.string).toBe('字符串')
  })

  it('数组与对象互换视为修改而非深层展开', () => {
    const entries = diff('{"a":[1]}', '{"a":{"0":1}}')
    expect(entries).toHaveLength(1)
    const entry = entryAt(entries, '$.a')
    expect(entry.kind).toBe('changed')
    expect(entry.leftType).toBe('array')
    expect(entry.rightType).toBe('object')
  })

  it('含特殊字符的键用方括号加引号的形式表达', () => {
    const entries = diff('{"a.b":1}', '{"a.b":2}')
    expect(entryAt(entries, '$["a.b"]').kind).toBe('changed')
  })
})

describe('compareJson —— 无差异与非法输入', () => {
  it('仅键序或空白不同时判定为无差异', () => {
    expect(diff('{"a":1,"b":2}', '{"b":2,"a":1}')).toEqual([])
    expect(diff('{\n  "a": 1\n}', '{"a":1}')).toEqual([])
  })

  it('深层键序不同同样无差异', () => {
    expect(diff('{"o":{"x":1,"y":2}}', '{"o":{"y":2,"x":1}}')).toEqual([])
  })

  it('左侧非法时错误码为 LEFT_BAD_JSON，且带定位', () => {
    const result = compareJson('{', '{}')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('LEFT_BAD_JSON')
    expect(result.error).toContain('左侧')
    expect(result.line).toBe(1)
    expect(failedSide(result)).toBe('left')
  })

  it('右侧非法时错误码为 RIGHT_BAD_JSON', () => {
    const result = compareJson('{}', '{')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('RIGHT_BAD_JSON')
    expect(result.error).toContain('右侧')
    expect(failedSide(result)).toBe('right')
  })

  it('两侧都非法时先报告左侧', () => {
    const result = compareJson('{', '[')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('LEFT_BAD_JSON')
  })

  it('空输入按该侧解析失败处理', () => {
    const result = compareJson('   ', '{}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('LEFT_BAD_JSON')
  })

  it('交换两侧后新增与删除互换', () => {
    const forward = diff('{"a":1}', '{"a":1,"b":2}')
    expect(entryAt(forward, '$.b').kind).toBe('added')

    const backward = diff('{"a":1,"b":2}', '{"a":1}')
    expect(entryAt(backward, '$.b').kind).toBe('removed')
  })

  it('成功的比较不产生失败的 side', () => {
    expect(failedSide({ ok: true, value: [] })).toBeNull()
    expect(failedSide({ ok: false, error: 'x', code: 'OTHER' })).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project core src/core/web/json-diff.test.ts > /tmp/p3-t3.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t3.log`

Expected: FAIL，报 `Failed to resolve import "./json-diff"`。

- [ ] **Step 3: 写实现**

创建 `src/core/web/json-diff.ts`：

```ts
import { parseJsonValue } from '../json/parse'
import { err, ok } from '../result'
import type { Result } from '../result'

export type JsonValueType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  /** 该侧不存在此路径 */
  | 'absent'

export type DiffKind = 'added' | 'removed' | 'changed'

export type DiffFailureCode = 'LEFT_BAD_JSON' | 'RIGHT_BAD_JSON'

export interface DiffEntry {
  /** JSONPath 形式，如 $.a.b / $.list[1] / $["a.b"] */
  path: string
  kind: DiffKind
  /** 变更前的值；新增项为 undefined */
  left: unknown
  /** 变更后的值；删除项为 undefined */
  right: unknown
  leftType: JsonValueType
  rightType: JsonValueType
}

export const DIFF_KIND_LABEL: Record<DiffKind, string> = {
  added: '新增',
  removed: '删除',
  changed: '修改',
}

export const JSON_TYPE_LABEL: Record<JsonValueType, string> = {
  object: '对象',
  array: '数组',
  string: '字符串',
  number: '数字',
  boolean: '布尔',
  null: '空值',
  absent: '缺失',
}

/**
 * 递归深度上限。
 *
 * 不做 LCS 对齐也不做迭代化：spec 只要求按索引定位，递归实现最直白。
 * 但深嵌套输入在 JSC 上会栈溢出，故设上限，超出时把该子树整体记为「修改」，
 * 保证工具不会崩。
 */
const MAX_DEPTH = 256

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export function typeOf(value: unknown): JsonValueType {
  if (value === undefined) return 'absent'
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const type = typeof value
  if (type === 'object') return 'object'
  if (type === 'string') return 'string'
  if (type === 'number') return 'number'
  if (type === 'boolean') return 'boolean'
  return 'absent'
}

/** 合法标识符用 `.key`，其余用 `["key"]`（键里可能含点或引号） */
function childPath(base: string, key: string): string {
  return IDENTIFIER.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`
}

function indexPath(base: string, index: number): string {
  return `${base}[${index}]`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 递归比较两个已解析的 JSON 值，把变更追加到 `out`。
 *
 * 对象用「两侧键的并集」遍历：这样只在一侧出现的键被识别为新增 / 删除，
 * 而键的书写顺序完全不影响结果（spec 的「忽略键序差异」）。
 */
export function diffValues(
  left: unknown,
  right: unknown,
  path: string,
  out: DiffEntry[],
  depth = 0,
): void {
  if (depth > MAX_DEPTH) {
    out.push({
      path,
      kind: 'changed',
      left,
      right,
      leftType: typeOf(left),
      rightType: typeOf(right),
    })
    return
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) {
      const inLeft = Object.prototype.hasOwnProperty.call(left, key)
      const inRight = Object.prototype.hasOwnProperty.call(right, key)
      const child = childPath(path, key)

      if (inLeft && !inRight) {
        out.push({
          path: child,
          kind: 'removed',
          left: left[key],
          right: undefined,
          leftType: typeOf(left[key]),
          rightType: 'absent',
        })
      } else if (!inLeft && inRight) {
        out.push({
          path: child,
          kind: 'added',
          left: undefined,
          right: right[key],
          leftType: 'absent',
          rightType: typeOf(right[key]),
        })
      } else {
        diffValues(left[key], right[key], child, out, depth + 1)
      }
    }
    return
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const common = Math.min(left.length, right.length)
    for (let i = 0; i < common; i++) {
      diffValues(left[i], right[i], indexPath(path, i), out, depth + 1)
    }
    for (let i = common; i < left.length; i++) {
      out.push({
        path: indexPath(path, i),
        kind: 'removed',
        left: left[i],
        right: undefined,
        leftType: typeOf(left[i]),
        rightType: 'absent',
      })
    }
    for (let i = common; i < right.length; i++) {
      out.push({
        path: indexPath(path, i),
        kind: 'added',
        left: undefined,
        right: right[i],
        leftType: 'absent',
        rightType: typeOf(right[i]),
      })
    }
    return
  }

  // 两侧都不是「同类型的容器」：类型不同或标量不同都算修改
  if (!Object.is(left, right)) {
    out.push({
      path,
      kind: 'changed',
      left,
      right,
      leftType: typeOf(left),
      rightType: typeOf(right),
    })
  }
}

/**
 * 比较两段 JSON 文本。
 *
 * 失败时用 `code` 区分是哪一侧坏掉（`LEFT_BAD_JSON` / `RIGHT_BAD_JSON`），
 * 工具据此把 `ErrorNote` 与 `errorLine` 放到对应那一栏；`error` 文案里也带
 * 「左侧 / 右侧」字样，保证用户看得懂。
 */
export function compareJson(leftText: string, rightText: string): Result<DiffEntry[]> {
  const left = parseSide(leftText, 'LEFT_BAD_JSON', '左侧')
  if (!left.ok) return left

  const right = parseSide(rightText, 'RIGHT_BAD_JSON', '右侧')
  if (!right.ok) return right

  const entries: DiffEntry[] = []
  diffValues(left.value, right.value, '$', entries)
  return ok(entries)
}

function parseSide(text: string, code: DiffFailureCode, label: string): Result<unknown> {
  if (text.trim().length === 0) {
    return err(`${label} JSON 为空`, { code, detail: '请填入 JSON 内容' })
  }

  const parsed = parseJsonValue(text)
  if (parsed.ok) return ok(parsed.value)

  return err(`${label} JSON 解析失败：${parsed.error}`, {
    code,
    detail: parsed.detail,
    offset: parsed.offset,
    line: parsed.line,
    column: parsed.column,
    suggestion: parsed.suggestion,
  })
}

/** 由失败结果判别是哪一侧出错，供工具决定错误落在哪个面板。 */
export function failedSide(result: Result<unknown>): 'left' | 'right' | null {
  if (result.ok) return null
  if (result.code === 'LEFT_BAD_JSON') return 'left'
  if (result.code === 'RIGHT_BAD_JSON') return 'right'
  return null
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project core src/core/web/json-diff.test.ts > /tmp/p3-t3.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t3.log`

Expected: PASS，18 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/core/web/json-diff.ts src/core/web/json-diff.test.ts
git commit -m "feat(web): JSON 结构化 diff Core（tasks 7.2）"
```

---

### Task 4: `core/web/jwt.ts`（7.3）

对应 spec `JWT 解析器`（9 条 Scenario）。

**Files:**
- Create: `src/core/web/jwt.ts`
- Test: `src/core/web/jwt.test.ts`

**Interfaces:**
- Consumes: `base64ToBytes` / `bytesToUtf8` from `../bytes`；`parseJsonValue`（Task 1）
- Produces: `decodeJwt`、`JwtDecoded`、`JwtPart`、`JwtTimeClaim`、`JwtExpiry`

**关键设计**：只有「段数不是 3」是硬失败（`Result` 的失败分支）；头部 / 载荷各自的 Base64URL 或 JSON 问题记录在 `JwtPart.error` 里，因为 spec 明确要求「载荷解码失败时仍展示可解码的头部信息」。

- [ ] **Step 1: 写失败测试**

创建 `src/core/web/jwt.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { decodeJwt, type JwtDecoded } from './jwt'

const b64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

const b64urlText = (text: string): string => Buffer.from(text, 'utf8').toString('base64url')

/** exp = 1700000000（2023-11-14T22:13:20Z），相对 2026 年必然是过期状态 */
const EXPIRED_TOKEN = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
  sub: '1',
  exp: 1_700_000_000,
  iat: 1_690_000_000,
  nbf: 1_690_000_000,
})}.c2ln`

function mustDecode(token: string, now?: number): JwtDecoded {
  const result = now === undefined ? decodeJwt(token) : decodeJwt(token, now)
  if (!result.ok) throw new Error(`期望解析成功，实际失败：${result.error}`)
  return result.value
}

function payloadOf(token: string): Record<string, unknown> {
  return mustDecode(token).payload.value as Record<string, unknown>
}

describe('decodeJwt —— 三段拆解', () => {
  it('分别解出头部与载荷的 JSON，并保留签名片段', () => {
    const decoded = mustDecode(EXPIRED_TOKEN)
    expect(decoded.header.value).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(payloadOf(EXPIRED_TOKEN)['sub']).toBe('1')
    expect(decoded.signature).toBe('c2ln')
    expect(decoded.header.segment).toBe(EXPIRED_TOKEN.split('.')[0])
  })

  it('头部摘要给出 alg 与 typ', () => {
    const decoded = mustDecode(EXPIRED_TOKEN)
    expect(decoded.alg).toBe('HS256')
    expect(decoded.typ).toBe('JWT')
  })

  it('头部缺少 alg / typ 时摘要为空而不是报错', () => {
    const token = `${b64url({ kid: 'k1' })}.${b64url({ a: 1 })}.sig`
    const decoded = mustDecode(token)
    expect(decoded.alg).toBeNull()
    expect(decoded.typ).toBeNull()
  })

  it('容忍前后空白（从日志粘贴的常态）', () => {
    expect(mustDecode(`  ${EXPIRED_TOKEN}  `).signature).toBe('c2ln')
  })

  it('载荷解码后的文本同时保留，供解析失败时展示', () => {
    const decoded = mustDecode(EXPIRED_TOKEN)
    expect(decoded.payload.text).toContain('"sub"')
  })
})

describe('decodeJwt —— 段数不合法', () => {
  it('两段被拒绝并指出实际段数', () => {
    const result = decodeJwt('eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('BAD_SEGMENT_COUNT')
    expect(result.error).toContain('JWT 格式不合法')
    expect(result.detail).toContain('2 段')
  })

  it('四段被拒绝', () => {
    const result = decodeJwt('a.b.c.d')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_SEGMENT_COUNT')
      expect(result.detail).toContain('4 段')
    }
  })

  it('空输入返回 EMPTY_INPUT', () => {
    const result = decodeJwt('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('EMPTY_INPUT')
  })
})

describe('decodeJwt —— 载荷异常', () => {
  it('载荷不是合法 JSON 时报错，但仍给出头部', () => {
    const token = `${b64url({ alg: 'none' })}.${b64urlText('not json')}.sig`
    const decoded = mustDecode(token)
    expect(decoded.header.value).toEqual({ alg: 'none' })
    expect(decoded.payload.value).toBeNull()
    expect(decoded.payload.error?.error).toContain('载荷不是合法的 JSON')
    expect(decoded.payload.text).toBe('not json')
  })

  it('载荷不是合法 Base64URL 时报错且不产出文本', () => {
    const token = `${b64url({ alg: 'none' })}.!!!!.sig`
    const decoded = mustDecode(token)
    expect(decoded.payload.error?.code).toBe('BAD_BASE64')
    expect(decoded.payload.text).toBeNull()
  })

  it('载荷 Base64URL 合法但不是 UTF-8 时报错', () => {
    const token = `${b64url({ alg: 'none' })}.${Buffer.from([0xff, 0xfe]).toString('base64url')}.sig`
    const decoded = mustDecode(token)
    expect(decoded.payload.error?.code).toBe('BAD_UTF8')
  })

  it('载荷解析失败时时间声明与过期状态都为空', () => {
    const token = `${b64url({ alg: 'none' })}.${b64urlText('nope')}.sig`
    const decoded = mustDecode(token)
    expect(decoded.timeClaims).toEqual([])
    expect(decoded.expiry.status).toBe('absent')
  })
})

describe('decodeJwt —— 时间声明与过期状态', () => {
  it('exp / iat / nbf 都给出可读时间与中文含义', () => {
    const decoded = mustDecode(EXPIRED_TOKEN)
    expect(decoded.timeClaims.map((item) => item.claim)).toEqual(['exp', 'iat', 'nbf'])
    expect(decoded.timeClaims.map((item) => item.label)).toEqual(['过期时间', '签发时间', '生效时间'])
    const exp = decoded.timeClaims[0]!
    expect(exp.epochSeconds).toBe(1_700_000_000)
    expect(exp.readable).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    // 可读时间与秒级时间戳指向同一时刻（本地时区，故只比换算结果）
    expect(new Date(exp.readable.replace(' ', 'T')).getTime()).toBe(1_700_000_000_000)
  })

  it('仅声明部分时间字段时只输出声明了的那些', () => {
    const token = `${b64url({ alg: 'none' })}.${b64url({ exp: 1_700_000_000 })}.sig`
    expect(mustDecode(token).timeClaims.map((item) => item.claim)).toEqual(['exp'])
  })

  it('非数字的时间声明被忽略', () => {
    const token = `${b64url({ alg: 'none' })}.${b64url({ exp: '1700000000' })}.sig`
    expect(mustDecode(token).timeClaims).toEqual([])
    expect(mustDecode(token).expiry.status).toBe('absent')
  })

  it('exp 早于当前时间：判定过期并给出已过期时长', () => {
    const now = 1_700_000_000_000 + 2 * 86_400_000 + 3 * 3_600_000
    const decoded = mustDecode(EXPIRED_TOKEN, now)
    expect(decoded.expiry.status).toBe('expired')
    expect(decoded.expiry.expiresAt).toBe(1_700_000_000_000)
    expect(decoded.expiry.durationMs).toBe(2 * 86_400_000 + 3 * 3_600_000)
    expect(decoded.expiry.durationText).toBe('2 天 3 小时')
  })

  it('exp 晚于当前时间：判定有效并给出剩余时间', () => {
    const now = 1_700_000_000_000 - 90_000
    const decoded = mustDecode(EXPIRED_TOKEN, now)
    expect(decoded.expiry.status).toBe('valid')
    expect(decoded.expiry.durationMs).toBe(90_000)
    expect(decoded.expiry.durationText).toBe('1 分钟')
  })

  it('exp 恰好等于当前时间按已过期待', () => {
    expect(mustDecode(EXPIRED_TOKEN, 1_700_000_000_000).expiry.status).toBe('expired')
  })

  it('不含 exp 时状态为 absent，时长为空', () => {
    const token = `${b64url({ alg: 'none' })}.${b64url({ iat: 1_690_000_000 })}.sig`
    const decoded = mustDecode(token)
    expect(decoded.expiry.status).toBe('absent')
    expect(decoded.expiry.expiresAt).toBeNull()
    expect(decoded.expiry.durationText).toBe('')
  })

  it('秒级时长不足一分钟时以秒呈现', () => {
    const now = 1_700_000_000_000 - 45_000
    expect(mustDecode(EXPIRED_TOKEN, now).expiry.durationText).toBe('45 秒')
  })

  it('载荷不是对象时（数组 / 标量）不产生时间声明', () => {
    const token = `${b64url({ alg: 'none' })}.${b64url([1, 2, 3])}.sig`
    expect(mustDecode(token).timeClaims).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project core src/core/web/jwt.test.ts > /tmp/p3-t4.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t4.log`

Expected: FAIL，报 `Failed to resolve import "./jwt"`。

- [ ] **Step 3: 写实现**

创建 `src/core/web/jwt.ts`：

```ts
import { base64ToBytes, bytesToUtf8 } from '../bytes'
import { parseJsonValue } from '../json/parse'
import { err, ok } from '../result'
import type { ErrorInfo, Result } from '../result'

/**
 * JWT 的一个可解码片段。
 *
 * 三段里只有头部与载荷是 Base64URL 编码的 JSON；签名段只原样保留 —— 本工具
 * 不校验签名，也不尝试解码它（解码结果无意义且可能不是 UTF-8）。
 */
export interface JwtPart {
  /** 原始片段（Base64URL 文本） */
  segment: string
  /** 解码后的 UTF-8 文本；Base64URL 或 UTF-8 解码失败为 null */
  text: string | null
  /** JSON 解析结果；解析失败为 null */
  value: unknown | null
  /** 解码或解析失败的原因 */
  error?: ErrorInfo
}

export type JwtExpiryStatus = 'expired' | 'valid' | 'absent'

export interface JwtTimeClaim {
  claim: 'exp' | 'iat' | 'nbf'
  /** 中文含义，界面直接展示 */
  label: string
  epochSeconds: number
  /** 本地时间的可读形式 YYYY-MM-DD HH:mm:ss */
  readable: string
}

export interface JwtExpiry {
  status: JwtExpiryStatus
  /** exp 对应的绝对时刻（毫秒）；无 exp 为 null */
  expiresAt: number | null
  /** 已过期或剩余时长（毫秒）；status 为 absent 时为 0 */
  durationMs: number
  /** 时长的人类可读形式，如 "2 天 3 小时"；absent 时为空串 */
  durationText: string
}

export interface JwtDecoded {
  header: JwtPart
  payload: JwtPart
  /** 原始签名片段，不校验、不解码 */
  signature: string
  /** 头部 alg（非字符串时为 null） */
  alg: string | null
  /** 头部 typ（非字符串时为 null） */
  typ: string | null
  /** 按 spec 的枚举顺序 exp → iat → nbf */
  timeClaims: JwtTimeClaim[]
  expiry: JwtExpiry
}

const TIME_CLAIMS: readonly { claim: JwtTimeClaim['claim']; label: string }[] = [
  { claim: 'exp', label: '过期时间' },
  { claim: 'iat', label: '签发时间' },
  { claim: 'nbf', label: '生效时间' },
]

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatEpochSeconds(seconds: number): string {
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return '（超出可表示范围）'
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  )
}

/** 只保留最大两级单位，够读即可 */
function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days} 天`)
  if (hours > 0) parts.push(`${hours} 小时`)
  if (minutes > 0) parts.push(`${minutes} 分钟`)
  if (parts.length === 0) parts.push(`${totalSeconds % 60} 秒`)
  return parts.join(' ')
}

function decodePart(segment: string, label: string): JwtPart {
  const part: JwtPart = { segment, text: null, value: null }

  const bytes = base64ToBytes(segment)
  if (!bytes.ok) {
    part.error = {
      error: `${label}不是合法的 Base64URL`,
      code: 'BAD_BASE64',
      detail: bytes.error,
      offset: bytes.offset,
    }
    return part
  }

  const text = bytesToUtf8(bytes.value)
  if (!text.ok) {
    part.error = {
      error: `${label}解码后不是合法的 UTF-8 文本`,
      code: 'BAD_UTF8',
      detail: text.error,
    }
    return part
  }
  part.text = text.value

  const value = parseJsonValue(text.value)
  if (!value.ok) {
    // 保留 text：界面在解析失败时展示原始文本，比只报错有用
    part.error = {
      error: `${label}不是合法的 JSON`,
      code: 'BAD_JSON',
      detail: value.error,
      line: value.line,
      column: value.column,
      offset: value.offset,
    }
    return part
  }

  part.value = value.value
  return part
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function collectTimeClaims(payload: unknown): JwtTimeClaim[] {
  const record = asRecord(payload)
  if (!record) return []

  const claims: JwtTimeClaim[] = []
  for (const { claim, label } of TIME_CLAIMS) {
    const raw = record[claim]
    // 字符串形式的 "1700000000" 不是 JWT 规范的时间声明，忽略而不是猜测
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    claims.push({ claim, label, epochSeconds: raw, readable: formatEpochSeconds(raw) })
  }
  return claims
}

function computeExpiry(claims: JwtTimeClaim[], now: number): JwtExpiry {
  const exp = claims.find((item) => item.claim === 'exp')
  if (!exp) return { status: 'absent', expiresAt: null, durationMs: 0, durationText: '' }

  const expiresAt = exp.epochSeconds * 1000
  const diff = expiresAt - now
  const durationMs = Math.abs(diff)
  return {
    status: diff <= 0 ? 'expired' : 'valid',
    expiresAt,
    durationMs,
    durationText: formatDuration(durationMs),
  }
}

/**
 * 解析 JWT。
 *
 * 只有「不是三段」会让整体失败 —— 段数是结构性问题，此时没有任何可展示的内容。
 * 头部 / 载荷各自的问题记录在对应的 `JwtPart.error` 上，因为 spec 要求
 * 「载荷解码失败时仍展示可解码的头部信息」。
 *
 * `now` 可注入，使过期状态的用例不依赖真实时钟。
 */
export function decodeJwt(token: string, now: number = Date.now()): Result<JwtDecoded> {
  const trimmed = token.trim()
  if (trimmed.length === 0) {
    return err('请输入 JWT', { code: 'EMPTY_INPUT' })
  }

  const segments = trimmed.split('.')
  if (segments.length !== 3) {
    return err('JWT 格式不合法', {
      code: 'BAD_SEGMENT_COUNT',
      detail: `JWT 应由三段以 "." 分隔的内容组成，实际为 ${segments.length} 段`,
      suggestion: '标准形式形如 header.payload.signature',
    })
  }

  const [headerSegment = '', payloadSegment = '', signature = ''] = segments
  const header = decodePart(headerSegment, '头部')
  const payload = decodePart(payloadSegment, '载荷')

  const headerRecord = asRecord(header.value)
  const alg = typeof headerRecord?.['alg'] === 'string' ? (headerRecord['alg'] as string) : null
  const typ = typeof headerRecord?.['typ'] === 'string' ? (headerRecord['typ'] as string) : null

  const timeClaims = collectTimeClaims(payload.value)

  return ok({
    header,
    payload,
    signature,
    alg,
    typ,
    timeClaims,
    expiry: computeExpiry(timeClaims, now),
  })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project core src/core/web/jwt.test.ts > /tmp/p3-t4.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t4.log`

Expected: PASS，20 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/core/web/jwt.ts src/core/web/jwt.test.ts
git commit -m "feat(web): JWT 解析 Core（tasks 7.3）"
```

---

### Task 5: `core/web/url-analyzer.ts`（7.4）

对应 spec `URL 分析器`（8 条 Scenario）。

**Files:**
- Create: `src/core/web/url-analyzer.ts`
- Test: `src/core/web/url-analyzer.test.ts`

**Interfaces:**
- Produces: `analyzeUrl`、`UrlAnalysis`、`AnalyzedText`、`AnalyzedParam`、`DEFAULT_PORTS`、`NON_ABSOLUTE_PREFIX`

**两个已定的语义**：
- **`AnalyzedText` 的 `encoded` 表示「解码后与原始形式不同」**，工具据此决定是否并列展示两种形式（spec 的「同时展示原始编码形式与解码后的可读形式」）。
- **查询参数从 `url.search` 手工切分**，不用 `url.searchParams`：后者会把百分号转义与 `+` 立即解码，原始编码形式就丢了。

- [ ] **Step 1: 写失败测试**

创建 `src/core/web/url-analyzer.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { analyzeUrl, DEFAULT_PORTS, NON_ABSOLUTE_PREFIX, type UrlAnalysis } from './url-analyzer'

function analyze(input: string): UrlAnalysis {
  const result = analyzeUrl(input)
  if (!result.ok) throw new Error(`期望解析成功，实际失败：${result.error}`)
  return result.value
}

/** 取某个查询参数键的全部取值（原始形式） */
function valuesOf(analysis: UrlAnalysis, key: string): string[] {
  return analysis.params.filter((param) => param.key.decoded === key).map((param) => param.value.raw)
}

describe('analyzeUrl —— 完整拆解', () => {
  const FULL = 'https://user:pass@example.com:8443/a/b?x=1&x=2#sec'

  it('拆出协议 / 用户名 / 密码 / 主机名 / 端口 / 路径 / 片段', () => {
    const analysis = analyze(FULL)
    expect(analysis.protocol).toBe('https:')
    expect(analysis.username).toBe('user')
    expect(analysis.password).toBe('pass')
    expect(analysis.hostname).toBe('example.com')
    expect(analysis.explicitPort).toBe('8443')
    expect(analysis.port).toBe('8443')
    expect(analysis.pathname.raw).toBe('/a/b')
    expect(analysis.hash.raw).toBe('sec')
  })

  it('同名查询参数的两个取值都保留且顺序不变', () => {
    const analysis = analyze(FULL)
    expect(analysis.params).toHaveLength(2)
    expect(valuesOf(analysis, 'x')).toEqual(['1', '2'])
  })

  it('Origin 含显式端口', () => {
    expect(analyze(FULL).origin).toBe('https://example.com:8443')
  })

  it('问号后无参数、无片段时对应部分为空', () => {
    const analysis = analyze('https://example.com/')
    expect(analysis.params).toEqual([])
    expect(analysis.hash.raw).toBe('')
  })

  it('键没有等号时值按空串处理', () => {
    const analysis = analyze('https://example.com/?flag')
    expect(analysis.params).toHaveLength(1)
    expect(analysis.params[0]?.key.raw).toBe('flag')
    expect(analysis.params[0]?.value.raw).toBe('')
  })
})

describe('analyzeUrl —— Origin 与默认端口', () => {
  it('未写端口时补默认端口并标注', () => {
    const analysis = analyze('https://example.com/path')
    expect(analysis.explicitPort).toBeNull()
    expect(analysis.port).toBe('443')
    expect(analysis.isDefaultPort).toBe(true)
  })

  it('默认端口的 Origin 不含端口', () => {
    expect(analyze('https://example.com/path').origin).toBe('https://example.com')
  })

  it('显式写出默认端口时同样标注为默认端口', () => {
    const analysis = analyze('https://example.com:443/path')
    expect(analysis.explicitPort).toBe('443')
    expect(analysis.isDefaultPort).toBe(true)
  })

  it('非默认端口不算默认', () => {
    const analysis = analyze('http://example.com:8443/')
    expect(analysis.port).toBe('8443')
    expect(analysis.isDefaultPort).toBe(false)
    expect(DEFAULT_PORTS['http:']).toBe('80')
  })
})

describe('analyzeUrl —— 路径分段与编码字符', () => {
  it('路径拆成逐段展示', () => {
    const analysis = analyze('https://example.com/a/b/c')
    expect(analysis.pathSegments.map((segment) => segment.raw)).toEqual(['a', 'b', 'c'])
  })

  it('路径中的百分号编码同时给出原始与解码形式', () => {
    const analysis = analyze('https://example.com/%E4%B8%AD%E6%96%87/x')
    expect(analysis.pathname.raw).toBe('/%E4%B8%AD%E6%96%87/x')
    expect(analysis.pathname.decoded).toBe('/中文/x')
    expect(analysis.pathname.encoded).toBe(true)
    expect(analysis.pathSegments[0]).toEqual({ raw: '%E4%B8%AD%E6%96%87', decoded: '中文', encoded: true })
    expect(analysis.pathSegments[1]).toEqual({ raw: 'x', decoded: 'x', encoded: false })
  })

  it('查询参数的键与值都给出两种形式', () => {
    const analysis = analyze('https://example.com/?a%20b=c%2Bd')
    expect(analysis.params[0]?.key).toEqual({ raw: 'a%20b', decoded: 'a b', encoded: true })
    expect(analysis.params[0]?.value).toEqual({ raw: 'c%2Bd', decoded: 'c+d', encoded: true })
  })

  it('查询参数里的 + 按空格解释', () => {
    const analysis = analyze('https://example.com/?q=a+b')
    expect(analysis.params[0]?.value.decoded).toBe('a b')
    expect(analysis.params[0]?.value.encoded).toBe(true)
  })

  it('片段也被解码', () => {
    const analysis = analyze('https://example.com/#%E6%AE%B5')
    expect(analysis.hash.raw).toBe('%E6%AE%B5')
    expect(analysis.hash.decoded).toBe('段')
  })

  it('路径里的非法转义序列不会让整体失败，只退化为原始形式', () => {
    const analysis = analyze('https://example.com/%zz')
    expect(analysis.pathname.raw).toBe('/%zz')
    expect(analysis.pathname.decoded).toBe('/%zz')
    expect(analysis.pathname.encoded).toBe(false)
  })

  it('路径为根时没有分段', () => {
    expect(analyze('https://example.com').pathSegments).toEqual([])
  })
})

describe('analyzeUrl —— 非绝对与非法输入', () => {
  it('无协议输入提示不是绝对 URL 并给出 https 补全建议', () => {
    const result = analyzeUrl('example.com/a?x=1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_ABSOLUTE')
    expect(result.error).toContain('不是绝对 URL')
    expect(result.suggestion).toBe(`${NON_ABSOLUTE_PREFIX}example.com/a?x=1`)
  })

  it('相对路径同样提示不是绝对 URL', () => {
    const result = analyzeUrl('/a/b?x=1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NOT_ABSOLUTE')
  })

  it('补全后仍无法解析的输入按非法 URL 处理', () => {
    const result = analyzeUrl(':::')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('INVALID_URL')
      expect(result.suggestion).toBeTruthy()
    }
  })

  it('有协议但语法非法时按非法 URL 处理', () => {
    const result = analyzeUrl('https://exa mple.com/path')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_URL')
  })

  it('只有协议没有主机时按非法 URL 处理', () => {
    const result = analyzeUrl('https://')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_URL')
  })

  it('空输入返回 EMPTY_INPUT', () => {
    const result = analyzeUrl('  ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('EMPTY_INPUT')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run --project core src/core/web/url-analyzer.test.ts > /tmp/p3-t5.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t5.log`

Expected: FAIL，报 `Failed to resolve import "./url-analyzer"`。

- [ ] **Step 3: 写实现**

创建 `src/core/web/url-analyzer.ts`：

```ts
import { err, ok } from '../result'
import type { Result } from '../result'

/** 一个字符串在 URL 里的两种形态 */
export interface AnalyzedText {
  /** URL 中的原始写法 */
  raw: string
  /** 解码后的可读形式；无法解码时与 raw 相同 */
  decoded: string
  /** 解码后是否与原始形式不同（界面据此决定要不要并列展示两种形式） */
  encoded: boolean
}

export interface AnalyzedParam {
  key: AnalyzedText
  value: AnalyzedText
}

export interface UrlAnalysis {
  href: string
  protocol: string
  username: string
  password: string
  hostname: string
  /** 输入中显式写出的端口；未写出为 null */
  explicitPort: string | null
  /** 生效端口（显式端口，或该协议的默认端口） */
  port: string
  isDefaultPort: boolean
  origin: string
  pathname: AnalyzedText
  pathSegments: AnalyzedText[]
  /** 原始查询串（含前导 ?）；无查询时为空串 */
  search: string
  params: AnalyzedParam[]
  hash: AnalyzedText
}

export const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
  'ftp:': '21',
}

/** 非绝对 URL 的补全建议前缀 */
export const NON_ABSOLUTE_PREFIX = 'https://'

/** 判断输入是否带协议（scheme 后紧跟冒号） */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

function tryParse(text: string): URL | null {
  try {
    return new URL(text)
  } catch {
    return null
  }
}

/**
 * 解码为可读形式。
 *
 * 解码失败不能抛：`https://a.com/%zz` 是 `new URL` 能接受的合法输入，
 * 但 `decodeURIComponent('%zz')` 会抛 URIError。此时退化为保留原始形式，
 * 由 `encoded: false` 告诉界面「这个没有可读形式可展示」。
 */
function analyzeText(raw: string, plusAsSpace: boolean): AnalyzedText {
  const normalized = plusAsSpace ? raw.replaceAll('+', ' ') : raw
  if (!normalized.includes('%') && !(plusAsSpace && raw.includes('+'))) {
    return { raw, decoded: raw, encoded: false }
  }
  try {
    const decoded = decodeURIComponent(normalized)
    return { raw, decoded, encoded: decoded !== raw }
  } catch {
    return { raw, decoded: raw, encoded: false }
  }
}

/**
 * 手工切分查询串。
 *
 * 不用 `url.searchParams`：它在构造时就把百分号转义与 `+` 一并解码，
 * 原始编码形式拿不回来，而 spec 要求两种形式并列展示。
 */
function parseParams(search: string): AnalyzedParam[] {
  const body = search.startsWith('?') ? search.slice(1) : search
  if (body.length === 0) return []

  return body.split('&').map((pair) => {
    const separator = pair.indexOf('=')
    const key = separator === -1 ? pair : pair.slice(0, separator)
    const value = separator === -1 ? '' : pair.slice(separator + 1)
    return { key: analyzeText(key, true), value: analyzeText(value, true) }
  })
}

/**
 * 拆解 URL。
 *
 * 失败分两种，靠 `code` 区分，界面据此给不同引导：
 * - `NOT_ABSOLUTE`：缺协议，`suggestion` 是补上 `https://` 后的完整 URL，
 *   界面提供一键套用；补全后仍解析不了的输入会退化为 `INVALID_URL`，
 *   避免对 `:::` 这类输入给出毫无意义的「补全建议」。
 * - `INVALID_URL`：有协议但语法非法（主机名带空格、只有协议没有主机等）。
 */
export function analyzeUrl(input: string): Result<UrlAnalysis> {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return err('请输入 URL', { code: 'EMPTY_INPUT' })
  }

  if (!HAS_SCHEME.test(trimmed)) {
    const completed = `${NON_ABSOLUTE_PREFIX}${trimmed}`
    if (!tryParse(completed)) {
      return err('无法解析该地址', {
        code: 'INVALID_URL',
        detail: `"${trimmed}" 不是绝对 URL，补上协议后也无法解析`,
        suggestion: 'URL 需形如 https://example.com/path?x=1',
      })
    }
    return err('该输入不是绝对 URL', {
      code: 'NOT_ABSOLUTE',
      detail: '缺少协议部分，无法拆解协议 / 主机 / 端口与 Origin',
      suggestion: completed,
    })
  }

  const url = tryParse(trimmed)
  if (!url) {
    return err('URL 解析失败', {
      code: 'INVALID_URL',
      detail: '协议之后的部分不符合 URL 语法，例如主机名含空格或端口不是数字',
      suggestion: 'URL 需形如 https://example.com/path?x=1',
    })
  }

  // 注意不能只看 url.port：URL 规范会把默认端口归一化掉（https://a.com:443 的 port 是空串），
  // 必须从原始字符串里取「用户写出来的」端口
  const explicitPort = explicitPortOf(trimmed, url.protocol)
  const defaultPort = DEFAULT_PORTS[url.protocol] ?? ''
  const port = explicitPort ?? defaultPort

  const rawSegments = url.pathname.split('/').filter((segment) => segment !== '')

  return ok({
    href: url.href,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    hostname: url.hostname,
    explicitPort,
    port,
    isDefaultPort: port !== '' && port === defaultPort,
    origin: url.origin,
    pathname: analyzeText(url.pathname, false),
    pathSegments: rawSegments.map((segment) => analyzeText(segment, false)),
    search: url.search,
    params: parseParams(url.search),
    hash: analyzeText(url.hash.replace(/^#/, ''), false),
  })
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run --project core src/core/web/url-analyzer.test.ts > /tmp/p3-t5.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t5.log`

Expected: PASS，21 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/core/web/url-analyzer.ts src/core/web/url-analyzer.test.ts
git commit -m "feat(web): URL 分析 Core（tasks 7.4）"
```

---

### Task 6: URL 编码/解码工具（7.6）

对应 `tasks.md` **7.1 / 7.6**。

**Files:**
- Create: `src/tools/web/url-codec/meta.ts`
- Create: `src/tools/web/url-codec/Tool.tsx`
- Test: `src/tools/web/url-codec/Tool.test.tsx`

**Interfaces:**
- Consumes: `encodeUrl` / `decodeUrl` / `URL_CODEC_MODES` / `URL_DIRECTIONS`（Task 2）；`ToolLayout` / `useToolState` / `ui/*`
- Produces: 注册表条目 `url-codec`（`category: 'web'`）

- [ ] **Step 1: 写元数据**

创建 `src/tools/web/url-codec/meta.ts`：

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'url-codec',
  name: 'URL 编码/解码',
  category: 'web',
  description: '组件 / 整体 URI / 表单三种模式的编码与解码，并定位非法转义',
  keywords: ['url', 'uri', 'encode', 'decode', 'percent', '编码', '解码', '转义', 'urlencode'],
  order: 10,
} satisfies ToolMeta
```

- [ ] **Step 2: 写失败测试**

创建 `src/tools/web/url-codec/Tool.test.tsx`：

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import UrlCodecTool from './Tool'

/** 只读 CodeArea 渲染的是行号列表，内容在每行最后一个 span */
const lines = () =>
  screen.getAllByRole('listitem').map((item) => item.lastElementChild?.textContent ?? '')

const input = () => screen.getByRole('textbox', { name: '待处理的文本' })
const setInput = (value: string) => {
  fireEvent.change(input(), { target: { value } })
}

beforeEach(() => {
  localStorage.clear()
})

describe('URL 编码/解码工具', () => {
  it('默认组件模式编码 a b&c=d', () => {
    render(<UrlCodecTool />)
    setInput('a b&c=d')

    expect(lines()).toEqual(['a%20b%26c%3Dd'])
    expect(screen.getByRole('button', { name: '复制' })).toBeDefined()
  })

  it('切到整体 URI 模式后保留结构字符', async () => {
    render(<UrlCodecTool />)
    setInput('https://a.com/b c?d=e&f=g')
    await userEvent.click(screen.getByRole('button', { name: '整体 URI' }))

    expect(lines()).toEqual(['https://a.com/b%20c?d=e&f=g'])
  })

  it('切到表单模式后空格编码为 +', async () => {
    render(<UrlCodecTool />)
    setInput('a b')
    await userEvent.click(screen.getByRole('button', { name: '表单' }))

    expect(lines()).toEqual(['a+b'])
  })

  it('切换到解码方向后按当前模式解码', async () => {
    render(<UrlCodecTool />)
    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setInput('a%20b%26c%3Dd')

    expect(lines()).toEqual(['a b&c=d'])
  })

  it('表单模式解码把 + 还原为空格', async () => {
    render(<UrlCodecTool />)
    await userEvent.click(screen.getByRole('button', { name: '表单' }))
    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setInput('a+b')

    expect(lines()).toEqual(['a b'])
  })

  it('中文与 emoji 编码后再解码还原', async () => {
    render(<UrlCodecTool />)
    setInput('你好 🚀')
    const encoded = lines()[0] ?? ''
    expect(encoded).not.toContain('你')

    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setInput(encoded)

    expect(lines()).toEqual(['你好 🚀'])
  })

  it('以 % 结尾时提示非法转义且不给结果', async () => {
    render(<UrlCodecTool />)
    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setInput('abc%')

    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('非法的转义序列')
    expect(alert).toContain('偏移 3')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('%ZZ 提示非法转义', async () => {
    render(<UrlCodecTool />)
    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setInput('%ZZ')

    expect(screen.getByRole('alert').textContent).toContain('非法的转义序列')
  })

  it('状态栏标出方向与模式', async () => {
    render(<UrlCodecTool />)
    setInput('a b')
    expect(screen.getByText(/组件模式编码/)).toBeDefined()

    await userEvent.click(screen.getByRole('button', { name: '表单' }))
    expect(screen.getByText(/表单模式编码/)).toBeDefined()
  })

  it('空输入时展示空态', () => {
    render(<UrlCodecTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run --project ui src/tools/web/url-codec/Tool.test.tsx > /tmp/p3-t6.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t6.log`

Expected: FAIL，报 `Failed to resolve import "./Tool"`。

- [ ] **Step 4: 写最小实现**

创建 `src/tools/web/url-codec/Tool.tsx`：

```tsx
import { useMemo } from 'react'
import {
  decodeUrl,
  encodeUrl,
  URL_CODEC_MODES,
  URL_DIRECTIONS,
  type UrlCodecMode,
  type UrlDirection,
} from '@/core/web/url-codec'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { SegmentedControl } from '@/framework/ui/Inputs'

/** 必须定义在组件外部：初始值参与 useToolState 的惰性初始化，每次渲染新建会让依赖持续失效 */
const INITIAL_STATE = {
  input: '',
  options: { direction: 'encode' as UrlDirection, mode: 'component' as UrlCodecMode },
}

const SAMPLES: Record<UrlDirection, string> = {
  encode: 'a b&c=d/路径?x=1',
  decode: 'a%20b%26c%3Dd%2F%E8%B7%AF%E5%BE%84%3Fx%3D1',
}

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

const MODE_LABEL: Record<UrlCodecMode, string> = {
  component: '组件',
  uri: '整体 URI',
  form: '表单',
}

export default function UrlCodecTool() {
  const { state, update, updateOptions } = useToolState('url-codec', INITIAL_STATE)
  const { input } = state
  const { direction, mode } = state.options

  // 依赖全部是原始值（计划① R16：对象依赖会造成无限渲染循环）
  const result = useMemo(() => {
    if (input.length === 0) return null
    return direction === 'encode' ? encodeUrl(input, mode) : decodeUrl(input, mode)
  }, [input, direction, mode])

  return (
    <ToolLayout
      options={
        <>
          <Field label="方向">
            <SegmentedControl
              label="转换方向"
              options={URL_DIRECTIONS}
              value={direction}
              onChange={(next) => updateOptions({ direction: next })}
            />
          </Field>
          <Field label="模式">
            <SegmentedControl
              label="编码模式"
              options={URL_CODEC_MODES}
              value={mode}
              onChange={(next) => updateOptions({ mode: next })}
            />
          </Field>
          <button
            type="button"
            className={BUTTON}
            onClick={() => update({ input: SAMPLES[direction] })}
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
          label="待处理的文本"
          value={input}
          rows={10}
          onChange={(value) => update({ input: value })}
          placeholder={
            direction === 'encode' ? '输入任意文本或 URL' : '输入含 %XX 转义的内容'
          }
        />
      }
      output={
        result === null ? (
          <EmptyState
            title="尚未输入"
            hint={direction === 'encode' ? '输入文本即可编码' : '粘贴含 %XX 的内容即可解码'}
          />
        ) : !result.ok ? (
          <ErrorNote info={result} />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={result.value} label="复制" />
            </div>
            <CodeArea value={result.value} readOnly label="结果" />
          </>
        )
      }
      status={
        result === null ? (
          <span>等待输入</span>
        ) : !result.ok ? (
          <span className="text-danger">{result.error}</span>
        ) : (
          <span>
            {MODE_LABEL[mode]}模式{direction === 'encode' ? '编码' : '解码'} · 输出{' '}
            {result.value.length} 字符
          </span>
        )
      }
    />
  )
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run --project ui src/tools/web/url-codec/Tool.test.tsx > /tmp/p3-t6.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t6.log`

Expected: PASS，10 个用例全绿。

- [ ] **Step 6: 提交**

```bash
git add src/tools/web/url-codec
git commit -m "feat(web): URL 编码/解码工具（tasks 7.6）"
```

---

### Task 7: JSON 差异比较工具（7.7）

对应 `tasks.md` **7.2 / 7.7**。本工具用 `ToolLayout` 的 `body` 形态（双输入面板 + 结果区），无法用默认的 input/output 两栏。

**Files:**
- Create: `src/tools/web/json-diff/meta.ts`
- Create: `src/tools/web/json-diff/Tool.tsx`
- Test: `src/tools/web/json-diff/Tool.test.tsx`

**Interfaces:**
- Consumes: `compareJson` / `failedSide` / `DIFF_KIND_LABEL` / `JSON_TYPE_LABEL` / `DiffEntry`（Task 3）；`ToolLayout` 的 `body` 分支 / `Pane` / `ui/*`

- [ ] **Step 1: 写元数据**

创建 `src/tools/web/json-diff/meta.ts`：

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'json-diff',
  name: 'JSON 差异比较',
  category: 'web',
  description: '对比两段 JSON 的结构差异，按路径定位新增、删除与修改',
  keywords: ['json', 'diff', 'compare', '差异', '比较', '对比', '对比json'],
  order: 20,
} satisfies ToolMeta
```

- [ ] **Step 2: 写失败测试**

创建 `src/tools/web/json-diff/Tool.test.tsx`：

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import JsonDiffTool from './Tool'

const left = () => screen.getByRole('textbox', { name: '左侧 JSON' })
const right = () => screen.getByRole('textbox', { name: '右侧 JSON' })

const setSide = (side: 'left' | 'right', value: string) => {
  fireEvent.change(side === 'left' ? left() : right(), { target: { value } })
}

const resultPane = () => screen.getByRole('region', { name: '差异结果' })
const rows = () => within(resultPane()).getAllByRole('listitem')

beforeEach(() => {
  localStorage.clear()
})

describe('JSON 差异比较工具', () => {
  it('值修改：展示路径与新旧值', () => {
    render(<JsonDiffTool />)
    setSide('left', '{"a":1}')
    setSide('right', '{"a":2}')

    const row = rows()[0]!
    expect(row.textContent).toContain('修改')
    expect(within(row).getByText('$.a')).toBeDefined()
    expect(row.textContent).toContain('1')
    expect(row.textContent).toContain('2')
  })

  it('新增与删除分别标注', () => {
    render(<JsonDiffTool />)
    setSide('left', '{"c":4}')
    setSide('right', '{"b":3}')

    const text = resultPane().textContent ?? ''
    expect(text).toContain('新增')
    expect(text).toContain('$.b')
    expect(text).toContain('删除')
    expect(text).toContain('$.c')
  })

  it('数组按索引定位并区分修改与增删', () => {
    render(<JsonDiffTool />)
    setSide('left', '{"list":[1,2,3]}')
    setSide('right', '{"list":[1,9]}')

    const text = resultPane().textContent ?? ''
    expect(text).toContain('$.list[1]')
    expect(text).toContain('修改')
    expect(text).toContain('$.list[2]')
    expect(text).toContain('删除')
  })

  it('类型变化时并列展示两侧类型', () => {
    render(<JsonDiffTool />)
    setSide('left', '{"a":1}')
    setSide('right', '{"a":"1"}')

    const text = resultPane().textContent ?? ''
    expect(text).toContain('数字')
    expect(text).toContain('字符串')
  })

  it('仅键序不同时展示无差异', () => {
    render(<JsonDiffTool />)
    setSide('left', '{"a":1,"b":2}')
    setSide('right', '{"b":2,"a":1}')

    expect(within(resultPane()).getByText('两段 JSON 无差异')).toBeDefined()
  })

  it('左侧非法时在左侧提示且不给差异结果', () => {
    render(<JsonDiffTool />)
    setSide('left', '{')
    setSide('right', '{}')

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('左侧 JSON 解析失败')
    expect(within(resultPane()).queryAllByRole('listitem')).toHaveLength(0)
  })

  it('右侧非法时在右侧提示', () => {
    render(<JsonDiffTool />)
    setSide('left', '{}')
    setSide('right', '[1,]')

    expect(screen.getByRole('alert').textContent).toContain('右侧 JSON 解析失败')
  })

  it('交换两侧后新增与删除互换', async () => {
    render(<JsonDiffTool />)
    setSide('left', '{"a":1}')
    setSide('right', '{"a":1,"b":2}')
    expect(resultPane().textContent).toContain('新增')

    await userEvent.click(screen.getByRole('button', { name: '交换两侧' }))

    expect((left() as HTMLTextAreaElement).value).toBe('{"a":1,"b":2}')
    expect((right() as HTMLTextAreaElement).value).toBe('{"a":1}')
    expect(resultPane().textContent).toContain('删除')
  })

  it('状态栏统计三类变更数量', () => {
    render(<JsonDiffTool />)
    setSide('left', '{"a":1,"c":4}')
    setSide('right', '{"a":2,"b":3}')

    expect(screen.getByText(/新增 1 · 删除 1 · 修改 1/)).toBeDefined()
  })

  it('两侧都为空时展示空态', () => {
    render(<JsonDiffTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run --project ui src/tools/web/json-diff/Tool.test.tsx > /tmp/p3-t7.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t7.log`

Expected: FAIL，报 `Failed to resolve import "./Tool"`。

- [ ] **Step 4: 写最小实现**

创建 `src/tools/web/json-diff/Tool.tsx`：

```tsx
import { useMemo } from 'react'
import {
  compareJson,
  DIFF_KIND_LABEL,
  failedSide,
  JSON_TYPE_LABEL,
  type DiffEntry,
  type DiffKind,
} from '@/core/web/json-diff'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Icon } from '@/framework/ui/Icon'
import { Pane } from '@/framework/ui/Pane'

const INITIAL_STATE = {
  input: '{"a":1,"b":[1,2,3],"c":{"d":"x"}}',
  options: { right: '{"a":2,"b":[1,9],"c":{"d":"x"},"e":true}' },
}

const KIND_CLASS: Record<DiffKind, string> = {
  added: 'text-success',
  removed: 'text-danger',
  changed: 'text-warn',
}

const BUTTON =
  'inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

function formatValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function DiffRow({ entry }: { entry: DiffEntry }) {
  const showTypes = entry.kind === 'changed' && entry.leftType !== entry.rightType
  return (
    <li className="flex flex-wrap items-baseline gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0">
      <span className={`w-8 shrink-0 text-[12px] font-medium ${KIND_CLASS[entry.kind]}`}>
        {DIFF_KIND_LABEL[entry.kind]}
      </span>
      <code className="code-text shrink-0 text-fg">{entry.path}</code>
      <span className="code-text min-w-0 break-all text-muted">
        {entry.leftType === 'absent' ? '—' : formatValue(entry.left)}
        {' → '}
        {entry.rightType === 'absent' ? '—' : formatValue(entry.right)}
      </span>
      {showTypes && (
        <span className="text-[12px] text-warn">
          （{JSON_TYPE_LABEL[entry.leftType]} → {JSON_TYPE_LABEL[entry.rightType]}）
        </span>
      )}
    </li>
  )
}

export default function JsonDiffTool() {
  const { state, update, updateOptions } = useToolState('json-diff', INITIAL_STATE)
  const { input } = state
  const right = state.options.right as string

  const bothEmpty = input.trim().length === 0 && right.trim().length === 0

  // 依赖全部是原始值（计划① R16：对象依赖会造成无限渲染循环）
  const compared = useMemo(
    () => (bothEmpty ? null : compareJson(input, right)),
    [input, right, bothEmpty],
  )

  const badSide = compared && !compared.ok ? failedSide(compared) : null
  const entries = compared && compared.ok ? compared.value : []

  const counts = useMemo(() => {
    const tally = { added: 0, removed: 0, changed: 0 }
    for (const entry of entries) tally[entry.kind] += 1
    return tally
  }, [entries])

  return (
    <ToolLayout
      options={
        <>
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              // 右侧存在 options 里而不是 input 里：input 字段是「主输入」，
              // 双输入工具的主输入是左侧，交换时要连同右侧一起换
              const previousLeft = input
              update({ input: right })
              updateOptions({ right: previousLeft })
            }}
          >
            <Icon name="swap" size={13} />
            交换两侧
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              update({ input: '' })
              updateOptions({ right: '' })
            }}
          >
            清空
          </button>
        </>
      }
      body={
        <div className="flex h-full min-h-0 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col gap-2 min-[720px]:flex-row">
            <Pane
              title="左侧 JSON"
              tone={badSide === 'left' ? 'danger' : 'default'}
              className="min-h-0 flex-1"
            >
              <CodeArea
                label="左侧 JSON"
                value={input}
                rows={10}
                onChange={(value) => update({ input: value })}
                errorLine={badSide === 'left' && !compared?.ok ? compared?.line : undefined}
                placeholder="粘贴第一段 JSON"
              />
              {badSide === 'left' && !compared?.ok && <ErrorNote info={compared} />}
            </Pane>

            <Pane
              title="右侧 JSON"
              tone={badSide === 'right' ? 'danger' : 'default'}
              className="min-h-0 flex-1"
            >
              <CodeArea
                label="右侧 JSON"
                value={right}
                rows={10}
                onChange={(value) => updateOptions({ right: value })}
                errorLine={badSide === 'right' && !compared?.ok ? compared?.line : undefined}
                placeholder="粘贴第二段 JSON"
              />
              {badSide === 'right' && !compared?.ok && <ErrorNote info={compared} />}
            </Pane>
          </div>

          <Pane title="差异结果" className="min-h-0 flex-1">
            {compared === null ? (
              <EmptyState title="尚未输入" hint="左右各粘贴一段 JSON 即可比较" />
            ) : !compared.ok ? (
              <p className="p-2.5 text-[12px] text-muted">修正该侧 JSON 后才会输出差异。</p>
            ) : entries.length === 0 ? (
              <p className="p-2.5 text-[12px] text-success">两段 JSON 无差异</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {entries.map((entry) => (
                  <DiffRow key={`${entry.kind}:${entry.path}`} entry={entry} />
                ))}
              </ul>
            )}
          </Pane>
        </div>
      }
      status={
        compared === null ? (
          <span>等待输入</span>
        ) : !compared.ok ? (
          <span className="text-danger">{compared.error}</span>
        ) : entries.length === 0 ? (
          <span className="text-success">无差异</span>
        ) : (
          <span>
            新增 {counts.added} · 删除 {counts.removed} · 修改 {counts.changed}
          </span>
        )
      }
    />
  )
}
```

> **`Pane` 需要可被 `getByRole('region', { name: '差异结果' })` 找到**：现有 `Pane` 渲染的是 `<section>`（隐式 role 为 `region`），只有带可访问名时才会暴露为 `region`。`<section>` 的可访问名来自 `aria-label` / `aria-labelledby`，而当前实现用的是 `<span>` 文本 —— 因此需要给 `Pane` 的标题加 `id` 并给 `section` 加 `aria-labelledby`。
>
> 若不想改动框架（避免与并发的第 8 组冲突），把测试里的 `resultPane()` 改为 `screen.getByText('差异结果').closest('section')!` 并在其内部查询即可。**二选一，但必须让测试能稳定定位结果区**；推荐后者，零框架改动。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run --project ui src/tools/web/json-diff/Tool.test.tsx > /tmp/p3-t7.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t7.log`

Expected: PASS，10 个用例全绿。

- [ ] **Step 6: 提交**

```bash
git add src/tools/web/json-diff
git commit -m "feat(web): JSON 差异比较工具（tasks 7.7）"
```

---

### Task 8: JWT 解析器工具（7.8）

对应 `tasks.md` **7.3 / 7.8**。

**Files:**
- Create: `src/tools/web/jwt-parser/meta.ts`
- Create: `src/tools/web/jwt-parser/Tool.tsx`
- Test: `src/tools/web/jwt-parser/Tool.test.tsx`

**Interfaces:**
- Consumes: `decodeJwt` / `JwtDecoded` / `JwtPart`（Task 4）

- [ ] **Step 1: 写元数据**

创建 `src/tools/web/jwt-parser/meta.ts`：

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'jwt-parser',
  name: 'JWT 解析器',
  category: 'web',
  description: '拆解 JWT 的头部、载荷与签名，可读化时间声明并判定过期状态（不校验签名）',
  keywords: ['jwt', 'token', 'jose', 'jws', 'bearer', '解析', '令牌', '解码', '过期'],
  order: 30,
} satisfies ToolMeta
```

- [ ] **Step 2: 写失败测试**

创建 `src/tools/web/jwt-parser/Tool.test.tsx`：

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import JwtParserTool from './Tool'

const b64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

/** exp = 1700000000（2023-11-14），相对当前时间必然过期 */
const EXPIRED = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
  sub: '1',
  exp: 1_700_000_000,
  iat: 1_690_000_000,
  nbf: 1_690_000_000,
})}.c2ln`

/** exp = 4102444800（2100-01-01），必然未过期 */
const VALID = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ exp: 4_102_444_800 })}.c2ln`

const setToken = (value: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'JWT 令牌' }), { target: { value } })
}

beforeEach(() => {
  localStorage.clear()
})

describe('JWT 解析器工具', () => {
  it('展示解码后的头部与载荷 JSON', () => {
    render(<JwtParserTool />)
    setToken(EXPIRED)

    expect(screen.getByText(/"alg": "HS256"/)).toBeDefined()
    expect(screen.getByText(/"sub": "1"/)).toBeDefined()
  })

  it('展示原始签名片段', () => {
    render(<JwtParserTool />)
    setToken(EXPIRED)

    expect(screen.getByText('c2ln')).toBeDefined()
  })

  it('概览区展示算法与类型', () => {
    render(<JwtParserTool />)
    setToken(EXPIRED)

    expect(screen.getByText('HS256')).toBeDefined()
    expect(screen.getByText('JWT')).toBeDefined()
  })

  it('时间声明给出中文含义与可读时间', () => {
    render(<JwtParserTool />)
    setToken(EXPIRED)

    expect(screen.getByText('过期时间')).toBeDefined()
    expect(screen.getByText('签发时间')).toBeDefined()
    expect(screen.getByText('生效时间')).toBeDefined()
    expect(screen.getAllByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).length).toBeGreaterThan(0)
  })

  it('exp 已过时提示过期并给出已过期时长', () => {
    render(<JwtParserTool />)
    setToken(EXPIRED)

    expect(screen.getByText(/已过期/)).toBeDefined()
  })

  it('exp 未到时提示仍在有效期', () => {
    render(<JwtParserTool />)
    setToken(VALID)

    expect(screen.getByText(/仍在有效期内/)).toBeDefined()
  })

  it('不含 exp 时提示未声明过期时间', () => {
    render(<JwtParserTool />)
    setToken(`${b64url({ alg: 'none' })}.${b64url({ sub: '1' })}.sig`)

    expect(screen.getByText(/未声明过期时间/)).toBeDefined()
  })

  it('显式说明签名未被校验', () => {
    render(<JwtParserTool />)
    setToken(EXPIRED)

    expect(screen.getByText(/签名未被校验/)).toBeDefined()
  })

  it('段数不合法时指出实际段数', () => {
    render(<JwtParserTool />)
    setToken('eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ')

    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('JWT 格式不合法')
    expect(alert).toContain('2 段')
  })

  it('载荷非法 JSON 时提示载荷失败但仍展示头部', () => {
    render(<JwtParserTool />)
    setToken(`${b64url({ alg: 'none', kid: 'k1' })}.${Buffer.from('not json').toString('base64url')}.sig`)

    expect(screen.getByText(/载荷不是合法的 JSON/)).toBeDefined()
    expect(screen.getByText(/"kid": "k1"/)).toBeDefined()
  })

  it('空输入时展示空态', () => {
    render(<JwtParserTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run --project ui src/tools/web/jwt-parser/Tool.test.tsx > /tmp/p3-t8.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t8.log`

Expected: FAIL，报 `Failed to resolve import "./Tool"`。

- [ ] **Step 4: 写最小实现**

创建 `src/tools/web/jwt-parser/Tool.tsx`：

```tsx
import { useMemo } from 'react'
import { decodeJwt, type JwtDecoded, type JwtPart } from '@/core/web/jwt'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'

/** 必须定义在组件外部：初始值参与 useToolState 的惰性初始化 */
const INITIAL_STATE = { input: '', options: {} }

const SECTION = 'border-b border-border px-2.5 py-2 last:border-b-0'
const SECTION_TITLE = 'mb-1 text-[11px] tracking-wide text-muted uppercase'
const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

function PartView({ title, part, label }: { title: string; part: JwtPart; label: string }) {
  const json = part.value === null ? null : JSON.stringify(part.value, null, 2)

  return (
    <section className={SECTION}>
      <div className="flex items-center justify-between gap-2">
        <h3 className={SECTION_TITLE}>{title}</h3>
        {json !== null && <CopyButton text={json} label="复制" />}
      </div>
      {part.error ? (
        <div className="space-y-1">
          <p className="text-[12px] text-danger">{part.error.error}</p>
          {part.text !== null && (
            <pre className="code-text m-0 overflow-auto rounded-md bg-surface-2 p-2 whitespace-pre-wrap">
              {part.text}
            </pre>
          )}
        </div>
      ) : (
        <CodeArea value={json ?? ''} readOnly label={label} />
      )}
    </section>
  )
}

function ExpiryBanner({ decoded }: { decoded: JwtDecoded }) {
  const { expiry } = decoded
  if (expiry.status === 'expired') {
    return (
      <p className="text-[12px] text-danger">
        已过期 · 已过期 {expiry.durationText}
      </p>
    )
  }
  if (expiry.status === 'valid') {
    return (
      <p className="text-[12px] text-success">仍在有效期内 · 剩余 {expiry.durationText}</p>
    )
  }
  return <p className="text-[12px] text-muted">未声明过期时间（载荷中没有 exp）</p>
}

export default function JwtParserTool() {
  const { state, update } = useToolState('jwt-parser', INITIAL_STATE)
  const { input } = state

  // 依赖只有原始值（计划① R16）
  const decoded = useMemo(
    () => (input.trim().length === 0 ? null : decodeJwt(input)),
    [input],
  )

  return (
    <ToolLayout
      options={
        <>
          <button type="button" className={BUTTON} onClick={() => update({ input: '' })}>
            清空
          </button>
        </>
      }
      input={
        <CodeArea
          label="JWT 令牌"
          value={input}
          rows={12}
          onChange={(value) => update({ input: value })}
          placeholder="粘贴形如 header.payload.signature 的令牌"
        />
      }
      output={
        decoded === null ? (
          <EmptyState title="尚未输入" hint="粘贴 JWT 即可查看三部分内容" />
        ) : !decoded.ok ? (
          <ErrorNote info={decoded} />
        ) : (
          <>
            <section className={SECTION}>
              <h3 className={SECTION_TITLE}>概览</h3>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                <dt className="text-muted">算法 alg</dt>
                <dd className="code-text m-0">{decoded.value.alg ?? '（未声明）'}</dd>
                <dt className="text-muted">类型 typ</dt>
                <dd className="code-text m-0">{decoded.value.typ ?? '（未声明）'}</dd>
              </dl>
              <div className="mt-1">
                <ExpiryBanner decoded={decoded.value} />
              </div>
            </section>

            <PartView title="头部 Header" part={decoded.value.header} label="头部 JSON" />
            <PartView title="载荷 Payload" part={decoded.value.payload} label="载荷 JSON" />

            {decoded.value.timeClaims.length > 0 && (
              <section className={SECTION}>
                <h3 className={SECTION_TITLE}>时间声明</h3>
                <ul className="m-0 list-none p-0 text-[12px]">
                  {decoded.value.timeClaims.map((claim) => (
                    <li key={claim.claim} className="flex flex-wrap items-baseline gap-2 py-0.5">
                      <span className="w-16 shrink-0 text-muted">{claim.label}</span>
                      <span className="code-text">{claim.readable}</span>
                      <span className="code-text text-muted">({claim.epochSeconds})</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className={SECTION}>
              <h3 className={SECTION_TITLE}>签名 Signature</h3>
              <code className="code-text block break-all">{decoded.value.signature || '（空）'}</code>
              <p className="mt-1 text-[12px] text-warn">
                签名未被校验：本工具只做 Base64URL 解码，不验证签名，不能据此判断令牌是否可信。
              </p>
            </section>
          </>
        )
      }
      status={
        decoded === null ? (
          <span>等待输入</span>
        ) : !decoded.ok ? (
          <span className="text-danger">{decoded.error}</span>
        ) : (
          <span>
            3 段 · {decoded.value.alg ?? '未声明算法'} ·{' '}
            {decoded.value.expiry.status === 'expired'
              ? '已过期'
              : decoded.value.expiry.status === 'valid'
                ? '有效期内'
                : '未声明过期时间'}
          </span>
        )
      }
    />
  )
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run --project ui src/tools/web/jwt-parser/Tool.test.tsx > /tmp/p3-t8.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t8.log`

Expected: PASS，11 个用例全绿。

- [ ] **Step 6: 提交**

```bash
git add src/tools/web/jwt-parser
git commit -m "feat(web): JWT 解析器工具（tasks 7.8）"
```

---

### Task 9: URL 分析器工具（7.9）

对应 `tasks.md` **7.4 / 7.9**。

**Files:**
- Create: `src/tools/web/url-analyzer/meta.ts`
- Create: `src/tools/web/url-analyzer/Tool.tsx`
- Test: `src/tools/web/url-analyzer/Tool.test.tsx`

**Interfaces:**
- Consumes: `analyzeUrl` / `UrlAnalysis` / `AnalyzedText`（Task 5）

- [ ] **Step 1: 写元数据**

创建 `src/tools/web/url-analyzer/meta.ts`：

```ts
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'url-analyzer',
  name: 'URL 分析器',
  category: 'web',
  description: '拆解 URL 的协议、主机、端口、路径、查询参数与片段，并列展示编码与解码形式',
  keywords: ['url', 'uri', 'parse', 'query', 'origin', '分析', '解析', '参数', '拆解'],
  order: 40,
} satisfies ToolMeta
```

- [ ] **Step 2: 写失败测试**

创建 `src/tools/web/url-analyzer/Tool.test.tsx`：

```tsx
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import UrlAnalyzerTool from './Tool'

const setUrl = (value: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), { target: { value } })
}

const paramRows = () => {
  const table = screen.getByTestId('url-params')
  return within(table).getAllByRole('row').slice(1) // 去掉表头
}

beforeEach(() => {
  localStorage.clear()
})

describe('URL 分析器工具', () => {
  it('完整 URL 的各组成部分都被展示', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://user:pass@example.com:8443/a/b?x=1&x=2#sec')

    expect(screen.getByText('https:')).toBeDefined()
    expect(screen.getByText('user')).toBeDefined()
    expect(screen.getByText('pass')).toBeDefined()
    expect(screen.getByText('example.com')).toBeDefined()
    expect(screen.getByText('8443')).toBeDefined()
    expect(screen.getByText('/a/b')).toBeDefined()
    expect(screen.getByText('sec')).toBeDefined()
  })

  it('Origin 推导结果被展示', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://user:pass@example.com:8443/a/b')

    expect(screen.getByText('https://example.com:8443')).toBeDefined()
  })

  it('未写端口时补默认端口并标注', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://example.com/path')

    expect(screen.getByText('443')).toBeDefined()
    expect(screen.getByText('协议默认端口')).toBeDefined()
  })

  it('同名查询参数逐行展示', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://example.com/?x=1&x=2')

    const rows = paramRows()
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('1')
    expect(rows[1]!.textContent).toContain('2')
  })

  it('路径分段逐项展示', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://example.com/a/b/c')

    const list = screen.getByTestId('url-segments')
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('编码字符并列展示原始与解码形式', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://example.com/%E4%B8%AD%E6%96%87/%E6%96%87?q=a+b')

    const text = screen.getByTestId('url-parts').textContent ?? ''
    expect(text).toContain('/%E4%B8%AD%E6%96%87/%E6%96%87')
    expect(text).toContain('/中文/文')

    const row = paramRows()[0]!
    expect(row.textContent).toContain('a+b')
    expect(row.textContent).toContain('a b')
  })

  it('无协议输入提示不是绝对 URL 并给出补全建议', () => {
    render(<UrlAnalyzerTool />)
    setUrl('example.com/a?x=1')

    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('不是绝对 URL')
    expect(screen.getByRole('button', { name: '按 https:// 补全' })).toBeDefined()
  })

  it('点击补全建议后按补全的 URL 重新分析', async () => {
    render(<UrlAnalyzerTool />)
    setUrl('example.com/a?x=1')
    await userEvent.click(screen.getByRole('button', { name: '按 https:// 补全' }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('example.com')).toBeDefined()
    expect(screen.getByText('443')).toBeDefined()
  })

  it('非法 URL 提示解析失败且不展示分段结果', () => {
    render(<UrlAnalyzerTool />)
    setUrl('https://exa mple.com/path')

    expect(screen.getByRole('alert').textContent).toContain('URL 解析失败')
    expect(screen.queryByTestId('url-parts')).toBeNull()
  })

  it('空输入时展示空态', () => {
    render(<UrlAnalyzerTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run --project ui src/tools/web/url-analyzer/Tool.test.tsx > /tmp/p3-t9.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t9.log`

Expected: FAIL，报 `Failed to resolve import "./Tool"`。

- [ ] **Step 4: 写最小实现**

创建 `src/tools/web/url-analyzer/Tool.tsx`：

```tsx
import { useMemo } from 'react'
import { analyzeUrl, type AnalyzedText, type UrlAnalysis } from '@/core/web/url-analyzer'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'

const INITIAL_STATE = { input: '', options: {} }

const SAMPLE = 'https://user:pass@example.com:8443/a/b?x=1&x=2&q=%E4%B8%AD%E6%96%87#sec'

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'
const ROW = 'grid grid-cols-[5.5rem_1fr] gap-x-3 py-0.5'
const TERM = 'text-muted'

/** 有解码形式时两种并列；没有时只展示原始形式 */
function TextValue({ text, label }: { text: AnalyzedText; label: string }) {
  if (text.raw === '') return <span className="text-muted">（无）</span>
  if (!text.encoded) return <code className="code-text break-all">{text.raw}</code>

  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-baseline gap-1.5">
        <span className="shrink-0 text-[11px] text-muted">原始</span>
        <code className="code-text break-all">{text.raw}</code>
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="shrink-0 text-[11px] text-muted">解码</span>
        <code className="code-text break-all text-fg">{text.decoded}</code>
      </span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

function PartsTable({ analysis }: { analysis: UrlAnalysis }) {
  const rows: { term: string; value: React.ReactNode }[] = [
    { term: '协议', value: <code className="code-text">{analysis.protocol}</code> },
    {
      term: '用户名',
      value: analysis.username
        ? <code className="code-text">{analysis.username}</code>
        : <span className="text-muted">（无）</span>,
    },
    {
      term: '密码',
      value: analysis.password
        ? <code className="code-text">{analysis.password}</code>
        : <span className="text-muted">（无）</span>,
    },
    { term: '主机名', value: <code className="code-text">{analysis.hostname}</code> },
    {
      term: '端口',
      value: (
        <span className="flex items-baseline gap-2">
          <code className="code-text">{analysis.port}</code>
          {analysis.isDefaultPort && (
            <span className="text-[11px] text-muted">协议默认端口</span>
          )}
          {analysis.explicitPort === null && (
            <span className="text-[11px] text-muted">（输入中未写出）</span>
          )}
        </span>
      ),
    },
    { term: 'Origin', value: <code className="code-text break-all">{analysis.origin}</code> },
    { term: '路径', value: <TextValue text={analysis.pathname} label="路径" /> },
    { term: '片段', value: <TextValue text={analysis.hash} label="片段" /> },
  ]

  return (
    <dl className="m-0 px-2.5 py-2 text-[12px]" data-testid="url-parts">
      {rows.map((row) => (
        <div key={row.term} className={ROW}>
          <dt className={TERM}>{row.term}</dt>
          <dd className="m-0 min-w-0">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function UrlAnalyzerTool() {
  const { state, update } = useToolState('url-analyzer', INITIAL_STATE)
  const { input } = state

  // 依赖只有原始值（计划① R16）
  const analyzed = useMemo(
    () => (input.trim().length === 0 ? null : analyzeUrl(input)),
    [input],
  )

  const notAbsolute =
    analyzed !== null && !analyzed.ok && analyzed.code === 'NOT_ABSOLUTE' ? analyzed.suggestion : null

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
          label="URL"
          value={input}
          rows={6}
          onChange={(value) => update({ input: value })}
          placeholder="https://example.com/a/b?x=1#sec"
        />
      }
      output={
        analyzed === null ? (
          <EmptyState title="尚未输入" hint="粘贴 URL 即可查看各组成部分" />
        ) : !analyzed.ok ? (
          <div className="space-y-2">
            <ErrorNote info={analyzed} />
            {notAbsolute !== null && (
              <div className="px-2.5">
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => update({ input: notAbsolute })}
                >
                  按 https:// 补全
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            <PartsTable analysis={analyzed.value} />

            <section className="px-2.5 py-2">
              <h3 className="mb-1 text-[11px] tracking-wide text-muted uppercase">路径分段</h3>
              {analyzed.value.pathSegments.length === 0 ? (
                <p className="text-[12px] text-muted">（无分段）</p>
              ) : (
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" data-testid="url-segments">
                  {analyzed.value.pathSegments.map((segment, index) => (
                    <li
                      key={`${index}-${segment.raw}`}
                      className="code-text rounded-sm bg-surface-2 px-1.5 py-0.5"
                      title={segment.decoded}
                    >
                      {segment.encoded ? `${segment.raw} → ${segment.decoded}` : segment.raw}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="px-2.5 py-2">
              <h3 className="mb-1 text-[11px] tracking-wide text-muted uppercase">
                查询参数（{analyzed.value.params.length}）
              </h3>
              {analyzed.value.params.length === 0 ? (
                <p className="text-[12px] text-muted">（无查询参数）</p>
              ) : (
                <table className="w-full border-collapse text-left text-[12px]" data-testid="url-params">
                  <thead>
                    <tr className="text-muted">
                      <th className="border-b border-border py-1 pr-3 font-normal">键</th>
                      <th className="border-b border-border py-1 font-normal">值（原始 / 解码）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyzed.value.params.map((param, index) => (
                      <tr key={`${index}-${param.key.raw}`}>
                        <td className="border-b border-border/60 py-1 pr-3 align-top">
                          <TextValue text={param.key} label={`参数键 ${param.key.raw}`} />
                        </td>
                        <td className="border-b border-border/60 py-1 align-top">
                          <TextValue text={param.value} label={`参数值 ${param.value.raw}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )
      }
      status={
        analyzed === null ? (
          <span>等待输入</span>
        ) : !analyzed.ok ? (
          <span className="text-danger">{analyzed.error}</span>
        ) : (
          <span>
            绝对 URL · 路径 {analyzed.value.pathSegments.length} 段 · 参数{' '}
            {analyzed.value.params.length} 个
          </span>
        )
      }
    />
  )
}
```

> **`TextValue` 里那个 `<span className="sr-only">{label}</span>` 是有用的**：`key` / `value` 的原始形式可能是空串或纯符号，测试与读屏都需要一个稳定的可读标签。空串分支已提前返回，不会走到这里。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run --project ui src/tools/web/url-analyzer/Tool.test.tsx > /tmp/p3-t9.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-t9.log`

Expected: PASS，10 个用例全绿。

- [ ] **Step 6: 提交**

```bash
git add src/tools/web/url-analyzer
git commit -m "feat(web): URL 分析器工具（tasks 7.9）"
```

---

### Task 10: 覆盖核对与本计划验收

对应 `tasks.md` **7.1–7.9** 的收口。**本任务不做阶段守卫**（`comet guard build`）：第 5、8 组仍由计划②-1 / ②-4 承接，此处只保证「本计划范围内全部闭合、无回归」。

**Files:**
- Modify: `openspec/changes/it-toolbox-app/tasks.md`（7.1–7.9 由 `- [ ]` 改为 `- [x]`）

- [ ] **Step 1: 逐条核对 spec 覆盖**

对 `specs/web-tools/spec.md` 的 4 个 Requirement 逐条数：

| Requirement | Scenario 数 | 对应用例位置 |
|---|---|---|
| URL 编码与解码 | 7 | `core/web/url-codec.test.ts`（12 例）+ `tools/web/url-codec/Tool.test.tsx`（10 例） |
| JSON 差异比较 | 9 | `core/web/json-diff.test.ts`（18 例）+ `tools/web/json-diff/Tool.test.tsx`（10 例） |
| JWT 解析器 | 9 | `core/web/jwt.test.ts`（20 例）+ `tools/web/jwt-parser/Tool.test.tsx`（11 例） |
| URL 分析器 | 8 | `core/web/url-analyzer.test.ts`（21 例）+ `tools/web/url-analyzer/Tool.test.tsx`（10 例） |

Run: `grep -c '^#### Scenario' openspec/changes/it-toolbox-app/specs/web-tools/spec.md`

Expected: `33`。若数字不同，说明 spec 已被修改，需按 comet-build 的「Spec 增量更新」重新分级处理。

- [ ] **Step 2: 全量测试**

Run: `npx vitest run > /tmp/p3-verify.log 2>&1; echo "exit=$?"; grep -E "Test Files|Tests |FAIL" /tmp/p3-verify.log`

Expected: exit=0，`core` 与 `ui` 两个 project 全绿；`registry.test.ts` 的「不存在任何注册问题」保持通过（4 个新工具被 glob 正确发现，`listByCategory('web')` 返回 4 条）。

- [ ] **Step 3: 类型检查与静态检查**

Run: `npm run typecheck > /tmp/p3-type.log 2>&1; echo "typecheck=$?"; npx eslint src > /tmp/p3-lint.log 2>&1; echo "lint=$?"`

Expected: 两者均为 0。

- [ ] **Step 4: 构建产物与外发扫描**

Run: `npm run build > /tmp/p3-build.log 2>&1; echo "exit=$?"; tail -20 /tmp/p3-build.log`

Expected: exit=0，`[scan-egress] 通过：产物中未发现外发能力。`。`core/web/*` 只做字符串处理，不应新增任何远程 URL 字面量。

- [ ] **Step 5: 勾选 tasks.md**

把 `openspec/changes/it-toolbox-app/tasks.md` 中 7.1–7.9 共 9 条改为 `- [x]`。

Run: `grep -n '^- \[ \] 7\.' openspec/changes/it-toolbox-app/tasks.md`

Expected: 无输出（全部已勾选）。

- [ ] **Step 6: 提交**

```bash
git add openspec/changes/it-toolbox-app/tasks.md
git commit -m "chore(web): 勾选 tasks.md 第 7 组（7.1–7.9）"
```

---

## 收尾提示（给执行者）

1. **本计划的 10 个任务全部完成后**，`tasks.md` 第 7 组应 100% 闭合；第 5 组（crypto）与第 8 组（图片 / 开发）仍未闭合，`comet guard build` 会失败 —— 这是预期行为，不要提前跑守卫、不要提前把 `phase` 改成 `verify`。
2. **Task 1 是唯一一处「补做已勾选任务」**：`core/json/parse.ts` 是 `tasks.md` 8.9 明确要求的文件，但仓库里不存在。补齐它不等于重开第 8 组 —— 第 8 组只剩 8.1–8.7。
3. **不要改动 `core/json/scanner.ts` / `minify.ts` / `format.ts`**：它们是第 8 组的交付物，可能正被另一路会话编辑。本计划只消费 `scanner.ts`。
4. `npm test` 失败时**先看 `registry.test.ts`**：新工具的 `meta.id` 与目录名不一致、`category` 拼错、`keywords` 为空都会在那里以具体目录名报出来。
5. 三个「反直觉」点最容易踩：`url.searchParams` 会立即解码（拿不到原始形式，必须手工切分 `url.search`）；`decodeURI` 只解码非保留字符（与 `decodeURIComponent` 不同）；`ErrorInfo.line/column` 是 1 基而 `offset` 是 0 基。

---

## 执行记录（2026-09-16，与上述草稿的差异）

本计划的 10 个任务已全部落地并通过验收，**代码是最终事实来源**；下列差异是对上面草稿片段的修正，重跑本计划时以仓库代码为准。

**验收实测**：

| 项 | 结果 |
|---|---|
| `src/core/web` + `src/core/json/parse.test.ts` | 5 文件 / **98 用例全绿** |
| `src/tools/web`（4 个工具） | 4 文件 / **43 用例全绿** |
| `npx vitest run`（全仓库） | 52 文件 / **613 用例全绿** |
| `npm run typecheck` | 通过 |
| `npx eslint src` | 通过 |
| `npm run build` | 通过，`[scan-egress] 通过：产物中未发现外发能力。`（6 处远程 URL 字面量告警全部非致命） |
| spec Scenario | **33** 条，4 个 Requirement 的每条均有对应用例 |

### 草稿里的真 bug（已修正，重跑务必照改）

1. **`parseJsonValue` 少解一层**：草稿写 `return parsed.ok ? ok(parsed.value) : parsed`，其中 `parsed.value` 是整个 `ParsedJson`（`{ value, tokens }`）。这一处让 json-diff 与 jwt 的测试**全线飘红**（98 个用例里挂了 80 多个），因为下游拿到的是包装对象而不是解析结果。正确写法是 `ok(parsed.value.value)`。
2. **`parse.test.ts` 的偏移断言**：`'{\n  "a": 1\n'` 的 `offset` 是 **11**（`scanner` 在跳过尾部空白后按 `pos === text.length` 报 `UNCLOSED`），不是草稿写的 10。
3. **`explicitPortOf` 缺失**：草稿用 `url.port === '' ? null : url.port` 取显式端口，但 URL 规范会把协议的默认端口归一化掉（`new URL('https://a.com:443/').port` 是空串），于是「显式写了 443」与「没写端口」根本分不开，草稿里那条用例必然失败。实际实现改为从原始字符串的 authority 段取端口：

   ```ts
   function explicitPortOf(input: string, protocol: string): string | null {
     const rest = input.slice(protocol.length).replace(/^\/\//, '')
     const authority = rest.split(/[/?#]/)[0] ?? ''
     const hostPart = authority.slice(authority.lastIndexOf('@') + 1) // 去掉 userinfo
     if (hostPart.startsWith('[')) {
       const closing = hostPart.indexOf(']') // IPv6 字面量：[::1]:8080
       if (closing === -1) return null
       const tail = hostPart.slice(closing + 1)
       if (!tail.startsWith(':')) return null
       const port = tail.slice(1)
       return /^\d+$/.test(port) ? port : null
     }
     const colon = hostPart.lastIndexOf(':')
     if (colon === -1) return null
     const port = hostPart.slice(colon + 1)
     return /^\d+$/.test(port) ? port : null
   }
   ```

   同时补了两条用例覆盖 IPv6 的两个分支（有端口 / 无端口），以及一条 `file://`（无默认端口表的协议）。

### 实施时做的其他调整

4. **`getAllByRole` 断言 0 条会抛错**：json-diff 的「无差异」用例里，`expect(rows()).toHaveLength(0)` 失败 —— `getAllByRole` 在找不到任何元素时直接抛 `TestingLibraryElementError`。改用 `queryAllByRole`。
5. **json-diff 的初始状态改为空 + 增加「填入示例」**：草稿把示例 JSON 放进 `INITIAL_STATE`，导致「两侧都为空时展示空态」这条用例在首次渲染就失败（初始就有内容）。改为与其余工具一致：初始为空，示例由按钮注入。
6. **json-diff 的结果区定位方式**：草稿给了两个选项，实际采用**不改框架**的那个 —— `screen.getByText('差异结果').closest('section')` + `within(...)`。`Pane` 渲染的 `<section>` 没有 `aria-labelledby`，不会暴露 `region` role，`getByRole('region', { name })` 必然找不到。
7. **JWT 状态栏不再重复过期状态**：草稿的状态栏文案含「已过期 / 有效期内」，与概览区的横幅撞词，会让 `getByText(/已过期/)` 因**匹配到多个元素**而抛错。实际状态栏只写 `3 段 · 算法 {alg}`，过期状态只在横幅里出现一次。
8. **JWT 横幅文案**改为「该令牌已过期（已过期 X）」「该令牌仍在有效期内（剩余 X）」「该令牌未声明过期时间（载荷中没有 exp）」，三种状态各自可被唯一正则命中。
9. **`INITIAL_STATE.options` 为空对象可被接受**：`useToolState` 的状态形状只要求 `options` 存在，jwt-parser 与 url-analyzer 都没有参数，声明为 `{}` 即可通过类型检查。
10. **注册表影响**：新增 4 个 `category: 'web'` 工具后，`registry.test.ts` 只断言了 `listByCategory('image')` 为空、`App.test.tsx` 只断言 `listTools()[0]` 是 UUID 生成器，**均不受影响**；`CommandPalette.test.tsx` 的 3 条选项来自 mock 清单，同样不受影响。

### 已知的非致命噪声

`npm run build` 的 `scan-egress` 会报出 2 处**来自本计划**的远程 URL 字面量告警：`url-analyzer` 的 `SAMPLE` 常量与 `CodeArea` 的 placeholder 各含 `https://example.com/...`。这两处是「URL 分析器」这个工具本身必须展示的示例地址（`example.com` 是 RFC 2606 保留域名，不指向任何真实主机），扫描结论仍是「未发现外发能力」。**不要**为了消掉这两条告警去放宽 `SKIP_PATH` 或改写示例。

### 未做（按系统约束有意跳过）

各任务的 `git commit` 步骤未执行 —— 提交需用户明确指示。全部改动仍在工作区。

### 与前序/后续计划的关系

- Task 1 补齐的 `core/json/parse.ts` 是 `tasks.md` **8.9 已经勾选但仓库里不存在的交付物**。它不改动 `scanner.ts` / `minify.ts` / `format.ts`，因此不与并发的第 8 组工作冲突；补齐后 8.9 的「接入 json-diff、jwt 载荷」这两个使用点才真正成立（`json→yaml` 走的是自己的 `scanJson` 调用，本次未改，留待第 8 组收口）。
- 第 7 组闭合后，`tasks.md` 只剩第 5 组（crypto）与第 8 组（图片 / 开发）未完成，`comet guard build` 会如期失败。
