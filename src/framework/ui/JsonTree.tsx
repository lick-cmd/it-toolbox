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

  // 依赖只用文档原文：`buildJsonTree` 每次调用都返回**新的** `collapsedByDefault` 数组实例，
  // 依赖数组身份会让「无关重建」（父组件换了缩进之类、文档一个字没变）把用户的手动折叠抹掉。
  // 默认折叠态是文档的纯函数（由 nodeCount 与深度决定），文档没变就不该重置。
  useEffect(() => {
    setCollapsed(new Set(tree.collapsedByDefault))
  }, [tree.root.raw])

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
