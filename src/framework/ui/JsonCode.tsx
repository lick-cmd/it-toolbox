import { useEffect, useMemo, useState } from 'react'
import {
  EMPTY_FOLD_MODEL,
  buildFoldModel,
  collapseAllFoldLines,
  foldSummary,
  hiddenLines,
} from '@/core/json/fold'
import { scanJson } from '@/core/json/scanner'
import type { JsonToken } from '@/core/json/scanner'

export interface JsonCodeProps {
  value: string
  label?: string
  className?: string
  /**
   * 渲染折叠开关与「全部展开 / 全部折叠」。
   *
   * 默认关闭：压缩结果、JWT 载荷这类一行就看完的文本，多一列开关只白白占宽度。
   * 打开后每行多出的开关列固定占位，故有开关的行与没有开关的行仍然对齐。
   */
  foldable?: boolean
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

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

const NOTHING_COLLAPSED: ReadonlySet<number> = new Set()

/**
 * 只读 JSON 视图：token 流着色。
 *
 * 着色数据全部来自 `scanJson` —— 它本来就要为「错误定位」逐 token 扫描一遍，
 * 这里只是把同一份扫描结果画出来，因此不引入任何着色依赖（离线与产物扫描
 * 都不受影响），也不会出现「解析器说合法、着色器说非法」的两套判断。
 *
 * 文本不变量：所有片段拼起来必须等于 `value`。故空隙（空白、换行、结尾）
 * 原样保留为不着色片段，且**不添加任何填充字符** —— 空行的高度由行号列撑起。
 * 折叠摘要同理只作为**兄弟节点**挂在行内容之外，不许混进行内容里。
 *
 * 折叠（`foldable`）只影响「画哪些行」：行号取自原文，故折叠之后行号会跳号
 * （折叠第 1 行后紧接第 5 行），与编辑器一致 —— 报数、定位仍以原文行号为准。
 */
export function JsonCode({ value, label, className, foldable = false }: JsonCodeProps) {
  const lines = useMemo(() => toLines(toSegments(value)), [value])
  const fold = useMemo(
    () => (foldable ? buildFoldModel(value) : EMPTY_FOLD_MODEL),
    [foldable, value],
  )
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(NOTHING_COLLAPSED)

  // 折叠态按行号记，而行号只对某一份文本有意义：文本换了就回到默认的全展开。
  // 与 `JsonTree` 同法（那里依据的是文档原文）。代价是换缩进也会重置 —— 输出整体
  // 重排后行号已不再指向同一批节点，硬留着折叠只会收起毫不相干的行。
  useEffect(() => {
    setCollapsed(NOTHING_COLLAPSED)
  }, [value])

  const hidden = useMemo(() => hiddenLines(fold, collapsed), [fold, collapsed])

  const toggle = (line: number): void => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return next
    })
  }

  return (
    <div
      data-testid="json-code"
      className={['code-text relative min-h-0 overflow-auto', className ?? ''].join(' ')}
    >
      {label && <span className="sr-only">{label}</span>}

      {fold.ranges.length > 0 && (
        <div
          data-testid="json-code-fold-bar"
          className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1"
        >
          <span className="text-[11px] text-muted">{fold.ranges.length} 处可折叠</span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              className={BUTTON}
              onClick={() => setCollapsed(NOTHING_COLLAPSED)}
            >
              全部展开
            </button>
            <button
              type="button"
              className={BUTTON}
              onClick={() => setCollapsed(new Set(collapseAllFoldLines(fold)))}
            >
              全部折叠
            </button>
          </span>
        </div>
      )}

      {value.length === 0 ? (
        <p className="p-2.5 text-muted">（空）</p>
      ) : (
        <ol className="m-0 list-none p-0">
          {lines.map((line, index) => {
            if (hidden.has(index)) return null

            const range = fold.byOpenLine.get(index)
            const folded = range !== undefined && collapsed.has(index)

            return (
              <li key={`${index}-${line.length}`} className="flex gap-2.5 px-2.5">
                <span className="w-9 shrink-0 text-right text-muted select-none">{index + 1}</span>
                {foldable &&
                  // 开关列固定占位：没有可折叠内容的行也留出同宽的空位，否则行内容会左右错开
                  (range !== undefined ? (
                    <button
                      type="button"
                      className="json-fold-toggle"
                      aria-expanded={!folded}
                      aria-label={`${folded ? '展开' : '折叠'} 第 ${index + 1} 行`}
                      onClick={() => toggle(index)}
                    >
                      {folded ? '▸' : '▾'}
                    </button>
                  ) : (
                    <span className="json-fold-toggle" aria-hidden="true" />
                  ))}
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
                {range !== undefined && folded && (
                  <span className="json-type">{foldSummary(range)}</span>
                )}
              </li>
            )
          })}
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
