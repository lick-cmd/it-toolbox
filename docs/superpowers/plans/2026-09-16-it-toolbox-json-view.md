# JSON 视图优化（语法高亮 + 可折叠树）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给全部只读 JSON 视图统一加上语法高亮，并给 JSON 美化工具加上可逐个折叠子项的树形视图。

**Architecture:** 树的构建走 **token 驱动** —— `parseJson` 一次同时给出值对象与 token 序列，两者按文档顺序并行推导：结构取自值，文本取自 token 原文切片，因此 `\u0041` 不会被规范化成 `A`，树形显示与源码视图逐字符一致，并顺带拿到每个节点的源码起止偏移。高亮由框架层新的只读视图 `JsonCode` 独占，直接消费 `scanJson` 的 token 流，零依赖。折叠状态是 JSONPath 集合，「哪些行可见」是纯函数，可在 node 工程里单测。

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind v4（CSS 变量令牌）+ Vitest（`core` / `ui` 两个 project）+ @testing-library/react + @testing-library/user-event

**Spec:**
- `openspec/changes/it-toolbox-app/specs/dev-tools/spec.md` → `### Requirement: JSON 树形视图`（8 条 Scenario）
- `openspec/changes/it-toolbox-app/specs/tool-registry/spec.md` → `### Requirement: JSON 只读视图的语法高亮`（4 条 Scenario）
- 任务对应 `openspec/changes/it-toolbox-app/tasks.md` 第 10 组（10.1–10.10，与本计划 Task 1–10 一一对应）

## Global Constraints

- **零新增运行时依赖**：不得引入 shiki / prism / highlight.js / lowlight 等任何着色库。理由有两条：应用要求离线可用，且 `scripts/scan-egress.mjs` 会扫描产物，引入这类会带外部资源的包等于自找门禁红灯。着色数据一律来自已有的 `core/json/scanner.ts`。
- **Core 层纪律**：`src/core/**` 是纯函数，不 import React / DOM / Tauri；所有可单测的逻辑都在 Core，`Tool.tsx` 里不写算法（`tool-registry` 的「算法逻辑位于 Core 层」Requirement）。
- **类型标签口径唯一**：一律取 `core/json/type-hints.ts` 的 `JSON_TYPE_LABEL`，不得另造一套文案（树上写「对象」、提示视图写「map」就是缺陷）。
- **递归深度上限沿用 `TYPE_HINT_MAX_DEPTH`（256）**，与提示视图、`json-diff` 同一口径；超深时不下钻但保留该节点本身。
- **截断必须显式提示**，不得静默：预览上限沿用 `MAX_PREVIEW_ROWS`（2000）这一族的口径。
- **视觉约定**：13px 正文 / 12.5px 等宽（`.code-text`）、圆角 3–4px、无阴影；颜色一律走 CSS 变量，`:root`（暗色，默认）与 `:root.light`（浅色）两套都要能读，禁止硬编码色值。
- **文本不变量**：高亮只改呈现。视图渲染出的字符序列必须与原文逐字符相等 —— 这也是 `tool-registry` 那条 Requirement 的 Scenario。
- **测试与提交**：TDD（先写失败用例）；core 用例跑 `--project core`，组件用例跑 `--project ui`；一个任务一次提交。

---

## 文件结构

```
src/core/json/
  tree.ts                       【新】token 驱动的树构建 + 可见行计算（纯函数）
  tree.test.ts                  【新】core 工程用例
src/framework/ui/
  JsonCode.tsx                  【新】只读 JSON 视图：token 着色 + 行号 + 失败降级
  JsonCode.test.tsx             【新】
  JsonTree.tsx                  【新】可折叠树：aria-expanded、摘要、全部展开/折叠
  JsonTree.test.tsx             【新】
  index.ts                      【改】导出两个新原语与其 props 类型
src/app/theme.css               【改】--json-* 变量（暗/浅两套）+ .json-code / .json-tree 样式
src/tools/dev/json-format/Tool.tsx        【改】三视图：JSON / 类型提示 / 树形
src/tools/dev/json-format/Tool.test.tsx   【改】
src/tools/dev/json-minify/Tool.tsx        【改】输出改用 JsonCode
src/tools/dev/json-minify/Tool.test.tsx   【改】
src/tools/web/jwt-parser/Tool.tsx         【改】Header / Payload 改用 JsonCode
src/tools/web/jwt-parser/Tool.test.tsx    【改】
src/tools/converter/yaml-to-json/Tool.tsx        【改】输出改用 JsonCode
src/tools/converter/yaml-to-json/Tool.test.tsx   【改】
openspec/changes/it-toolbox-app/tasks.md  【改】10.1–10.10 勾选
```

**为什么树与「可见行」都放 `core/json/tree.ts`**：二者是同一件事的两半 —— 构建决定节点，可见行决定渲染哪些节点，接口互锁且都要单测。拆两个文件只会让「折叠集合」在两个模块之间来回传。

**为什么高亮和树是两个组件**：`JsonCode` 是 JSON 文本的只读展示（5 处复用），`JsonTree` 是值的结构化展示（1 处）。它们的输入不同（字符串 vs 树模型），生命周期也不同（树要持有折叠状态），合在一起会得到一个两套模式的组件。

---

### Task 1: `core/json/tree.ts` 的树构建（对应 10.1）

**Files:**
- Create: `src/core/json/tree.ts`
- Test: `src/core/json/tree.test.ts`

**Interfaces:**
- Consumes: `parseJson(text): Result<ParsedJson>`（`ParsedJson = { value: unknown; tokens: readonly JsonToken[] }`）、`typeOf` / `JSON_TYPE_LABEL` / `jsonChildPath` / `jsonIndexPath` / `TYPE_HINT_MAX_DEPTH`（`./type-hints`）、`JsonToken`（`./scanner`）、`ok` / `err`（`../result`）
- Produces: `JsonTreeNode`、`JsonTreeModel`、`buildJsonTree(text): Result<JsonTreeModel>`、`isContainer(node): boolean`、`keyText(node): string`、`valueText(node, expanded): string`、常量 `TREE_MAX_DEPTH` / `TREE_AUTO_COLLAPSE_NODES` / `TREE_MAX_VISIBLE_ROWS`

- [ ] **Step 1: 写失败用例**

创建 `src/core/json/tree.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildJsonTree, keyText, valueText, type JsonTreeNode } from './tree'
import { parseJson } from './parse'
import { collectTypeHints, jsonChildPath } from './type-hints'

/** 用例里反复要「按 path 找节点」，单独抽出来避免每处都写一遍递归 */
function nodeAt(root: JsonTreeNode, path: string): JsonTreeNode | null {
  if (root.path === path) return root
  for (const child of root.children) {
    const found = nodeAt(child, path)
    if (found !== null) return found
  }
  return null
}

describe('buildJsonTree', () => {
  it('标量取原文切片，不做规范化', () => {
    const built = buildJsonTree('{"escaped":"\\u0041","expo":1e2,"slash":"a\\/b"}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(nodeAt(built.value.root, '$.escaped')?.raw).toBe('"\\u0041"')
    expect(nodeAt(built.value.root, '$.expo')?.raw).toBe('1e2')
    expect(nodeAt(built.value.root, '$.slash')?.raw).toBe('"a\\/b"')
  })

  it('容器原文是整段源码（含内部空白）', () => {
    const text = '{\n  "a": [1,\n2]\n}'
    const built = buildJsonTree(text)
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(built.value.root.raw).toBe(text)
    expect(nodeAt(built.value.root, '$.a')?.raw).toBe('[1,\n2]')
  })

  it('推导 JSONPath 与深度', () => {
    const built = buildJsonTree('{"a":[{"b":1}]}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const leaf = nodeAt(built.value.root, '$.a[0].b')
    expect(leaf?.depth).toBe(3)
    expect(leaf?.type).toBe('number')
    expect(leaf?.label).toBe('数字')
  })

  it('折叠摘要给出元素个数，空容器如实显示', () => {
    const built = buildJsonTree('{"o":{"x":1,"y":2},"a":[1,2,3],"eo":{},"ea":[]}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(nodeAt(built.value.root, '$.o')?.summary).toBe('{…} 2 键')
    expect(nodeAt(built.value.root, '$.a')?.summary).toBe('[…] 3 项')
    expect(nodeAt(built.value.root, '$.eo')?.summary).toBe('{}')
    expect(nodeAt(built.value.root, '$.ea')?.summary).toBe('[]')
  })

  it('每个值一个节点，键不单独成节点', () => {
    const built = buildJsonTree('{"a":1,"b":{"c":2}}')
    expect(built.ok).toBe(true)
    if (!built.ok) return
    // {"a":1,"b":{"c":2}} → $ 、$.a 、$.b 、$.b.c
    expect(built.value.nodeCount).toBe(4)
  })

  it('非法输入返回带定位的错误，不抛异常', () => {
    const built = buildJsonTree('{"a":}')
    expect(built.ok).toBe(false)
    if (built.ok) return
    // scanner 的错误文案不含固定的「值」字（「值」只出现在 UNCLOSED 分支的 detail 里），
    // 这里只钉「有错误文案 + 有行号」，不绑具体文案。
    expect(built.error).not.toBe('')
    expect(typeof built.line).toBe('number')
  })

  it('超深嵌套不下钻也不抛异常', () => {
    const deep = '['.repeat(300) + ']'.repeat(300)
    const built = buildJsonTree(deep)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    // 下钻到上限即止，但节点本身仍在
    expect(nodeAt(built.value.root, '$[0]') !== null).toBe(true)
  })

  it('深度超限时，被跳过的子树不会让祖先原文串位', () => {
    // 上限那一层的内容分别是空容器、标量与「含内层容器 + 尾随标量」：
    // 都不以单个开括号一路配平，正是「跳过子树时按括号配对」最容易数错的情形。
    for (const source of [
      '['.repeat(257) + '{}' + ']'.repeat(257),
      '['.repeat(257) + '1' + ']'.repeat(257),
      '['.repeat(257) + '[1],2' + ']'.repeat(257),
    ]) {
      const built = buildJsonTree(source)
      expect(built.ok).toBe(true)
      if (!built.ok) return

      // 根节点的原文必须还是整段源码，不能被下游串位污染
      expect(built.value.root.raw).toBe(source)

      // 到达上限的那一层仍然建了节点；它的下一层被跳过，不建节点
      const capped = `$${'[0]'.repeat(256)}`
      expect(nodeAt(built.value.root, capped)?.raw).toBe(`[${source.slice(257, -257)}]`)
      // nodeAt 的签名是 JsonTreeNode | null，取不到时返回 null（不是 undefined）
      expect(nodeAt(built.value.root, `${capped}[0]`)).toBeNull()
    }
  })

  it('键序跟源码走，不跟 Object.keys 的整数键重排', () => {
    const built = buildJsonTree('{"1":"x","0":"y"}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(built.value.root.raw).toBe('{"1":"x","0":"y"}')
    // 子节点顺序 = 源码顺序
    expect(built.value.root.children.map((child) => child.key)).toEqual(['1', '0'])
    // 每个键配到的原文是它自己那一对
    expect(nodeAt(built.value.root, jsonChildPath('$', '1'))?.raw).toBe('"x"')
    expect(nodeAt(built.value.root, jsonChildPath('$', '0'))?.raw).toBe('"y"')
  })

  it('重复键不吞掉后面的 token', () => {
    const built = buildJsonTree('{"a":1,"a":2}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(built.value.root.raw).toBe('{"a":1,"a":2}')
    expect(built.value.root.childCount).toBe(2)
  })

  it('重复键形态不同时不抛异常，各配自己那一对的原文与类型', () => {
    // 每一对各自成节点：raw 与 type 都取自**它自己那一对**的 token。
    // 若按「键 → 解析值」下钻，重复键只剩最后一个值，下钻就会按错误形状消费 token。
    for (const [source, raws, types] of [
      ['{"a":1,"a":[2]}', ['1', '[2]'], ['number', 'array']],
      ['{"a":[2],"a":1}', ['[2]', '1'], ['array', 'number']],
    ] as const) {
      const built = buildJsonTree(source)
      expect(built.ok).toBe(true)
      if (!built.ok) return

      expect(built.value.root.raw).toBe(source)
      expect(built.value.root.childCount).toBe(2)
      expect(built.value.root.children.map((child) => child.raw)).toEqual([...raws])
      expect(built.value.root.children.map((child) => child.type)).toEqual([...types])
    }
  })

  it('重复键形态不同时，祖先原文不串位', () => {
    const source = '{"a":1,"a":[]}'
    const built = buildJsonTree(source)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.value.root.raw).toBe(source)
    // 第一对是数字 1，不能被第二对的数组形状带偏（按解析值下钻时这里会拿到 '1,'）
    expect(nodeAt(built.value.root, '$.a')?.raw).toBe('1')
  })

  it('上限层的 childCount 与可下钻层同口径', () => {
    // 同一个「含重复键的对象」形状：低于上限时按源码里的实际键对数算，
    // 达到上限时也必须一样 —— 不能因为不下钻就退回 Object.keys（重复键会被折叠成 1）。
    const plain = buildJsonTree('{"a":1,"a":2}')
    expect(plain.ok).toBe(true)
    if (!plain.ok) return
    expect(plain.value.root.childCount).toBe(2)

    const cappedObject = '['.repeat(256) + '{"a":1,"a":2}' + ']'.repeat(256)
    const built = buildJsonTree(cappedObject)
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const capped = `$${'[0]'.repeat(256)}`
    const node = nodeAt(built.value.root, capped)
    expect(node?.type).toBe('object')
    expect(node?.childCount).toBe(2)
    expect(node?.summary).toBe('{…} 2 键')
    // 它的子层不再建节点（已到上限）
    expect(nodeAt(built.value.root, `${capped}[0]`)).toBeNull()
  })

  it('类型口径与 collectTypeHints 逐节点一致', () => {
    // 无重复键的文档：本树与类型提示必须给出同一套「路径 → 类型 / 标签」，一一对应。
    const source = '{"a":1,"b":"x","c":[true,null],"d":{},"e":false}'
    const parsed = parseJson(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const built = buildJsonTree(source)
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const hints = new Map(collectTypeHints(parsed.value.value).map((hint) => [hint.path, hint]))
    const nodes: JsonTreeNode[] = []
    const collect = (node: JsonTreeNode): void => {
      nodes.push(node)
      for (const child of node.children) collect(child)
    }
    collect(built.value.root)

    expect(nodes.length).toBe(hints.size)
    for (const node of nodes) {
      expect(hints.get(node.path)?.type).toBe(node.type)
      expect(hints.get(node.path)?.label).toBe(node.label)
    }
  })
})

describe('keyText / valueText', () => {
  it('根用 $，对象键带冒号，数组下标用方括号', () => {
    const built = buildJsonTree('{"a":[1]}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(keyText(built.value.root)).toBe('$')
    const arrayNode = nodeAt(built.value.root, '$.a')
    const element = nodeAt(built.value.root, '$.a[0]')
    expect(arrayNode === null ? '' : keyText(arrayNode)).toBe('a:')
    expect(element === null ? '' : keyText(element)).toBe('[0]')
  })

  it('容器展开显示起始括号，折叠显示摘要', () => {
    const built = buildJsonTree('{"a":{"x":1}}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const inner = nodeAt(built.value.root, '$.a')
    expect(inner === null ? '' : valueText(inner, true)).toBe('{')
    expect(inner === null ? '' : valueText(inner, false)).toBe('{…} 1 键')
  })
})
```

- [ ] **Step 2: 跑用例确认失败**

Run: `npx vitest run --project core src/core/json/tree.test.ts`
Expected: FAIL —— `Failed to resolve import "./tree"`。

- [ ] **Step 3: 实现 `src/core/json/tree.ts` 的构建部分**

创建 `src/core/json/tree.ts`：

```ts
import { ok } from '../result'
import type { Result } from '../result'
import { parseJson } from './parse'
import type { JsonToken } from './scanner'
import {
  JSON_TYPE_LABEL,
  TYPE_HINT_MAX_DEPTH,
  jsonChildPath,
  jsonIndexPath,
} from './type-hints'
import type { JsonValueType } from './type-hints'

/**
 * JSON 值树。
 *
 * 与 `TypeHint` 的关键差别：`TypeHint` 是一条扁平的「路径 + 类型」，
 * 回答「有哪些值」；本树回答「值长什么样、怎么折叠」，因此每个节点都带
 * **原文切片** `raw`。切片直接取自 token 的 `raw`（扫描阶段就保留了原文），
 * 所以 `\u0041` 不会变成 `A`、`1e2` 不会变成 `100` —— 树形视图与源码视图
 * 对同一份输入给出的字符序列完全一致。若改成从值对象反序列化，这条不变量
 * 会在「美化工具默认保留转义字面量」这条既有约定上出现肉眼可见的偏差。
 */
export interface JsonTreeNode {
  /** JSONPath，根为 `$` */
  path: string
  /** 对象键；数组元素为下标；根为 null */
  key: string | number | null
  type: JsonValueType
  /** 与类型提示视图同源的标签文案 */
  label: string
  /** 原文切片：标量为该 token，容器为整段源码（含内部空白） */
  raw: string
  childCount: number
  /** 折叠时展示的摘要；标量为空串 */
  summary: string
  depth: number
  children: readonly JsonTreeNode[]
}

export interface JsonTreeModel {
  root: JsonTreeNode
  nodeCount: number
  /**
   * 默认需要折叠的容器路径。
   *
   * 节点数超过阈值时给出 depth ≥ 1 的全部容器路径，等价于「只展开第一层」：
   * 大输入下真正的成本在 DOM 行数，而不是树本身，先折叠再让用户按需展开
   * 比事后截断更符合预期（截断会让人以为数据缺了）。
   */
  collapsedByDefault: readonly string[]
}

/** 与提示视图、json-diff 同口径：深嵌套在 JavaScriptCore 上会栈溢出 */
export const TREE_MAX_DEPTH = TYPE_HINT_MAX_DEPTH
/** 超过这么多节点就默认只展开第一层 */
export const TREE_AUTO_COLLAPSE_NODES = 2000
/** 单次渲染的可见行上限 */
export const TREE_MAX_VISIBLE_ROWS = 2000

/** 可折叠 = 非空容器。空 `{}` / `[]` 没有可折叠的内容，给个开关只会骗人 */
export function isContainer(node: JsonTreeNode): boolean {
  return (node.type === 'object' || node.type === 'array') && node.childCount > 0
}

export function keyText(node: JsonTreeNode): string {
  if (node.key === null) return '$'
  return typeof node.key === 'number' ? `[${node.key}]` : `${node.key}:`
}

export function valueText(node: JsonTreeNode, expanded: boolean): string {
  if (node.type === 'object') return expanded ? '{' : node.summary
  if (node.type === 'array') return expanded ? '[' : node.summary
  return node.raw
}

function collapsedSummary(type: JsonValueType, childCount: number): string {
  if (type === 'object') return childCount === 0 ? '{}' : `{…} ${childCount} 键`
  if (type === 'array') return childCount === 0 ? '[]' : `[…] ${childCount} 项`
  return ''
}

/**
 * 值类型直接由 token 判定。
 *
 * 不用 `typeOf(value)`：`JSON.parse` 把重复键折叠成最后一个值，于是「值的形状」与
 * 「源码里这一对的形状」会分家 —— `{"a":1,"a":[2]}` 的第一对明明是数字，按值判定
 * 却得到数组，下钻随即按数组的形状消费 token，游标越过 pair 边界。结构与类型都只
 * 看 token，这条不一致就不存在。标签仍取 `JSON_TYPE_LABEL`，与类型提示视图同口径。
 */
function typeFromToken(token: JsonToken | undefined): JsonValueType {
  if (token === undefined) return 'absent'
  if (token.raw === '{') return 'object'
  if (token.raw === '[') return 'array'
  if (token.kind === 'string') return 'string'
  if (token.kind === 'number') return 'number'
  if (token.raw === 'true' || token.raw === 'false') return 'boolean'
  if (token.raw === 'null') return 'null'
  return 'absent'
}

export function buildJsonTree(text: string): Result<JsonTreeModel> {
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed

  const tokens = parsed.value.tokens
  let cursor = 0
  let nodeCount = 0

  // 结构、类型与文本**全部取自 token**：源码里第 n 个 token 是唯一真相。
  // 值对象那条路（`Object.keys` / `record[key]`）做不到 —— 整数样键会被重排，
  // 重复键只留最后一个，按「解析值的形状」下钻就会越过 pair 边界。
  // 越界读取兜成空串，只为不让界面吃到异常。
  const rawAt = (index: number): string => tokens[index]?.raw ?? ''

  const skipIf = (raw: string): void => {
    if (rawAt(cursor) === raw) cursor++
  }

  /**
   * 达到深度上限时的收尾扫描：消费**整层** token，并数出本层的直接子项数。
   *
   * 「跳过」与「计数」合成一趟扫描，是为了让上限层的 `childCount` / `summary`
   * 与可下钻路径同口径 —— 否则同一份输入会因为是否达上限而给出不同的键数 / 项数。
   *
   * 停在本层自己的闭合符之前 —— 调用方随后那一次 `cursor++` 负责收尾。若在此处
   * 吞掉闭合符，父层分隔符判断会错位，后面所有节点的 raw 都会串位。
   *
   * 进入时游标在本层的**内容起点**（开括号已被消费），所以 depth 从 0 起算：
   * 内容里的元素若自带容器，其闭合符会把 depth 拉回 0，**回到 0 不再停手** ——
   * 只有「深度为 0 时遇到的闭合符」才是本层自己的收尾点。内容以非开括号开头
   * （空容器、标量）是常态，故这条判断必须放在消费 token 之前。
   */
  const skipLayer = (isArray: boolean): number => {
    let depth = 0
    let count = 0
    // 对象在 depth 0 上按「键 token」计数：值本身若是字符串，不能跟着一起数进去
    let expectKey = !isArray
    while (cursor < tokens.length) {
      const raw = rawAt(cursor)
      // 只有「本层自己的闭合符」会以 depth === 0 出现：停在它之前，收尾交给调用方
      if ((raw === '}' || raw === ']') && depth === 0) return count
      if (depth === 0) {
        if (isArray) {
          if (raw !== ',') count++
        } else if (expectKey) {
          count++
          expectKey = false
        } else if (raw === ',') {
          expectKey = true
        }
      }
      cursor++
      if (raw === '{' || raw === '[') depth++
      else if (raw === '}' || raw === ']') depth--
    }
    return count
  }

  const walk = (
    key: string | number | null,
    path: string,
    depth: number,
  ): JsonTreeNode => {
    const startIndex = cursor
    nodeCount++

    const type = typeFromToken(tokens[cursor])
    const children: JsonTreeNode[] = []
    let childCount = 0

    if (type === 'object') {
      cursor++ // '{'
      if (depth < TREE_MAX_DEPTH) {
        // 逐 token 前进：源码里第 n 对就建第 n 个节点，键序与原文都不经过值对象。
        // 重复键于是各自成节点、各配自己那一对的 raw 与类型（path 会相同，这是有意的：
        // 显示忠实于源码优先，不去编造后缀）。
        while (cursor < tokens.length && rawAt(cursor) !== '}') {
          const keyToken = tokens[cursor]
          // 键位置不是字符串 token，说明结构判断有误：停手保底，宁可少建节点也不吞异常
          if (keyToken?.kind !== 'string') break
          // 键 token 必是合法 JSON 字符串字面量（scanner 已校验转义），JSON.parse 只用来解码
          const childKey = JSON.parse(keyToken.raw) as string
          cursor++ // 键
          cursor++ // ':'
          children.push(walk(childKey, jsonChildPath(path, childKey), depth + 1))
          childCount++
          skipIf(',')
        }
      } else {
        childCount = skipLayer(false)
      }
      cursor++ // '}'
    } else if (type === 'array') {
      cursor++ // '['
      if (depth < TREE_MAX_DEPTH) {
        let index = 0
        while (cursor < tokens.length && rawAt(cursor) !== ']') {
          children.push(walk(index, jsonIndexPath(path, index), depth + 1))
          index++
          childCount++
          skipIf(',')
        }
      } else {
        childCount = skipLayer(true)
      }
      cursor++ // ']'
    } else {
      cursor++ // 标量
    }

    const endIndex = Math.max(startIndex, cursor - 1)
    return {
      path,
      key,
      type,
      label: JSON_TYPE_LABEL[type],
      raw: text.slice(tokens[startIndex]?.start ?? 0, tokens[endIndex]?.end ?? 0),
      childCount,
      summary: collapsedSummary(type, childCount),
      depth,
      children,
    }
  }

  const root = walk(null, '$', 0)

  return ok({
    root,
    nodeCount,
    collapsedByDefault:
      nodeCount > TREE_AUTO_COLLAPSE_NODES ? containerPathsFromDepth(root, 1) : [],
  })
}

/** 前序遍历收集 depth ≥ fromDepth 的容器路径 */
function containerPathsFromDepth(node: JsonTreeNode, fromDepth: number): string[] {
  const paths: string[] = []
  const visit = (current: JsonTreeNode): void => {
    if (isContainer(current) && current.depth >= fromDepth) paths.push(current.path)
    for (const child of current.children) visit(child)
  }
  visit(node)
  return paths
}
```

- [ ] **Step 4: 跑用例确认通过**

Run: `npx vitest run --project core src/core/json/tree.test.ts`
Expected: PASS（16 条）。

- [ ] **Step 5: 提交**

```bash
git add src/core/json/tree.ts src/core/json/tree.test.ts
git commit -m "feat(core): token 驱动的 JSON 值树（原文保真 + 折叠摘要）

- 结构取自值对象、文本取自 token 原文切片，保证 \u0041、1e2 这类写法在树里不被规范化
- 容器 raw 覆盖整段源码（含内部空白），为将来「跳到源码 / 源码内折叠」留出偏移
- 深度上限与 type-hints 同口径（256），超限时跳过整棵子树而不破坏 token 游标
- 节点数超 2000 时给出「只展开第一层」的默认折叠集合"
```

---

### Task 2: 可见行计算与大输入降级（对应 10.2）

**Files:**
- Modify: `src/core/json/tree.ts`
- Test: `src/core/json/tree.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `JsonTreeModel` / `JsonTreeNode` / `isContainer`
- Produces: `TreeRow`、`visibleRows(tree, collapsed, maxRows?): { rows: TreeRow[]; truncated: boolean }`、`collapseAllPaths(tree): string[]`

- [ ] **Step 1: 写失败用例**

在 `src/core/json/tree.test.ts` 末尾追加：

```ts
/** 造一个指定节点数的数组：n 个元素 → n + 1 个节点 */
function arrayOf(count: number): string {
  return `[${Array.from({ length: count }, (_, index) => index).join(',')}]`
}

describe('visibleRows', () => {
  it('默认全部展开时按前序给出每一行', () => {
    const built = buildJsonTree('{"a":[1,2]}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const { rows, truncated } = visibleRows(built.value, new Set())
    expect(rows.map((row) => row.node.path)).toEqual([
      '$',
      '$.a',
      '$.a[0]',
      '$.a[1]',
    ])
    expect(truncated).toBe(false)
  })

  it('折叠某节点后其子孙全部不可见，且只影响该节点', () => {
    const built = buildJsonTree('{"a":{"x":1},"b":2}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const { rows } = visibleRows(built.value, new Set(['$.a']))
    expect(rows.map((row) => row.node.path)).toEqual(['$', '$.a', '$.b'])
    expect(rows.find((row) => row.node.path === '$.a')?.expanded).toBe(false)
  })

  it('可折叠性与展开状态分开表达', () => {
    const built = buildJsonTree('{"o":{"x":1},"e":{},"s":"v"}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const byPath = new Map(visibleRows(built.value, new Set()).rows.map((row) => [row.node.path, row]))
    expect(byPath.get('$.o')?.expandable).toBe(true)
    expect(byPath.get('$.e')?.expandable).toBe(false) // 空对象没有可折叠内容
    expect(byPath.get('$.s')?.expandable).toBe(false)
  })

  it('超过行数上限时截断并如实标记', () => {
    const built = buildJsonTree(arrayOf(50))
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const { rows, truncated } = visibleRows(built.value, new Set(), 10)
    expect(rows).toHaveLength(10)
    expect(truncated).toBe(true)
  })

  it('大输入默认只展开第一层', () => {
    // 每个元素都是单元素数组：2010 个元素 → 1 + 2010 × 2 个节点，越过自动折叠阈值
    const big = `[${Array.from(
      { length: TREE_AUTO_COLLAPSE_NODES + 10 },
      (_, index) => `[${index}]`,
    ).join(',')}]`
    const built = buildJsonTree(big)
    expect(built.ok).toBe(true)
    if (!built.ok) return

    // depth ≥ 1 的容器全部进入默认折叠集合（根留着，否则界面只剩一行 $）
    expect(built.value.collapsedByDefault).toHaveLength(TREE_AUTO_COLLAPSE_NODES + 10)
    expect(built.value.collapsedByDefault.slice(0, 2)).toEqual(['$[0]', '$[1]'])

    const { rows, truncated } = visibleRows(built.value, new Set(built.value.collapsedByDefault), 10)
    expect(rows.slice(0, 3).map((row) => row.node.path)).toEqual(['$', '$[0]', '$[1]'])
    expect(rows).toHaveLength(10)
    expect(truncated).toBe(true)
  })
})

describe('与类型提示的口径一致', () => {
  it('树的前序类型标签序列与 collectTypeHints 完全一致', () => {
    const text = '{"a":[1,"s",true,null],"b":{"c":[]}}'
    const built = buildJsonTree(text)
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const treeLabels: string[] = []
    const visit = (node: JsonTreeNode): void => {
      treeLabels.push(node.label)
      for (const child of node.children) visit(child)
    }
    visit(built.value.root)

    const hintLabels = collectTypeHints(JSON.parse(text) as unknown).map((hint) => hint.label)
    expect(treeLabels).toEqual(hintLabels)
  })
})

describe('collapseAllPaths', () => {
  it('给出除根以外全部容器路径，供「全部折叠」使用', () => {
    const built = buildJsonTree('{"a":{"b":[1]}}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(collapseAllPaths(built.value).sort()).toEqual(['$.a', '$.a.b'])
  })
})
```

顶部 import 只**补新名字**，不要整块替换 —— `parseJson` / `collectTypeHints` / `jsonChildPath` 已在顶部（Task 1 的用例在用），漏掉它们会让既有用例直接编译不过。改完顶部应是：

```ts
import { describe, expect, it } from 'vitest'
import {
  TREE_AUTO_COLLAPSE_NODES,
  buildJsonTree,
  collapseAllPaths,
  keyText,
  valueText,
  visibleRows,
  type JsonTreeNode,
} from './tree'
import { parseJson } from './parse'
import { collectTypeHints, jsonChildPath } from './type-hints'
```

即：`./tree` 那条补 `TREE_AUTO_COLLAPSE_NODES` / `collapseAllPaths` / `visibleRows` 三个名字（大写常量在前、`type` 项在后，与仓库既有风格一致），另两条 import 保持原样。

- [ ] **Step 2: 跑用例确认失败**

Run: `npx vitest run --project core src/core/json/tree.test.ts`
Expected: FAIL —— `visibleRows is not a function`（或 import 解析失败）。

- [ ] **Step 3: 实现可见行与全部折叠**

在 `src/core/json/tree.ts` 末尾追加：

```ts
export interface TreeRow {
  node: JsonTreeNode
  /** 该节点是否可以折叠（非空容器） */
  expandable: boolean
  /** 当前是否处于展开态；不可折叠的节点恒为 false */
  expanded: boolean
}

/**
 * 按折叠状态算出要渲染的行。
 *
 * 只遍历展开路径是树形视图能扛住大输入的原因：折叠节点的子孙根本不进入这次
 * 遍历，也就不会产生 DOM。超过 `maxRows` 时停下并如实标记 `truncated` ——
 * 界面必须把「还有内容没显示」讲出来。
 */
export function visibleRows(
  tree: JsonTreeModel,
  collapsed: ReadonlySet<string>,
  maxRows: number = TREE_MAX_VISIBLE_ROWS,
): { rows: TreeRow[]; truncated: boolean } {
  const rows: TreeRow[] = []
  let truncated = false

  const visit = (node: JsonTreeNode): void => {
    if (rows.length >= maxRows) {
      truncated = true
      return
    }
    const expandable = isContainer(node)
    const expanded = expandable && !collapsed.has(node.path)
    rows.push({ node, expandable, expanded })
    if (expanded) {
      for (const child of node.children) visit(child)
    }
  }

  visit(tree.root)
  return { rows, truncated }
}

/** 「全部折叠」：除根以外全部容器（根留着，否则界面只剩一行 `$`） */
export function collapseAllPaths(tree: JsonTreeModel): string[] {
  return containerPathsFromDepth(tree.root, 1)
}
```

- [ ] **Step 4: 跑用例确认通过**

Run: `npx vitest run --project core src/core/json/tree.test.ts`
Expected: PASS（23 条）。

- [ ] **Step 5: 提交**

```bash
git add src/core/json/tree.ts src/core/json/tree.test.ts
git commit -m "feat(core): 树的可见行计算与大输入降级

- visibleRows 只遍历展开路径，折叠节点的子孙不产生行，这是大输入可用的前提
- 超过行数上限时截断并返回 truncated 标记，界面据此给出提示而不是静默省略
- collapseAllPaths 复用 containerPathsFromDepth，与「默认只展开第一层」同一口径"
```

---

### Task 3: `framework/ui/JsonCode.tsx` 只读 JSON 视图（对应 10.3）

**Files:**
- Create: `src/framework/ui/JsonCode.tsx`
- Test: `src/framework/ui/JsonCode.test.tsx`

**Interfaces:**
- Consumes: `scanJson(value): ScanResult`、`JsonToken`（`@/core/json/scanner`）
- Produces: `JsonCode`（props：`value: string`、`label?: string`、`className?: string`）、`JsonCodeProps`；渲染结构：外层 `[data-testid="json-code"]`，每行内容列 `[data-testid="json-code-line"]`

**关键取舍：内容列不补空格。** `CodeArea` 在空行上渲染 `' '`，那会让「渲染文本 === 原文」这条不变量在空行处失败。行高由行号列的文字撑起，不需要填充字符。

- [ ] **Step 1: 写失败用例**

创建 `src/framework/ui/JsonCode.test.tsx`：

```tsx
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { JsonCode } from './JsonCode'

/** 内容列按行取出 —— 行号列不能混进来，否则「与原文相等」无从验证 */
function linesOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid="json-code-line"]')).map(
    (node) => node.textContent ?? '',
  )
}

describe('JsonCode', () => {
  it('按 token 类别着色，且渲染文本与原文逐字符相等', () => {
    const value = '{"a":"\\u0041","n":1e2,"b":true,"z":null}'
    const { container } = render(<JsonCode value={value} />)

    // 键也是 string token：扫描器不区分键与值，两者都是引号开头的 string。
    // 故 4 个键（a/n/b/z）+ 1 个字符串值（"\u0041"）= 5。
    expect(container.querySelectorAll('.json-string')).toHaveLength(5)
    expect(container.querySelectorAll('.json-number')).toHaveLength(1)
    expect(container.querySelectorAll('.json-literal')).toHaveLength(2) // true 与 null
    expect(linesOf(container).join('\n')).toBe(value)
  })

  it('保留转义原文，不规范化', () => {
    const { container } = render(<JsonCode value={'{"e":"\\u0041"}'} />)
    expect(container.textContent).toContain('\\u0041')
    expect(container.textContent).not.toContain('"A"')
  })

  it('多行输入按行渲染且带行号', () => {
    const value = '{\n  "a": 1\n}'
    const { container } = render(<JsonCode value={value} />)
    expect(linesOf(container)).toHaveLength(3)
    expect(linesOf(container).join('\n')).toBe(value)
    // 行号列是每行 `li` 的第一个子元素；`2` 只能来自那里，不是被内容里的数字碰巧满足
    expect(
      Array.from(container.querySelectorAll('li')).map((row) => row.firstElementChild?.textContent),
    ).toEqual(['1', '2', '3'])
  })

  it('空行渲染为空串，不补填充字符', () => {
    const value = '{\n\n  "a": 1\n\n}'
    const { container } = render(<JsonCode value={value} />)

    // 5 行：`{` / 空 / `  "a": 1` / 空 / `}`
    expect(linesOf(container)).toHaveLength(5)
    // 直接钉住失效形态：给空行补 `' '` 就会让这两条立刻变红
    expect(linesOf(container)[1]).toBe('')
    expect(linesOf(container)[3]).toBe('')
    // 且整体仍与原文逐字符相等（原文里那两个空行就是什么都没有）
    expect(linesOf(container).join('\n')).toBe(value)
  })

  it('无法解析时降级为纯文本，不抛异常也不上色', () => {
    const { container } = render(<JsonCode value={'{"a":}'} />)
    expect(container.querySelector('.json-string')).toBeNull()
    expect(linesOf(container).join('\n')).toBe('{"a":}')
  })

  it('空内容显示空态', () => {
    const { container } = render(<JsonCode value="" />)
    expect(container.textContent).toContain('（空）')
  })
})
```

- [ ] **Step 2: 跑用例确认失败**

Run: `npx vitest run --project ui src/framework/ui/JsonCode.test.tsx`
Expected: FAIL —— `Failed to resolve import "./JsonCode"`。

- [ ] **Step 3: 实现组件**

创建 `src/framework/ui/JsonCode.tsx`：

```tsx
import { useMemo } from 'react'
import { scanJson } from '@/core/json/scanner'
import type { JsonToken } from '@/core/json/scanner'

export interface JsonCodeProps {
  value: string
  label?: string
  className?: string
}

interface Segment {
  text: string
  /** 空串表示不着色（空白与换行） */
  className: string
}

const KIND_CLASS: Record<JsonToken['kind'], string> = {
  string: 'json-string',
  number: 'json-number',
  literal: 'json-literal',
  punct: 'json-punct',
}

/**
 * 只读 JSON 视图：token 流着色。
 *
 * 着色数据全部来自 `scanJson` —— 它本来就要为「错误定位」逐 token 扫描一遍，
 * 这里只是把同一份扫描结果画出来，因此不引入任何着色依赖（离线与产物扫描
 * 都不受影响），也不会出现「解析器说合法、着色器说非法」的两套判断。
 *
 * 文本不变量：所有片段拼起来必须等于 `value`。故空隙（空白、换行、结尾）
 * 原样保留为不着色片段，且**不添加任何填充字符** —— 空行的高度由行号列撑起。
 */
export function JsonCode({ value, label, className }: JsonCodeProps) {
  const lines = useMemo(() => toLines(toSegments(value)), [value])

  return (
    <div
      data-testid="json-code"
      className={['code-text relative min-h-0 overflow-auto', className ?? ''].join(' ')}
    >
      {label && <span className="sr-only">{label}</span>}
      {value.length === 0 ? (
        <p className="p-2.5 text-muted">（空）</p>
      ) : (
        <ol className="m-0 list-none p-0">
          {lines.map((line, index) => (
            <li key={`${index}-${line.length}`} className="flex gap-2.5 px-2.5">
              <span className="w-9 shrink-0 text-right text-muted select-none">{index + 1}</span>
              <span data-testid="json-code-line" className="whitespace-pre-wrap break-all">
                {line.map((segment, segmentIndex) => (
                  // 片段下标必须入 key：同一行内相同标点（如多个 `:`）的 className+text 会重复，
                  // 只用后两者会让 React 报「Encountered two children with the same key」。
                  <span
                    key={`${segmentIndex}-${segment.className}-${segment.text}`}
                    className={segment.className || undefined}
                  >
                    {segment.text}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function toSegments(value: string): Segment[] {
  const scanned = scanJson(value)
  // 降级：JWT 载荷解析失败、工具恢复历史内容等场景都会走到这里，必须能正常显示
  if (!scanned.ok) return value.length === 0 ? [] : [{ text: value, className: '' }]

  const segments: Segment[] = []
  let pos = 0

  for (const token of scanned.tokens) {
    if (token.start > pos) segments.push({ text: value.slice(pos, token.start), className: '' })
    segments.push({ text: token.raw, className: KIND_CLASS[token.kind] })
    pos = token.end
  }
  if (pos < value.length) segments.push({ text: value.slice(pos), className: '' })

  return segments
}

/** 按换行拆行。JSON 字符串里不可能出现裸换行（scanner 已拒控制字符），故拆分不会切碎 token */
function toLines(segments: readonly Segment[]): Segment[][] {
  const lines: Segment[][] = []
  let current: Segment[] = []

  for (const segment of segments) {
    const parts = segment.text.split('\n')
    for (let index = 0; index < parts.length; index++) {
      if (index > 0) {
        lines.push(current)
        current = []
      }
      // 先取出再判空：`noUncheckedIndexedAccess` 下 `parts[index]` 是 `string | undefined`，
      // 且 `index` 是可变的 `let`，`parts[index] !== ''` 无法把后续的 `parts[index]` 收窄为
      // `string`，内联写法会报 TS2322。`split('\n')` 的元素必为字符串，故判 undefined 不改变行为。
      const part = parts[index]
      if (part !== undefined && part !== '') {
        current.push({ text: part, className: segment.className })
      }
    }
  }

  lines.push(current)
  return lines
}
```

- [ ] **Step 4: 跑用例确认通过**

Run: `npx vitest run --project ui src/framework/ui/JsonCode.test.tsx`
Expected: PASS（6 条）。

- [ ] **Step 5: 提交**

```bash
git add src/framework/ui/JsonCode.tsx src/framework/ui/JsonCode.test.tsx
git commit -m "feat(ui): 只读 JSON 视图 JsonCode（token 着色 + 解析失败降级）

- 着色数据复用 scanJson 的 token 流，不引入任何着色依赖（离线与产物扫描都不受影响）
- 空隙原样保留且不加填充字符，保证「渲染文本 === 原文」，空行高度交给行号列
- 无法解析时整体降级为等宽纯文本，界面不因着色而报错"
```

---

### Task 4: `theme.css` 的 JSON 配色与样式（对应 10.4）

**Files:**
- Modify: `src/app/theme.css`
- Test: `src/app/theme.test.tsx`（新建）

**Interfaces:**
- Produces: CSS 变量 `--json-key` / `--json-string` / `--json-number` / `--json-literal` / `--json-punct`；样式类 `.json-key`、`.json-object`、`.json-array`、`.json-string`、`.json-number`、`.json-literal`、`.json-punct`、`.json-type`、`.json-tree-toggle`

- [ ] **Step 1: 在既有 `:root`（暗色）与 `:root.light`（浅色）块内各追加 5 行变量**

`src/app/theme.css` 中 `:root { … --app-warn: …; }` 块末尾追加：

```css
  /* JSON 着色：语义对齐 VS Code 暗色主题，深浅两套各自取可读值 */
  --json-key: #9cdcfe;
  --json-string: #ce9178;
  --json-number: #b5cea8;
  --json-literal: #569cd6;
  --json-punct: var(--app-muted);
```

`:root.light { … }` 块末尾追加：

```css
  --json-key: #0451a5;
  --json-string: #a31515;
  --json-number: #098658;
  --json-literal: #0000ff;
  --json-punct: #6b7280;
```

- [ ] **Step 2: 在文件末尾追加样式类**

```css
/* JSON 着色与树形视图 */
.json-key,
.json-object,
.json-array {
  color: var(--json-key);
}

.json-string {
  color: var(--json-string);
}

.json-number {
  color: var(--json-number);
}

.json-literal {
  color: var(--json-literal);
}

.json-punct {
  color: var(--json-punct);
}

.json-type {
  color: var(--app-muted);
  font-size: 11px;
}

.json-tree-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding-right: 10px;
}

.json-tree-toggle {
  width: 12px;
  flex: none;
  color: var(--app-muted);
  font-size: 11px;
  line-height: 1.4;
}

.json-tree-toggle:hover {
  color: var(--app-fg);
}
```

- [ ] **Step 3: 给这份纯 CSS 加钉子**

**为什么需要**：本任务没有任何自动化验证 —— 三种最可能的坏法都能让四道门禁全绿：① `var(--json-string)` 引用名拼错（或写成 `--json-strings`）→ 该 token 静默不着色；② 某个类漏写规则 → 那类 token 无色；③ 浅色块漏定义某个变量 → 浅色模式回退成暗色值。**jsdom 不加载外部 CSS，computed style 断言不可靠**，所以钉子只能是「读文件 + 渲染产物对照」。

创建 `src/app/theme.test.tsx`：

```ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { JsonCode } from '@/framework/ui/JsonCode'

// 相对本文件定位 theme.css。不要写成 `new URL('./theme.css', import.meta.url)`：该字面量
// 形态会被 Vite 的 asset-import-meta-url 转换静态改写为 dev server 的 http 地址（jsdom 工程
// 实测得到 http://localhost:3000/src/app/theme.css），readFileSync 会报 scheme file 错误。
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'theme.css'), 'utf8')
const lines = css.split('\n')

/** 取 `:root {` / `:root.light {` 块内文本，收到该块自己的 `}` 为止 */
function blockOf(selector: string): string {
  const start = lines.findIndex((line) => line.trim() === `${selector} {`)
  expect(start, `theme.css 缺少 ${selector} {`).toBeGreaterThanOrEqual(0)
  const end = lines.findIndex((line, index) => index > start && line.trim() === '}')
  return lines.slice(start + 1, end).join('\n')
}

/** 全部「出现在 `{` 之前」的类选择器名 —— 分组选择器（`.a,\n.b {`）也能取到 */
function declaredClasses(): Set<string> {
  // `!`：分组一定存在（`([^{}]*)` 允许空串），故 `noUncheckedIndexedAccess` 下的 undefined 不可达；
  // 与 `src/tools/crypto/ulid-generator/Tool.test.tsx` 的 `match[1]!` 同法。
  const names = [...css.matchAll(/([^{}]*)\{/g)].flatMap((rule) =>
    [...rule[1]!.matchAll(/\.(json-[a-z-]+)/g)].map((match) => match[1]!),
  )
  return new Set(names)
}

const JSON_VARS = ['--json-key', '--json-string', '--json-number', '--json-literal', '--json-punct']

describe('theme.css 的 JSON 配色', () => {
  it.each([':root', ':root.light'])('%s 里 5 个 --json-* 变量齐备', (selector) => {
    const body = blockOf(selector)
    for (const name of JSON_VARS) expect(body, `${selector} 缺少 ${name}`).toContain(`${name}:`)
  })

  it('每个 var(--json-*) 引用都有对应的变量定义', () => {
    const defined = new Set([...css.matchAll(/(--json-[a-z-]+)\s*:/g)].map((match) => match[1]))
    const referenced = [...css.matchAll(/var\((--json-[a-z-]+)\)/g)].map((match) => match[1])
    expect(referenced.length).toBeGreaterThan(0) // 防止改名后正则失配、断言空转
    for (const name of referenced) expect(defined, `引用了未定义的 ${name}`).toContain(name)
  })

  it('JsonCode 实际渲染出的每个着色类都有规则', () => {
    // 从渲染产物反查，而不是手抄一份类名清单：改组件时这条会自己跟上
    const { container } = render(<JsonCode value={'{"a":"b","c":1,"d":true,"e":null}'} />)
    const used = new Set(
      Array.from(container.querySelectorAll('[data-testid="json-code-line"] span'))
        .map((node) => node.className)
        .filter((name) => name.startsWith('json-')),
    )
    expect(used.size).toBeGreaterThan(0) // 一个类都没渲染时不许静默通过
    for (const name of used) expect(declaredClasses(), `theme.css 缺少 .${name} 的规则`).toContain(name)
  })
})
```

**证明它有牙齿（mutation）**：写完用例跑一遍确认 PASS 后，**临时**把 `theme.css` 里 `.json-number` 那条规则删掉，再跑一次 —— 「JsonCode 实际渲染出的每个着色类都有规则」这条**必须变红**且失败信息点名 `json-number`；随后把 CSS 完整还原并**用 sha256 / blob 哈希复核**（**不要**用 `git checkout -- src/app/theme.css`：此时该文件是未提交改动，checkout 会把 Step 1/2 一起回退）。把这段红输出贴进报告。

已实测的红输出形态（可作期望值）：`AssertionError: theme.css 缺少 .json-number 的规则: expected [ 'json-key', 'json-object', …(7) ] to include 'json-number'` —— 注意这条信息**顺带自证了 `declaredClasses()` 确实取到了分组选择器里的 `json-key`/`json-object`/`json-array`**（否则它们不会出现在这个数组里），即「正则被弱化而静默空转」这一隐患也被间接钉住。

- [ ] **Step 4: 确认样式没写坏既有页面 + 新用例全绿**

Run: `npx vitest run --project ui src/app`
Expected: PASS（`theme.test.tsx` 新用例 + app 层既有用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add src/app/theme.css src/app/theme.test.tsx
git commit -m "style(theme): JSON 着色变量与树形视图样式（深浅两套）

- --json-* 五个变量同时定义在 :root（暗色默认）与 :root.light，禁止硬编码色值
- 树形行的缩进与折叠开关样式；折叠开关可点区域与 hover 反馈对齐既有按钮
- 补 theme.test.tsx 钉子：变量双主题齐备、var(--json-*) 引用可解析、组件渲染出的类都有规则"
```

---

### Task 5: `framework/ui/JsonTree.tsx` 可折叠树（对应 10.5）

**Files:**
- Create: `src/framework/ui/JsonTree.tsx`
- Test: `src/framework/ui/JsonTree.test.tsx`
- Modify: `src/app/theme.test.tsx`（补 JsonTree 侧的着色类对照断言）

**Interfaces:**
- Consumes: `JsonTreeModel`、`buildJsonTree`、`visibleRows`、`collapseAllPaths`、`isContainer`、`keyText`、`valueText`、`TREE_MAX_VISIBLE_ROWS`（`@/core/json/tree`）
- Produces: `JsonTree`（props：`tree: JsonTreeModel`、`label?: string`、`maxRows?: number`）、`JsonTreeProps`；每个行 `[data-testid="json-tree-row"]`，折叠开关为带 `aria-expanded` 的 `<button>`

- [ ] **Step 1: 写失败用例**

创建 `src/framework/ui/JsonTree.test.tsx`：

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { buildJsonTree, type JsonTreeModel } from '@/core/json/tree'
import { JsonTree } from './JsonTree'

function treeOf(text: string): JsonTreeModel {
  const built = buildJsonTree(text)
  if (!built.ok) throw new Error(built.error)
  return built.value
}

function rowTexts(): string[] {
  return Array.from(document.querySelectorAll('[data-testid="json-tree-row"]')).map(
    (row) => row.textContent ?? '',
  )
}

describe('JsonTree', () => {
  it('默认展开全部节点并展示类型标签', () => {
    render(<JsonTree tree={treeOf('{"a":{"b":1}}')} />)
    expect(rowTexts()).toHaveLength(3) // $ 、$.a 、$.a.b
    expect(screen.getByText('数字')).toBeTruthy()
  })

  it('折叠某个子项后其子孙消失，并显示含元素个数的摘要', async () => {
    const user = userEvent.setup()
    render(<JsonTree tree={treeOf('{"a":{"b":1,"c":2},"d":3}')} />)

    await user.click(screen.getByRole('button', { name: '折叠 $.a' }))

    expect(rowTexts()).toHaveLength(3) // $ 、$.a（折叠态）、$.d（同级不受折叠影响，仍在）
    expect(screen.getByText('{…} 2 键')).toBeTruthy()
    expect(screen.getByRole('button', { name: '展开 $.a' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('折叠状态按节点独立，互不影响', async () => {
    const user = userEvent.setup()
    render(<JsonTree tree={treeOf('{"a":{"b":1},"c":{"d":2}}')} />)

    await user.click(screen.getByRole('button', { name: '折叠 $.a' }))
    await user.click(screen.getByRole('button', { name: '折叠 $.c' }))
    await user.click(screen.getByRole('button', { name: '展开 $.a' }))

    expect(screen.getByRole('button', { name: '展开 $.c' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: '折叠 $.a' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('全部折叠后除根以外全部收起，全部展开后恢复', async () => {
    const user = userEvent.setup()
    render(<JsonTree tree={treeOf('{"a":{"b":1},"c":2}')} />)

    await user.click(screen.getByRole('button', { name: '全部折叠' }))
    expect(rowTexts()).toHaveLength(3) // $ 、$.a（折叠态）、$.c

    await user.click(screen.getByRole('button', { name: '全部展开' }))
    expect(rowTexts()).toHaveLength(4)
  })

  it('空对象不是可折叠节点，不给开关', () => {
    render(<JsonTree tree={treeOf('{"e":{}}')} />)
    expect(screen.queryByRole('button', { name: '折叠 $.e' })).toBeNull()
    expect(screen.getByText('{}')).toBeTruthy()
  })

  it('重复键如实渲染成两行，不因 path 相同而少画一行', () => {
    // 树层有意让重复键各自成节点（path 相同），界面必须照画两行：
    // 少画一行就等于替用户删了一个他源码里写着的数据。
    render(<JsonTree tree={treeOf('{"a":1,"a":2}')} />)
    expect(rowTexts()).toHaveLength(3) // $ 、两行 $.a
    expect(rowTexts().filter((text) => text.includes('a:'))).toHaveLength(2)
  })

  it('大输入默认只展开第一层，并如实提示渲染上限', () => {
    // 2010 个单元素数组：节点数越过自动折叠阈值，默认只展开根这一层
    const big = `[${Array.from({ length: 2010 }, (_, index) => `[${index}]`).join(',')}]`
    render(<JsonTree tree={treeOf(big)} maxRows={20} />)

    expect(screen.getByText(/仅渲染前 20 行/)).toBeTruthy()
    expect(rowTexts()).toHaveLength(20)
    // 默认折叠下，子数组只有一行摘要，没有展开的子孙
    expect(document.querySelectorAll('[data-testid="json-tree-row"]')[1]?.textContent).toContain(
      '[…] 1 项',
    )
  })
})
```

- [ ] **Step 2: 跑用例确认失败**

Run: `npx vitest run --project ui src/framework/ui/JsonTree.test.tsx`
Expected: FAIL —— `Failed to resolve import "./JsonTree"`。

- [ ] **Step 3: 实现组件**

创建 `src/framework/ui/JsonTree.tsx`：

```tsx
import { useEffect, useState } from 'react'
import {
  TREE_MAX_VISIBLE_ROWS,
  collapseAllPaths,
  keyText,
  valueText,
  visibleRows,
  type JsonTreeNode,
  type JsonTreeModel,
} from '@/core/json/tree'

export interface JsonTreeProps {
  tree: JsonTreeModel
  label?: string
  /** 只渲染前 N 行，默认 TREE_MAX_VISIBLE_ROWS */
  maxRows?: number
}

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

/**
 * 值类型 → 着色类名。
 *
 * 与 `JsonCode` 的 `KIND_CLASS` 同口径，且这里**必须**显式映射、不能写 `` `json-${node.type}` ``：
 * 树的值类型来自 `type-hints` 的 `JsonValueType`，比 scanner 的 token 类别更细 —— 字面量在
 * 那里叫 `literal`（`true`/`false`/`null` 共一类），在树里却分成 `boolean` 与 `null` 两项。
 * 直接拼类名会渲染出 `theme.css` 里根本没有的 `.json-boolean` / `.json-null`，结果是这两个
 * 值在树视图里**静默不着色**（与源码视图不一致），而所有文本断言都照样通过。
 * `absent` 不可达（树只从解析成功的 token 流构建），兜到同一类名只为不造出无规则的类名。
 */
const TYPE_CLASS: Record<JsonTreeNode['type'], string> = {
  object: 'json-object',
  array: 'json-array',
  string: 'json-string',
  number: 'json-number',
  boolean: 'json-literal',
  null: 'json-literal',
  absent: 'json-literal',
}

/**
 * 可折叠的 JSON 树。
 *
 * 折叠状态用 JSONPath 集合表达并按节点独立记录（spec：折叠互不影响），
 * 因此文档换了才回到默认折叠态；同一份文档内容变化不该把用户的手动折叠抹掉。
 * 「渲染哪些行」交给 core 的 `visibleRows`，组件只负责画与交互 —— 于是
 * 折叠语义可以在 node 工程里单测，不必依赖 DOM。
 *
 * 折叠态按 path 记录，于是源码里有重复键时（`{"a":1,"a":2}`）这两个节点会**一起**
 * 折叠/展开：它们本就同名，没有更细的粒度可用。这是「优先忠实显示源码」的代价，
 * 与 `core/json/tree.ts` 里重复键不加后缀是同一条裁定。
 */
export function JsonTree({ tree, label, maxRows }: JsonTreeProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(tree.collapsedByDefault),
  )

  useEffect(() => {
    setCollapsed(new Set(tree.collapsedByDefault))
  }, [tree.root.raw, tree.collapsedByDefault])

  const { rows, truncated } = visibleRows(tree, collapsed, maxRows ?? TREE_MAX_VISIBLE_ROWS)

  const toggle = (path: string): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div data-testid="json-tree" className="min-h-0 overflow-auto">
      {label && <span className="sr-only">{label}</span>}

      <div className="flex items-center justify-between gap-2 border-b border-border px-1.5 py-1">
        <span className="text-[11px] text-muted">{tree.nodeCount} 个值</span>
        <span className="flex items-center gap-1">
          <button type="button" className={BUTTON} onClick={() => setCollapsed(new Set())}>
            全部展开
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => setCollapsed(new Set(collapseAllPaths(tree)))}
          >
            全部折叠
          </button>
        </span>
      </div>

      {truncated && (
        <p className="border-b border-border px-2.5 py-1 text-[12px] text-warn">
          共 {tree.nodeCount} 个值，仅渲染前 {maxRows ?? TREE_MAX_VISIBLE_ROWS} 行；
          收起一些节点即可看到后面的内容。
        </p>
      )}

      <ul className="m-0 list-none p-0 text-[12px]">
        {/* key 用行序号，**不能**用 node.path：源码里有重复键时树会给出两个 path 相同的
            节点（见 `core/json/tree.ts`），path 不是唯一键，React 会报重复 key 警告并在
            更新时错配 DOM。行是纯展示的、没有内部状态，序号键不会引起状态串位。 */}
        {rows.map(({ node, expandable, expanded }, index) => (
          <li
            key={index}
            data-testid="json-tree-row"
            className="json-tree-row"
            style={{ paddingLeft: 10 + node.depth * 14 }}
          >
            {expandable ? (
              <button
                type="button"
                className="json-tree-toggle"
                aria-expanded={expanded}
                aria-label={`${expanded ? '折叠' : '展开'} ${node.path}`}
                onClick={() => toggle(node.path)}
              >
                {expanded ? '▾' : '▸'}
              </button>
            ) : (
              <span className="json-tree-toggle" aria-hidden="true" />
            )}
            <span className="json-key">{keyText(node)}</span>
            <span className={TYPE_CLASS[node.type]}>{valueText(node, expanded)}</span>
            <span className="json-type">{node.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: 跑用例确认通过**

Run: `npx vitest run --project ui src/framework/ui/JsonTree.test.tsx`
Expected: PASS（7 条）。

- [ ] **Step 5: 在 `src/app/theme.test.tsx` 补 JsonTree 侧的着色类对照断言**

**为什么需要**：Task 4 的钉子只反查了 `JsonCode` 渲染出的类，于是 `.json-object` / `.json-array` / `.json-type` / `.json-tree-row` / `.json-tree-toggle` 这 5 个类**当时没有消费方、验证不了**；而树视图恰恰是它们唯一的消费方。这条断言顺带兜住本任务最容易犯的错 —— 见 Step 3 里 `TYPE_CLASS` 的注释：把值类型直接拼进类名会造出 `theme.css` 里不存在的 `.json-boolean` / `.json-null`，那两个值静默不着色，而所有文本断言照样全绿。

在 `src/app/theme.test.tsx` 的 `describe` 内追加：

```tsx
  it('JsonTree 实际渲染出的每个着色类都有规则', () => {
    // 树的值类型（boolean/null）比 token 类别（literal）更细，若组件直接把 node.type 拼进
    // 类名，就会渲染出 theme.css 里没有的 .json-boolean / .json-null —— 那两个值静默不着色。
    const built = buildJsonTree('{"s":"x","n":1,"b":true,"z":null,"o":{},"a":[]}')
    if (!built.ok) throw new Error(built.error)
    // 这份输入一次覆盖树会用到的全部 9 个类：根 object、空数组 array、四类标量、
    // 类型标签、行与折叠开关（空容器不给开关，故开关类由根提供）
    const { container } = render(<JsonTree tree={built.value} />)
    const used = new Set(
      Array.from(
        container.querySelectorAll('[data-testid="json-tree-row"], [data-testid="json-tree-row"] *'),
      )
        .map((node) => node.className)
        .filter((name) => name.startsWith('json-')),
    )
    // 写死 9：把「组件实际用到的类清单」与 Task 4 的 Produces 钉在一起。
    // 少了就说明组件拼错了类名（漏类不会让这条退化成只检查「渲染出的类都有规则」）
    expect(used).toHaveLength(9)
    for (const name of used) expect(declaredClasses(), `theme.css 缺少 .${name} 的规则`).toContain(name)
  })
```

同时在文件顶部补两条 import：

```tsx
import { buildJsonTree } from '@/core/json/tree'
import { JsonTree } from '@/framework/ui/JsonTree'
```

**证明它有牙齿（mutation）**：把 `JsonTree.tsx` 里 `boolean: 'json-literal'` 临时改回 `'json-boolean'`（即复现本任务原先那种「直接拼类名」的写法），跑 `npx vitest run --project ui src/app` —— 这条**必须变红**，失败信息应直指类名（`theme.css 缺少 .json-boolean 的规则`，以及 `used` 变成 10 个而期望 9）；随后完整还原（**用 sha256 / blob 哈希复核，不要用 `git checkout`** —— 该文件此时是未提交改动，checkout 会把整个实现一起回退）。把红输出贴进报告。

- [ ] **Step 6: 提交**

```bash
git add src/framework/ui/JsonTree.tsx src/framework/ui/JsonTree.test.tsx src/app/theme.test.tsx
git commit -m "feat(ui): 可折叠 JSON 树（逐个折叠 + 摘要 + 全部展开折叠）

- 折叠状态是 JSONPath 集合，按节点独立；文档换了才回到默认折叠态
- 只渲染展开路径上的行，超过上限如实提示，不静默截断
- 折叠开关带 aria-expanded 且可键盘触发；空容器不给开关（没有可折叠的内容）
- 值类型经 TYPE_CLASS 显式映射到着色类：boolean/null 与源码视图共用 json-literal，
  不直接拼接 json-node.type，否则会渲染出 theme.css 里没有的 .json-boolean / .json-null
- theme.test.tsx 补 JsonTree 侧对照断言，把 9 个类的类名清单钉住"
```

---

### Task 6: 从 `framework/ui/index.ts` 导出（对应 10.6）

**Files:**
- Modify: `src/framework/ui/index.ts`
- Test: `src/framework/ui/JsonCode.test.tsx`（追加一条 barrel 可用性用例）

**Interfaces:**
- Produces: `@/framework/ui` 桶导出 `JsonCode`、`JsonTree`、`JsonCodeProps`、`JsonTreeProps`

- [ ] **Step 1: 写失败用例**

在 `src/framework/ui/JsonCode.test.tsx` 末尾追加：

```tsx
import { JsonCode as JsonCodeFromBarrel, JsonTree as JsonTreeFromBarrel } from './index'

describe('framework/ui 桶导出', () => {
  it('两个新原语都能从 index 导入并渲染', () => {
    const { container } = render(<JsonCodeFromBarrel value={'{"a":1}'} />)
    expect(container.querySelector('.json-number')).toBeTruthy()

    const built = buildJsonTree('{"a":1}')
    if (!built.ok) throw new Error(built.error)
    render(<JsonTreeFromBarrel tree={built.value} />)
    expect(document.querySelector('[data-testid="json-tree"]')).toBeTruthy()
  })
})
```

同文件顶部补 import：

```tsx
import { buildJsonTree } from '@/core/json/tree'
```

- [ ] **Step 2: 跑用例确认失败**

Run: `npx vitest run --project ui src/framework/ui/JsonCode.test.tsx`
Expected: FAIL —— `JsonCode is not exported` / `undefined is not a valid component`。

- [ ] **Step 3: 补齐导出**

在 `src/framework/ui/index.ts` 中按字母序插入两行（与既有 `FileDrop` 那两行的写法一致）：

```ts
export { JsonCode } from './JsonCode'
export { JsonTree } from './JsonTree'
```

类型导出段插入：

```ts
export type { JsonCodeProps } from './JsonCode'
export type { JsonTreeProps } from './JsonTree'
```

- [ ] **Step 4: 跑用例确认通过**

Run: `npx vitest run --project ui src/framework/ui/JsonCode.test.tsx`
Expected: PASS（7 条：既有 6 条 + 桶导出 1 条）。

- [ ] **Step 5: 提交**

```bash
git add src/framework/ui/index.ts src/framework/ui/JsonCode.test.tsx
git commit -m "feat(ui): 从 framework/ui 导出 JsonCode 与 JsonTree

- 桶导出与 props 类型补齐，用例从 index 导入验证桶本身可用
- 各工具仍按既有习惯从具体文件导入，桶导出服务于跨层引用与后续复用"
```

---

### Task 7: 四处只读 JSON 视图改用 `JsonCode`（对应 10.7）

**Files:**
- Modify: `src/tools/dev/json-format/Tool.tsx`
- Modify: `src/tools/dev/json-minify/Tool.tsx`
- Modify: `src/tools/web/jwt-parser/Tool.tsx`
- Modify: `src/tools/converter/yaml-to-json/Tool.tsx`
- Test: 上述四个工具各自的 `Tool.test.tsx`

**Interfaces:**
- Consumes: `JsonCode`（Task 3）
- Produces: 四处只读 JSON 输出均为着色视图；输入区仍是 `CodeArea`（可编辑分支不变）

**改动点（逐处）**

1. `json-minify/Tool.tsx`：`<CodeArea value={result.value.output} readOnly label="压缩结果" />` → `<JsonCode value={result.value.output} label="压缩结果" />`；`CodeArea` 仍用于输入区，import 保留。
2. `yaml-to-json/Tool.tsx`：`<CodeArea value={converted.value} readOnly label="JSON 结果" />` → `<JsonCode value={converted.value} label="JSON 结果" />`。
3. `jwt-parser/Tool.tsx`：`PartView` 内 `<CodeArea value={json ?? ''} readOnly label={label} />` → `<JsonCode value={json ?? ''} label={label} />`（解析失败那支的 `<pre>` 不动）。
4. `json-format/Tool.tsx`：`<CodeArea value={preview?.text ?? ''} readOnly label="格式化结果" />` → `<JsonCode value={preview?.text ?? ''} label="格式化结果" />`，并把既有的截断提示补一句：

```tsx
{preview !== null && preview.total > MAX_PREVIEW_ROWS && (
  <p className="border-b border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-warn">
    输出共 {preview.total} 行，预览仅显示前 {MAX_PREVIEW_ROWS} 行；
    预览内容不完整，因此不参与语法着色（着色需要完整合法的 JSON）；
    复制与下载给的是完整内容。
  </p>
)}
```

- [ ] **Step 1: 先跑四个工具的现有用例，记下会因「文本被拆成多个 span」而失败的断言**

Run: `npx vitest run --project ui src/tools/dev/json-minify src/tools/converter/yaml-to-json src/tools/web/jwt-parser`
Expected: 全绿（此刻四处输出仍是 `CodeArea`，文本尚未被切分）。本任务的 RED 出现在**源码替换之后**：先跑出基线绿 → 替换组件 → 跑出红（典型形态是 `Unable to find an element with the text: {"alg": "HS256",`，整行原本是一个文本节点、现在被 token 切成多个 `<span>`）→ 修断言 → 再跑出绿。

- [ ] **Step 2: 逐处改造并修正断言**

断言从「找整行文本」改成「读内容列」：

```tsx
// 之前
expect(screen.getByText('{"a": 1}')).toBeTruthy()
// 之后（压缩结果只有一行，内容列即该行）
expect(screen.getByTestId('json-code-line').textContent).toBe('{"a":1}')
```

多处内容列并存时（例如 json-format 同时有输入与输出）用容器限定：

```tsx
const output = screen.getByTestId('json-code')
expect(output.querySelector('[data-testid="json-code-line"]')?.textContent).toBe('{')
```

先跑再改，不要预先重写断言：`json-minify` 与 `yaml-to-json` 里既有的 `lines()` 辅助函数（取每个 `li` 的最后一个子元素）在 `JsonCode` 下照样成立 —— `JsonCode` 同样按行渲染 `<li>`，内容列就是该行的最后一个子元素 —— 这两个文件大概率不用动。真正要改的只是把整行当成单个文本节点断言的地方（`getByText('{"a":1}')` 这一类）。

一处**有意的行为差异**：`CodeArea` 在空行上渲染一个空格，`JsonCode` 渲染空串（文本不变量要求渲染结果等于原文）。若某条断言依赖那个空格，按原文改断言，不要给组件加填充字符 —— 加了就破坏 spec 的「高亮不改变文本」。

同时在四个工具里各加一条最短断言，钉住「输出确实由框架层组件着色」（对应 `tool-registry` 的「统一的只读 JSON 视图」Scenario）——否则日后有人图省事改回 `CodeArea`，没有用例会拦：

```tsx
it('输出区由框架层着色视图呈现', () => {
  // …构造输入使输出出现
  expect(document.querySelector('[data-testid="json-code"] .json-string')).toBeTruthy()
})
```

- [ ] **Step 3: 跑四个工具的用例确认全绿**

Run: `npx vitest run --project ui src/tools/dev/json-minify src/tools/dev/json-format src/tools/web/jwt-parser src/tools/converter/yaml-to-json`
Expected: PASS。

- [ ] **Step 4: 跑全量确认没有连带影响**

Run: `npm test`
Expected: 全绿（`Test Files` 与 `Tests` 数字较上轮只增不减）。

- [ ] **Step 5: 提交**

```bash
git add src/tools/dev/json-format/Tool.tsx src/tools/dev/json-minify/Tool.tsx \
        src/tools/web/jwt-parser/Tool.tsx src/tools/converter/yaml-to-json/Tool.tsx \
        src/tools/dev/json-format/Tool.test.tsx src/tools/dev/json-minify/Tool.test.tsx \
        src/tools/web/jwt-parser/Tool.test.tsx src/tools/converter/yaml-to-json/Tool.test.tsx
git commit -m "feat(tools): 四处只读 JSON 输出接入 JsonCode 着色

- 美化 / 压缩 / JWT 的 Header 与 Payload / YAML→JSON 输出统一改由框架层着色
- 输入区仍是可编辑 CodeArea（裸 textarea 不高亮），未触碰共享原语的可编辑分支
- 美化工具预览被行数截断时明确提示不参与着色：着色要求完整合法的 JSON
- 受影响的断言从「整行文本」改为「内容列 textContent」，避免被 token 切分误伤"
```

---

### Task 8: JSON 美化工具的三视图（对应 10.8）

**Files:**
- Modify: `src/tools/dev/json-format/Tool.tsx`
- Test: `src/tools/dev/json-format/Tool.test.tsx`

**Interfaces:**
- Consumes: `buildJsonTree`（`@/core/json/tree`）、`JsonTree`（Task 5）
- Produces: `ViewChoice = 'json' | 'hints' | 'tree'`；视图切换控件多一个「树形」选项

- [ ] **Step 1: 写失败用例**

在 `src/tools/dev/json-format/Tool.test.tsx` 末尾追加（该文件顶部已 import `userEvent` 与 `vi`，不要重复写）：

```tsx
describe('树形视图', () => {
  it('切到树形后展示可折叠节点，折叠后显示摘要', async () => {
    const user = userEvent.setup()
    render(<JsonFormatTool />)

    await user.type(screen.getByLabelText('JSON 源码'), '{"a":{"b":1,"c":2}}')
    await user.click(screen.getByRole('button', { name: '树形' }))

    expect(document.querySelector('[data-testid="json-tree"]')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '折叠 $.a' }))
    expect(screen.getByText('{…} 2 键')).toBeTruthy()
  })

  it('树形视图同样给出复制与下载入口', async () => {
    const user = userEvent.setup()
    render(<JsonFormatTool />)

    await user.type(screen.getByLabelText('JSON 源码'), '{"a":1}')
    await user.click(screen.getByRole('button', { name: '树形' }))

    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '下载' })).toBeTruthy()
  })

  it('非法输入时树形视图显示错误而非节点', async () => {
    const user = userEvent.setup()
    render(<JsonFormatTool />)

    await user.type(screen.getByLabelText('JSON 源码'), '{"a":}')
    await user.click(screen.getByRole('button', { name: '树形' }))

    expect(document.querySelector('[data-testid="json-tree"]')).toBeNull()
    expect(screen.getByRole('alert')).toBeTruthy() // ErrorNote
  })

  it('空输入时树形视图显示空态', async () => {
    const user = userEvent.setup()
    render(<JsonFormatTool />)

    await user.click(screen.getByRole('button', { name: '树形' }))
    expect(screen.getByText('尚未输入')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 跑用例确认失败**

Run: `npx vitest run --project ui src/tools/dev/json-format/Tool.test.tsx`
Expected: FAIL —— 找不到名为「树形」的按钮。

- [ ] **Step 3: 实现三视图**

`src/tools/dev/json-format/Tool.tsx` 改动四处：

```tsx
// 1) 视图枚举与选项
type ViewChoice = 'json' | 'hints' | 'tree'

const VIEW_OPTIONS: readonly SelectOption<ViewChoice>[] = [
  { value: 'json', label: 'JSON' },
  { value: 'hints', label: '类型提示' },
  { value: 'tree', label: '树形' },
]
```

```tsx
// 2) 树只在切到该视图时构建：与类型提示同理，大输入下不该白花这份钱
const tree = useMemo(
  () => (view !== 'tree' || output === null ? null : buildJsonTree(input)),
  [view, output, input],
)
```

```tsx
// 3) 标题文案
<span className="text-[11px] text-muted">
  {view === 'hints' ? '逐值类型提示' : view === 'tree' ? '树形视图' : '格式化结果'}
</span>
// 4) 复制与下载在 JSON 与树形两个视图下都给出（文案一致，见 spec 的「复制与下载不受视图影响」）
{view !== 'hints' && (
  <span className="flex items-center gap-1">
    <CopyButton text={output ?? ''} label="复制" />
    <DownloadButton
      filename="formatted.json"
      text={output ?? ''}
      mime="application/json;charset=utf-8"
      label="下载"
    />
  </span>
)}
```

输出区渲染分支改成三支（视图所需的 `JsonTree` 与 `buildJsonTree` 记得 import）：

```tsx
{view === 'tree' ? (
  tree === null || !tree.ok ? (
    <p className="p-2.5 text-[12px] text-muted">（尚无可用结果）</p>
  ) : (
    <JsonTree tree={tree.value} label="树形视图" />
  )
) : view === 'hints' ? (
  hints.length === 0 ? (
    <p className="p-2.5 text-[12px] text-muted">（没有可提示的值）</p>
  ) : (
    <>
      {visibleHints.length < hints.length && (
        <p className="border-b border-border px-2.5 py-1 text-[12px] text-warn">
          共 {hints.length} 个值，仅显示前 {MAX_PREVIEW_ROWS} 个。
        </p>
      )}
      <ul className="m-0 list-none p-0 text-[12px]" data-testid="json-type-hints">
        {visibleHints.map((hint) => (
          <li
            key={`${hint.path}:${hint.type}`}
            className="flex flex-wrap items-baseline gap-2 border-b border-border/60 px-2.5 py-1 last:border-b-0"
          >
            <code className="code-text shrink-0">{hint.path}</code>
            <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 text-muted">{hint.label}</span>
            {hint.summary !== '' && <span className="text-muted">{hint.summary}</span>}
          </li>
        ))}
      </ul>
    </>
  )
) : (
  <>
    {preview !== null && preview.total > MAX_PREVIEW_ROWS && (
      <p className="border-b border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-warn">
        输出共 {preview.total} 行，预览仅显示前 {MAX_PREVIEW_ROWS} 行；
        预览内容不完整，因此不参与语法着色（着色需要完整合法的 JSON）；
        复制与下载给的是完整内容。
      </p>
    )}
    <JsonCode value={preview?.text ?? ''} label="格式化结果" />
  </>
)}
```

> 这段分支替换掉的正是 Task 7 里改过的那一段 —— 别把截断提示留成两份：以本块为准，删掉旧的那一份。
>
> `tree === null` 那条实际不会走到：输出区只在 `result.ok` 分支内渲染，空输入与非法输入由外层 `EmptyState` / `ErrorNote` 处理。保留它只是让类型收窄成立、并给未来的重构留个安全的兜底。

- [ ] **Step 4: 跑用例确认通过**

Run: `npx vitest run --project ui src/tools/dev/json-format/Tool.test.tsx`
Expected: PASS（原有用例 + 新增 4 条）。

- [ ] **Step 5: 提交**

```bash
git add src/tools/dev/json-format/Tool.tsx src/tools/dev/json-format/Tool.test.tsx
git commit -m "feat(tools): JSON 美化增加树形视图（源码 / 类型提示 / 树形）

- 树形视图与既有两个视图并列，切换时互不影响；树惰性构建，切到才建
- 复制与下载在树形视图下同样可用，给的是完整格式化原文
- 非法输入与空输入沿用既有错误与空态分支，不渲染任何节点"
```

---

### Task 9: 钉住两条不变量用例（对应 10.9）

**Files:**
- Test: `src/tools/dev/json-format/Tool.test.tsx`

**Interfaces:**
- Consumes: Task 8 的三视图实现

- [ ] **Step 1: 写用例**

在 `src/tools/dev/json-format/Tool.test.tsx` 追加：

```tsx
describe('树形与源码的一致性', () => {
  it('树形显示的标量与源码原文逐字符一致（转义不被规范化）', async () => {
    const user = userEvent.setup()
    render(<JsonFormatTool />)

    const input = '{"escaped":"\\u0041","expo":1e2}'
    await user.type(screen.getByLabelText('JSON 源码'), input)

    // 源码视图
    await user.click(screen.getByRole('button', { name: 'JSON' }))
    const sourceText = Array.from(document.querySelectorAll('[data-testid="json-code-line"]'))
      .map((line) => line.textContent ?? '')
      .join('\n')
    expect(sourceText).toContain('"\\u0041"')
    expect(sourceText).toContain('1e2')

    // 树形视图：同一个值必须还是原文，不能变成 "A" 或 100
    await user.click(screen.getByRole('button', { name: '树形' }))
    expect(screen.getByText('"\\u0041"')).toBeTruthy()
    expect(screen.getByText('1e2')).toBeTruthy()
    expect(screen.queryByText('"A"')).toBeNull()
  })

  it('复制与下载给的是完整原文，不含树形的装饰标记', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })

    render(<JsonFormatTool />)
    await user.type(screen.getByLabelText('JSON 源码'), '{"a":{"b":1}}')
    await user.click(screen.getByRole('button', { name: '树形' }))
    await user.click(screen.getByRole('button', { name: '复制' }))

    expect(writeText).toHaveBeenCalledWith('{\n  "a": {\n    "b": 1\n  }\n}')
  })
})
```

该文件顶部已是 `import { beforeEach, describe, expect, it, vi } from 'vitest'`，`vi` 无需再补（动手前确认一遍即可）。

- [ ] **Step 2: 跑用例确认通过**

Run: `npx vitest run --project ui src/tools/dev/json-format/Tool.test.tsx`
Expected: PASS（新增 2 条）。

> 若第一条用例在 `getByText('1e2')` 上失败，说明树的 `raw` 走了值对象（`100`）而不是 token 切片 —— 这正是本用例要拦住的回归，应回 Task 1 修实现而不是改断言。

- [ ] **Step 3: 提交**

```bash
git add src/tools/dev/json-format/Tool.test.tsx
git commit -m "test(tools): 钉住树形与源码逐字符一致、复制不受视图影响

- 转义与指数写法在源码视图与树形视图必须一致，防止树退回值对象渲染
- 树形视图下复制得到的仍是完整格式化原文，不含任何装饰标记"
```

---

### Task 10: 覆盖表核对与全量门禁（对应 10.10）

**Files:**
- Modify: `openspec/changes/it-toolbox-app/tasks.md`

- [ ] **Step 1: 把 12 条 Scenario 逐条落到具体 `it` 用例名**

`dev-tools` 的「JSON 树形视图」（8 条）与 `tool-registry` 的「JSON 只读视图的语法高亮」（4 条）都要有对应用例，写成表格记入本计划末尾的「执行记录」。缺哪条就补哪条，不许用「已覆盖」含糊过去。

其中 `tool-registry` 的「离线可用」不另立用例：它由「零新增运行时依赖」这条约束与 `npm run build` 里的 `scripts/scan-egress.mjs` 产物扫描共同保证，真实断网行为在 9.3 的实机冒烟里验。这类「环境构造不出来」的例外必须在执行记录里写明是例外而不是遗漏（`core/json/parse.ts` 的 `TOO_DEEP` 分支是同类先例）。

- [ ] **Step 2: 跑全量门禁**

```bash
npm test          # 期望：全绿，文件数 63 → 66（tree / JsonCode / JsonTree 三个新用例文件）
npm run typecheck # 期望：exit 0
npm run lint      # 期望：exit 0
npm run build     # 期望：exit 0（含 scripts/scan-egress.mjs 产物扫描）
```

- [ ] **Step 3: 勾选 tasks.md 第 10 组并提交**

```bash
git add openspec/changes/it-toolbox-app/tasks.md docs/superpowers/plans/2026-09-16-it-toolbox-json-view.md
git commit -m "docs(tasks): 第 10 组 JSON 视图优化完成（10.1–10.10）

- 12 条新 Scenario 逐条落到用例，覆盖表见计划内「执行记录」
- 全量门禁 test / typecheck / lint / build（含 egress 扫描）全绿"
```

---

## 执行记录

（执行时逐条填写：每条 Scenario → 具体 `it` 用例名、实测判定方式、关键发现与口径更正。）

