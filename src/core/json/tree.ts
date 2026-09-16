import { ok } from '../result'
import type { Result } from '../result'
import { parseJson } from './parse'
import {
  JSON_TYPE_LABEL,
  TYPE_HINT_MAX_DEPTH,
  jsonChildPath,
  jsonIndexPath,
  typeOf,
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

export function buildJsonTree(text: string): Result<JsonTreeModel> {
  const parsed = parseJson(text)
  if (!parsed.ok) return parsed

  const tokens = parsed.value.tokens
  let cursor = 0
  let nodeCount = 0

  // 文本已通过 RFC 8259 校验，token 形状与值结构必然对齐；越界读取兜成空串，
  // 只为不让界面吃到异常（值驱动与 token 驱动一旦错位，宁可少上一点色）。
  const rawAt = (index: number): string => tokens[index]?.raw ?? ''

  const skipIf = (raw: string): void => {
    if (rawAt(cursor) === raw) cursor++
  }

  /**
   * 只在达到深度上限时使用：把整棵子树的 token 消费掉，**停在匹配的闭合符之前**
   * —— 调用方随后那一次 `cursor++` 负责收尾。若在此处吞掉闭合符，父层分隔符
   * 判断会错位，后面所有节点的 raw 都会串位。
   */
  const skipSubtree = (): void => {
    let depth = 0
    while (cursor < tokens.length) {
      const raw = rawAt(cursor)
      // 深度为 0 时遇到的闭合符就是本节点自己那一个：先停手，收尾交给调用方的 cursor++
      if ((raw === '}' || raw === ']') && depth === 0) return
      cursor++
      if (raw === '{' || raw === '[') depth++
      else if (raw === '}' || raw === ']') depth--
    }
  }

  const walk = (
    value: unknown,
    key: string | number | null,
    path: string,
    depth: number,
  ): JsonTreeNode => {
    const type = typeOf(value)
    const startIndex = cursor
    nodeCount++

    const children: JsonTreeNode[] = []
    let childCount = 0

    if (type === 'object') {
      const record = value as Record<string, unknown>
      const keys = Object.keys(record)
      childCount = keys.length
      cursor++ // '{'
      if (depth < TREE_MAX_DEPTH) {
        for (const childKey of keys) {
          cursor++ // 键字符串
          cursor++ // ':'
          children.push(walk(record[childKey], childKey, jsonChildPath(path, childKey), depth + 1))
          skipIf(',')
        }
      } else {
        skipSubtree()
      }
      cursor++ // '}'
    } else if (type === 'array') {
      const items = value as unknown[]
      childCount = items.length
      cursor++ // '['
      if (depth < TREE_MAX_DEPTH) {
        for (let index = 0; index < items.length; index++) {
          children.push(walk(items[index], index, jsonIndexPath(path, index), depth + 1))
          skipIf(',')
        }
      } else {
        skipSubtree()
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

  const root = walk(parsed.value.value, null, '$', 0)

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
