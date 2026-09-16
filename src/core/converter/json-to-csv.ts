import { ok, type Result } from '../result'
import { buildJsonNodes, type JsonNode, type JsonObjectNode } from '../json/nodes'

/**
 * JSON → CSV（RFC 4180 的引号规则 + `\n` 行分隔）。
 *
 * 按顶层形状分派，除 JSON 语法错误外不报错：
 * - 对象数组 → 表头取键的并集（首次出现顺序），每行一个对象，缺失键留空
 * - 原始值数组 → 单列 `value`
 * - 其它数组（混合 / 元素是数组）→ 单列 `value`，非原始值写紧凑 JSON
 * - 对象 → 单行表格（列 = 键）
 * - 标量 → 单列 `value` 一行
 *
 * 已知有损点：CSV 无法表达重复列，同一对象里的重复键只保留最后一次出现的值。
 *
 * 刻意不带 BOM：复制与下载复用同一个返回值，复制要的是纯净文本（粘进编辑器 /
 * 终端不会被 `\ufeff` 污染）。BOM 只在工具层「下载」时由调用方补上 —— 这是刻意
 * 的轻微不一致，换来的是复制路径的零惊喜。也因此本函数的返回值必须可断言为
 * 纯净文本，测试不覆盖 BOM。
 */
export function jsonToCsv(text: string): Result<string> {
  if (text.trim().length === 0) return ok('')

  const built = buildJsonNodes(text)
  if (!built.ok) return built

  const rows = toRows(built.value)
  return ok(rows.map((row) => row.map(csvField).join(',')).join('\n'))
}

function toRows(node: JsonNode): string[][] {
  if (node.kind === 'array') {
    if (node.items.length === 0) return []

    const objects = node.items.filter((item): item is JsonObjectNode => item.kind === 'object')
    if (objects.length === node.items.length) return objectArrayRows(objects)

    return [['value'], ...node.items.map((item) => [cell(item)])]
  }

  if (node.kind === 'object') {
    const header = node.entries.map((entry) => entry.key)
    const row = node.entries.map((entry) => cell(entry.value))
    return [header, row]
  }

  return [['value'], [cell(node)]]
}

/** 表头 = 键的并集（首次出现顺序）；同一对象的重复键后者覆盖前者 */
function objectArrayRows(items: readonly JsonObjectNode[]): string[][] {
  const header: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    for (const entry of item.entries) {
      if (seen.has(entry.key)) continue
      seen.add(entry.key)
      header.push(entry.key)
    }
  }

  const rows = items.map((item) => {
    const byKey = new Map<string, JsonNode>()
    for (const entry of item.entries) byKey.set(entry.key, entry.value)
    return header.map((key) => {
      const value = byKey.get(key)
      return value === undefined ? '' : cell(value)
    })
  })

  return [header, ...rows]
}

/** 单元格文本。null 是空字段；字符串解码为真实字符；数字与布尔用原文 */
function cell(node: JsonNode): string {
  if (node.kind === 'null') return ''
  if (node.kind === 'string') return JSON.parse(node.raw) as string
  if (node.kind === 'object' || node.kind === 'array') return compact(node)
  return node.raw
}

/** 紧凑 JSON，全部取自原文 token，不改写数字与转义 */
function compact(node: JsonNode): string {
  if (node.kind === 'object') {
    return `{${node.entries.map((entry) => `${entry.rawKey}:${compact(entry.value)}`).join(',')}}`
  }
  if (node.kind === 'array') {
    return `[${node.items.map(compact).join(',')}]`
  }
  return node.raw
}

/** RFC 4180：含逗号、引号、换行时用双引号包裹，内部引号翻倍 */
function csvField(value: string): string {
  if (!/[",\n\r]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}
