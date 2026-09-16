/**
 * JSON 值的类型标签与类型提示。
 *
 * 这一层从 `core/web/json-diff.ts` 搬出来，原因有两条：
 *
 * 1. 「某个 JSON 值是什么类型」「某个键该怎么写成 JSONPath」是 JSON 层的公共知识，
 *    不是差异比较的私有细节 —— json-diff 只是它的第一个消费者，
 *    JSON 美化工具的类型提示视图是第二个。
 * 2. `dev-tools/spec.md:54` 的 Requirement 明文要求美化工具「展示每个值的数据类型提示」，
 *    而 `formatJson` 是 text→text 的格式化器，不产出任何类型信息，
 *    这条要求必须由 UI 层借助本模块来满足。两个消费者共用同一份类型口径，
 *    才不会出现「diff 说数字、美化说数值」这类漂移。
 *
 * 纯函数、零依赖：不 import React / Tauri / DOM，也不 import 任何上层模块。
 */

export type JsonValueType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  /** 该路径不存在（仅差异比较用得到） */
  | 'absent'

export const JSON_TYPE_LABEL: Record<JsonValueType, string> = {
  object: '对象',
  array: '数组',
  string: '字符串',
  number: '数字',
  boolean: '布尔',
  null: '空值',
  absent: '缺失',
}

/** `typeof null === 'object'` 是最容易写错的一处，故 null 必须先判 */
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

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** 合法标识符用 `.key`，其余用 `["key"]`（键里可能含点、空格、引号或中文） */
export function jsonChildPath(base: string, key: string): string {
  return IDENTIFIER.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key)}]`
}

export function jsonIndexPath(base: string, index: number): string {
  return `${base}[${index}]`
}

/**
 * 递归深度上限。
 *
 * 与 `json-diff.diffValues` 同一口径（256）：深嵌套输入在 JavaScriptCore 上会栈溢出，
 * 而异常逃出 `Result` 会让「非法输入以错误对象报告」的契约破功。
 * 超出时不继续下钻，但**保留该节点本身** —— 界面至少还知道这里有个容器。
 */
export const TYPE_HINT_MAX_DEPTH = 256

export interface TypeHint {
  /** JSONPath 形式，根为 `$` */
  path: string
  type: JsonValueType
  label: string
  /** 附注概要；标量为空串（值本身就是最好的说明，重复一遍是噪声） */
  summary: string
}

/**
 * 概要只给「有信息量」的四种：
 * - 对象给键数
 * - 数组给长度
 * - 字符串给**码点数**（用 `[...s].length` 而非 `s.length`）
 *
 * 字符串这里特意不用 `s.length`：那是 UTF-16 码元数，`'🚀'.length` 是 2，
 * 而用户看到的是 1 个字符。界面上报错的数据比不报更糟。
 */
function summaryOf(value: unknown, type: JsonValueType): string {
  if (type === 'object') return `${Object.keys(value as object).length} 个键`
  if (type === 'array') return `长度 ${(value as unknown[]).length}`
  if (type === 'string') return `长度 ${[...(value as string)].length}`
  return ''
}

/** 前序遍历整棵值树：父节点先于子节点，对象的键序即输入顺序 */
export function collectTypeHints(value: unknown): TypeHint[] {
  const hints: TypeHint[] = []
  walk(value, '$', hints, 0)
  return hints
}

function walk(value: unknown, path: string, out: TypeHint[], depth: number): void {
  const type = typeOf(value)
  out.push({ path, type, label: JSON_TYPE_LABEL[type], summary: summaryOf(value, type) })

  if (depth >= TYPE_HINT_MAX_DEPTH) return

  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      walk(value[key], jsonChildPath(path, key), out, depth + 1)
    }
    return
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      walk(value[i], jsonIndexPath(path, i), out, depth + 1)
    }
  }
}
