import { useEffect, useMemo, useRef, useState } from 'react'
import {
  EMPTY_FOLD_MODEL,
  buildFoldModel,
  collapseAllFoldLines,
  foldSummary,
  hiddenLines,
} from '@/core/json/fold'
import { scanJson } from '@/core/json/scanner'
import type { JsonToken } from '@/core/json/scanner'
import { searchJson } from '@/core/json/search'
import type { JsonSearchMatch } from '@/core/json/search'
import { Checkbox } from './Inputs'

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
  /**
   * 渲染「搜索键与值」工具条。
   *
   * 默认关闭：短文本（JWT 载荷、YAML 转换结果）不需要搜索，多一行控件只占高度。
   */
  searchable?: boolean
}

interface Segment {
  text: string
  /** 空串表示不着色（空白与换行） */
  className: string
  /** 片段在整段文本里的起始偏移：搜索高亮要按绝对偏移与命中区间对齐 */
  start: number
}

/** 一行里切出来的最小绘制单元；命中片段会被单独包成 `<mark>` 以便高亮 */
interface Piece {
  text: string
  className: string
  /** 命中的匹配下标；-1 表示未命中 */
  match: number
}

interface IndexedMatch {
  match: JsonSearchMatch
  /** 在完整匹配列表里的下标，用于标记「当前命中」 */
  index: number
}

const KIND_CLASS: Record<JsonToken['kind'], string> = {
  string: 'json-string',
  number: 'json-number',
  literal: 'json-literal',
  punct: 'json-punct',
}

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

const SEARCH_INPUT =
  'h-6 w-44 rounded-sm border border-border bg-surface-2 px-1.5 text-[12px] text-fg outline-none focus:border-accent'

const NOTHING_COLLAPSED: ReadonlySet<number> = new Set()

const EMPTY_MATCHES: readonly JsonSearchMatch[] = []
const EMPTY_LINE_MATCHES: readonly IndexedMatch[] = []

function countLabel(query: string, total: number, activeIndex: number): string {
  if (query.length === 0) return '输入关键词'
  if (total === 0) return '无匹配'
  return `第 ${activeIndex + 1} / ${total} 处`
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
 * 折叠摘要同理只作为**兄弟节点**挂在行内容之外，不许混进行内容里。
 *
 * 折叠（`foldable`）只影响「画哪些行」：行号取自原文，故折叠之后行号会跳号
 * （折叠第 1 行后紧接第 5 行），与编辑器一致 —— 报数、定位仍以原文行号为准。
 *
 * 搜索（`searchable`）只在**键与值**里找（见 `core/json/search.ts`），命中切成
 * `<mark>` 高亮；因为同样是往行内容里插片段，文本不变量依旧成立。
 */
export function JsonCode({
  value,
  label,
  className,
  foldable = false,
  searchable = false,
}: JsonCodeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const lines = useMemo(() => toLines(toSegments(value)), [value])
  const fold = useMemo(
    () => (foldable ? buildFoldModel(value) : EMPTY_FOLD_MODEL),
    [foldable, value],
  )
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(NOTHING_COLLAPSED)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [active, setActive] = useState(0)
  /** 下一次 DOM 更新后要滚入视野的命中下标；仅显式导航时置位 */
  const pendingScroll = useRef<number | null>(null)

  // 折叠态按行号记，而行号只对某一份文本有意义：文本换了就回到默认的全展开。
  // 与 `JsonTree` 同法（那里依据的是文档原文）。代价是换缩进也会重置 —— 输出整体
  // 重排后行号已不再指向同一批节点，硬留着折叠只会收起毫不相干的行。
  useEffect(() => {
    setCollapsed(NOTHING_COLLAPSED)
  }, [value])

  const matches = useMemo(
    () => (searchable ? searchJson(value, query, { caseSensitive }) : EMPTY_MATCHES),
    [searchable, value, query, caseSensitive],
  )

  // 关键词或文本变了，命中集合就不再是原来那批 —— 回到第一条
  useEffect(() => {
    setActive(0)
    pendingScroll.current = null
  }, [query, caseSensitive, value])

  const activeIndex = matches.length === 0 ? -1 : Math.min(active, matches.length - 1)

  // 没有命中时返回 null：此时逐段渲染与原先完全一致，不为搜索白造一批片段
  const pieces = useMemo(() => {
    if (matches.length === 0) return null
    const groups = groupByLine(matches, lines.length)
    return lines.map((line, index) => toPieces(line, groups[index] ?? EMPTY_LINE_MATCHES))
  }, [matches, lines])

  const hidden = useMemo(() => hiddenLines(fold, collapsed), [fold, collapsed])

  /**
   * 跳到某条命中。
   *
   * 命中的行可能正被折叠挡住，故顺带把它所在的折叠区间逐个展开 —— 否则「找到了
   * 第 3 处」却什么也看不见。展开是幂等的：区间没被折叠时不改动集合身份。
   */
  const goTo = (index: number): void => {
    if (matches.length === 0) return
    const next = ((index % matches.length) + matches.length) % matches.length
    setActive(next)
    pendingScroll.current = next

    const match = matches[next]
    if (match === undefined) return
    const targetLine = match.line - 1
    setCollapsed((current) => {
      if (current.size === 0) return current
      const expanded = new Set(current)
      let changed = false
      for (const range of fold.ranges) {
        if (
          range.openLine < targetLine &&
          targetLine <= range.closeLine &&
          expanded.has(range.openLine)
        ) {
          expanded.delete(range.openLine)
          changed = true
        }
      }
      return changed ? expanded : current
    })
  }

  useEffect(() => {
    const target = pendingScroll.current
    if (target === null) return
    pendingScroll.current = null
    const node = containerRef.current?.querySelector(`[data-match-index="${target}"]`)
    if (node instanceof HTMLElement && typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'center' })
    }
  }, [active, pieces])

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
      ref={containerRef}
      data-testid="json-code"
      className={['code-text relative min-h-0 overflow-auto', className ?? ''].join(' ')}
    >
      {label && <span className="sr-only">{label}</span>}

      {searchable && value.length > 0 && (
        <div
          data-testid="json-code-search"
          className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-1"
        >
          <input
            aria-label="搜索键和值"
            type="text"
            className={SEARCH_INPUT}
            value={query}
            placeholder="搜索键或值"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              goTo(activeIndex + (event.shiftKey ? -1 : 1))
            }}
          />
          <span data-testid="json-search-count" className="text-[11px] text-muted">
            {countLabel(query, matches.length, activeIndex)}
          </span>
          <button
            type="button"
            className={BUTTON}
            disabled={matches.length === 0}
            onClick={() => goTo(activeIndex - 1)}
          >
            上一个
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={matches.length === 0}
            onClick={() => goTo(activeIndex + 1)}
          >
            下一个
          </button>
          {query.length > 0 && (
            <button type="button" className={BUTTON} onClick={() => setQuery('')}>
              清除
            </button>
          )}
          <Checkbox label="区分大小写" checked={caseSensitive} onChange={setCaseSensitive} />
        </div>
      )}

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
            const linePieces = pieces?.[index]

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
                  {linePieces === undefined
                    ? line.map((segment, segmentIndex) => (
                        // 片段下标必须入 key：同一行内相同标点（如多个 `:`）的 className+text 会重复，
                        // 只用后两者会让 React 报「Encountered two children with the same key」。
                        <span
                          key={`${segmentIndex}-${segment.className}-${segment.text}`}
                          className={segment.className || undefined}
                        >
                          {segment.text}
                        </span>
                      ))
                    : linePieces.map((piece, pieceIndex) =>
                        piece.match < 0 ? (
                          <span
                            key={`${pieceIndex}-${piece.className}-${piece.text}`}
                            className={piece.className || undefined}
                          >
                            {piece.text}
                          </span>
                        ) : (
                          <mark
                            key={`${pieceIndex}-${piece.match}-${piece.text}`}
                            data-match-index={piece.match}
                            className={[
                              'json-search-hit',
                              piece.match === activeIndex ? 'json-search-hit-active' : '',
                              piece.className,
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {piece.text}
                          </mark>
                        ),
                      )}
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
  if (!scanned.ok) return value.length === 0 ? [] : [{ text: value, className: '', start: 0 }]

  const segments: Segment[] = []
  let pos = 0

  for (const token of scanned.tokens) {
    if (token.start > pos) {
      segments.push({ text: value.slice(pos, token.start), className: '', start: pos })
    }
    segments.push({ text: token.raw, className: KIND_CLASS[token.kind], start: token.start })
    pos = token.end
  }
  if (pos < value.length) segments.push({ text: value.slice(pos), className: '', start: pos })

  return segments
}

/** 按换行拆行。JSON 字符串里不可能出现裸换行（scanner 已拒控制字符），故拆分不会切碎 token */
function toLines(segments: readonly Segment[]): Segment[][] {
  const lines: Segment[][] = []
  let current: Segment[] = []

  for (const segment of segments) {
    const parts = segment.text.split('\n')
    let offset = segment.start
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
        current.push({ text: part, className: segment.className, start: offset })
      }
      // 换行本身占一个字符：下一个片段的起点要跳过它
      offset += (part?.length ?? 0) + 1
    }
  }

  lines.push(current)
  return lines
}

/** 命中按行归组，行号转成 0 基下标 —— 渲染第 n 行时只需处理这一行的命中 */
function groupByLine(matches: readonly JsonSearchMatch[], lineCount: number): IndexedMatch[][] {
  const groups: IndexedMatch[][] = Array.from({ length: lineCount }, () => [])
  matches.forEach((match, index) => {
    const group = groups[match.line - 1]
    if (group !== undefined) group.push({ match, index })
  })
  return groups
}

/**
 * 把一行切成「着色 + 命中高亮」的片段。
 *
 * 命中不会跨行（字符串里没有裸换行），故逐行处理即可；行内则按绝对偏移与
 * 片段求交，把命中部分单独切出来。指针只前进不回退，整体是线性复杂度。
 */
function toPieces(line: readonly Segment[], lineMatches: readonly IndexedMatch[]): Piece[] {
  const pieces: Piece[] = []
  let pointer = 0

  for (const segment of line) {
    const segmentStart = segment.start
    const segmentEnd = segmentStart + segment.text.length
    let cursor = segmentStart

    while (pointer < lineMatches.length) {
      const entry = lineMatches[pointer]
      if (entry === undefined || entry.match.start >= segmentEnd) break
      if (entry.match.end <= cursor) {
        pointer++
        continue
      }

      const from = Math.max(entry.match.start, cursor)
      const to = Math.min(entry.match.end, segmentEnd)
      if (from > cursor) {
        pieces.push({
          text: segment.text.slice(cursor - segmentStart, from - segmentStart),
          className: segment.className,
          match: -1,
        })
      }
      pieces.push({
        text: segment.text.slice(from - segmentStart, to - segmentStart),
        className: segment.className,
        match: entry.index,
      })
      cursor = to

      // 命中在本片段内结束才前进指针；跨界的情况留给下一个片段继续切
      if (entry.match.end <= segmentEnd) pointer++
      else break
    }

    if (cursor < segmentEnd) {
      pieces.push({
        text: segment.text.slice(cursor - segmentStart),
        className: segment.className,
        match: -1,
      })
    }
  }

  return pieces
}
