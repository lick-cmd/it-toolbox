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
