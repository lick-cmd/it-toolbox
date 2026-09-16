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
