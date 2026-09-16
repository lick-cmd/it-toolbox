import { scanJson } from './scanner'
import type { JsonToken } from './scanner'

/**
 * 可折叠的容器类别。
 *
 * 与树形视图同口径：只有对象与数组能折叠。标量没有「内容」，空容器（`{}` / `[]`）
 * 折叠前后一模一样，给开关只会骗人 —— 前者在扫描阶段就不成区间，后者由
 * 「同一行内闭合」这条判据自动排除。
 */
export type FoldKind = 'object' | 'array'

/** 一行开括号与其配对闭括号构成的折叠区间 */
export interface FoldRange {
  /** 开括号所在行（0 起算） */
  openLine: number
  /** 配对闭括号所在行（0 起算） */
  closeLine: number
  kind: FoldKind
  /** 直接子项数：对象的键数、数组的元素数。折叠摘要据此报数 */
  childCount: number
}

export interface FoldModel {
  /** 全部可折叠区间，按开括号行号升序（外层在前） */
  ranges: readonly FoldRange[]
  /** 开括号行号 → 区间，供逐行渲染时按行查表 */
  byOpenLine: ReadonlyMap<number, FoldRange>
}

/** 无折叠可言的模型（单行 JSON、非法文本）。渲染层据此直接跳过整条折叠逻辑 */
export const EMPTY_FOLD_MODEL: FoldModel = { ranges: [], byOpenLine: new Map() }

/**
 * 折叠后接在开括号后面的摘要文案。
 *
 * 与树形视图的 `{…} 3 键` / `[…] 3 项` 同口径，但**不重复画开括号**：这里开括号
 * 就摆在该行行内，被收起的是它后面的内容。
 */
export function foldSummary(range: FoldRange): string {
  return range.kind === 'object' ? `… ${range.childCount} 键` : `… ${range.childCount} 项`
}

interface Frame {
  kind: FoldKind
  openLine: number
  childCount: number
  /** 下一个能算子项的 token 是否就是本层的一个直接子项 */
  expectChild: boolean
}

/** 数一段文本里的换行 —— 行号口径与 `String.split('\n')` 一致，故只认 `\n` */
function countLineBreaks(text: string, from: number, to: number): number {
  let count = 0
  for (let index = from; index < to; index++) {
    if (text.charCodeAt(index) === 10) count++
  }
  return count
}

/**
 * 记一个直接子项。
 *
 * 单看 token 无法判断「这是不是本层的子项」：对象的**值**跟在键后面（那时
 * `expectChild` 已被键消费掉），`:` 与 `,` 是分隔符。故规则是「本层正在等子项，
 * 且这个 token 对得上本层的种类」：对象只认键（string token），数组任何 token 都算
 * 元素起点 —— 数组元素为容器时，由容器入栈前的那次调用落账，出栈后 `expectChild`
 * 仍是 false，不会被重复数。
 */
function takeChild(frame: Frame, token: JsonToken): void {
  if (!frame.expectChild) return
  if (frame.kind === 'object' && token.kind !== 'string') return
  frame.childCount++
  frame.expectChild = false
}

/**
 * 从**美化后的源码**推导可折叠区间。
 *
 * 只做一趟 token 扫描：开括号入栈、闭括号出栈即得区间，与 `formatJson` 逐 token
 * 重排的方式同源，因此「哪些行能折叠」与「源码怎么换行」天然对齐 —— 不依赖
 * 缩进宽度，也不经过值对象。
 *
 * 判据是「开括号与闭括号不在同一行」：美化输出里 `{}` / `[]` 写成同一行，收起来
 * 与展开没有区别，故不成区间；单行 JSON（压缩结果）同样一个区间都不产生。
 * 扫描失败（预览被截断、文本不是 JSON）时降级为空模型，界面照常按纯文本显示。
 */
export function buildFoldModel(text: string): FoldModel {
  const scanned = scanJson(text)
  if (!scanned.ok) return EMPTY_FOLD_MODEL

  const stack: Frame[] = []
  const ranges: FoldRange[] = []
  // 当前 token 起点的行号：由「上一 token 之后到本 token 之前的空白里的换行」累加，
  // 而 token 自己不含裸换行（字符串里的裸换行扫描阶段就已被拒），故不必再按 token 内累加
  let line = 0
  let previousEnd = 0

  for (const token of scanned.tokens) {
    line += countLineBreaks(text, previousEnd, token.start)
    previousEnd = token.end

    const raw = token.raw

    if (raw === '{' || raw === '[') {
      // 元素本身是容器时，它同样是父层的一个直接子项 —— 计数必须在入栈前落账，
      const parent = stack[stack.length - 1]
      if (parent !== undefined) takeChild(parent, token)
      stack.push({
        kind: raw === '{' ? 'object' : 'array',
        openLine: line,
        childCount: 0,
        expectChild: true,
      })
      continue
    }

    if (raw === '}' || raw === ']') {
      const frame = stack.pop()
      if (frame !== undefined && line > frame.openLine) {
        ranges.push({
          openLine: frame.openLine,
          closeLine: line,
          kind: frame.kind,
          childCount: frame.childCount,
        })
      }
      continue
    }

    const frame = stack[stack.length - 1]
    if (frame === undefined) continue // 顶层标量，没有可折叠的层

    if (raw === ',') {
      frame.expectChild = true
      continue
    }

    takeChild(frame, token)
  }

  // 区间在闭括号处才成立，故产出顺序是「先内后外」。按开括号行号排序后语义才是
  // 「外层在前」，渲染层与用例都能直接按这个顺序读
  ranges.sort(
    (left, right) => left.openLine - right.openLine || right.closeLine - left.closeLine,
  )

  return { ranges, byOpenLine: new Map(ranges.map((range) => [range.openLine, range])) }
}

/**
 * 「全部折叠」：除根以外全部收起。
 *
 * 美化输出的第一行就是根的开括号，故「开括号不在第 0 行」即「不是根」。根留着展开，
 * 否则代码区只剩一行开括号，用户连展开了什么都看不见。
 */
export function collapseAllFoldLines(model: FoldModel): number[] {
  return model.ranges.filter((range) => range.openLine > 0).map((range) => range.openLine)
}

/**
 * 按折叠状态算出要隐藏的行。
 *
 * 判断依据是**开括号行号**而不是集合里有什么：换了一份文档后集合里可能残留着旧行号，
 * 那些行号在本模型里查不到对应区间，自然就不起作用 —— 折叠态因此不需要额外的清洗。
 *
 * 折叠外层会把内层区间覆盖的行一并隐藏（`hidden` 是并集），内层区间自己的折叠状态
 * 保持不变：再展开外层时它还在原样。
 */
export function hiddenLines(
  model: FoldModel,
  collapsed: ReadonlySet<number>,
): ReadonlySet<number> {
  const hidden = new Set<number>()
  for (const range of model.ranges) {
    if (!collapsed.has(range.openLine)) continue
    for (let line = range.openLine + 1; line <= range.closeLine; line++) hidden.add(line)
  }
  return hidden
}
