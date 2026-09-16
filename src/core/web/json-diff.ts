import { parseJsonValue } from '../json/parse'
import {
  isPlainObject,
  jsonChildPath,
  jsonIndexPath,
  JSON_TYPE_LABEL,
  typeOf,
  type JsonValueType,
} from '../json/type-hints'
import { err, ok } from '../result'
import type { Result } from '../result'

/**
 * 类型标签与 JSONPath 拼接已搬到 `core/json/type-hints.ts`：那是 JSON 层的公共知识，
 * 而不是差异比较的私有细节（JSON 美化工具的类型提示视图是第二个消费者）。
 * 此处**再导出**，让 7.7 以来对外的符号面逐一不变。
 */
export { JSON_TYPE_LABEL, typeOf }
export type { JsonValueType }

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

/**
 * 递归深度上限。
 *
 * 不做 LCS 对齐也不做迭代化：spec 只要求按索引定位差异，递归实现最直白。
 * 但深嵌套输入在 JSC 上会栈溢出，故设上限，超出时把该子树整体记为「修改」，
 * 保证工具不会崩。
 */
const MAX_DEPTH = 256

/**
 * 递归比较两个已解析的 JSON 值，把变更追加到 `out`。
 *
 * 对象用「两侧键的并集」遍历：只在一侧出现的键被识别为新增 / 删除，
 * 而键的书写顺序完全不影响结果（spec 的「忽略键序差异」）。
 *
 * 粒度取舍：某键在单侧存在时只在该键的路径产出**一条**记录，值取整个子树，
 * 而不是逐叶展开 —— 这样 `{"c":{"x":1}}` 的删除只报 `$.c` 一条。
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
      const child = jsonChildPath(path, key)

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
      diffValues(left[i], right[i], jsonIndexPath(path, i), out, depth + 1)
    }
    for (let i = common; i < left.length; i++) {
      out.push({
        path: jsonIndexPath(path, i),
        kind: 'removed',
        left: left[i],
        right: undefined,
        leftType: typeOf(left[i]),
        rightType: 'absent',
      })
    }
    for (let i = common; i < right.length; i++) {
      out.push({
        path: jsonIndexPath(path, i),
        kind: 'added',
        left: undefined,
        right: right[i],
        leftType: 'absent',
        rightType: typeOf(right[i]),
      })
    }
    return
  }

  // 两侧不是「同类型的容器」：类型不同或标量不同都算修改
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
 * 工具据此把 `ErrorNote` 与错误行高亮放到对应那一栏；`error` 文案里也带
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
