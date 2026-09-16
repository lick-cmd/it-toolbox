import { ok, type Result } from '../result'
import { indentUnit, type JsonIndent } from '../json/format'
import { buildJsonNodes, type JsonNode } from '../json/nodes'

export interface JsonToXmlOptions {
  /** 默认 2 */
  indent?: JsonIndent
  /** true = 数组元素用 <item> 包裹；默认 false = 与键同名的元素重复 */
  wrapArrayItems?: boolean
}

/**
 * JSON → XML。
 *
 * - 根元素固定 `root`，带 XML 声明；**全部用元素，不生成属性**（JSON 没有属性概念）
 * - 数组默认同名元素重复，可用 `wrapArrayItems` 切到 `<item>` 包裹
 * - `null` → `<x/>`，空字符串 → `<x></x>`（刻意区分，保住「无」与「空」的差别）
 * - 元素名净化：非法字符 → `_`，数字 / `-` / `.` 开头前缀 `_`（中文是合法 XML 名，保留）
 * - 数字用原文，不在文本层丢失精度
 */
export function jsonToXml(text: string, options: JsonToXmlOptions = {}): Result<string> {
  if (text.trim().length === 0) return ok('')

  const built = buildJsonNodes(text)
  if (!built.ok) return built

  const unit = indentUnit(options.indent ?? 2)
  const wrap = options.wrapArrayItems ?? false
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>']

  // 顶层数组若走「同名元素重复」，会产出多个根元素 —— 那不是合法 XML，故强制包裹
  if (built.value.kind === 'array') {
    lines.push(...emitElement('root', built.value, unit, true, ''))
  } else {
    lines.push(...emitElement('root', built.value, unit, wrap, ''))
  }

  return ok(lines.join('\n'))
}

/**
 * XML 1.0 的 NameChar 允许：字母、数字、`_` `.` `-`、`·`、组合附标、`‿` `⁀`。
 * `:` 刻意不留（那是命名空间分隔符）。`-` 放在字符组末尾以免写成 `\-`（会被 lint 判为多余转义）
 *
 * 组合附标写作 `\p{M}` 而非字面区间 `\u0300-\u036f`：后者会让 `no-misleading-character-class`
 * 报「字符类里有组合字符」。该规则针对的是无 `u` 标记时被拆散的多码元字符，此处是普通码点
 * 区间，属误报；用等价的属性转义避开，同时保住「组合附标是合法 NameChar」的语义。
 */
const NAME_CHAR = /[\p{L}\p{N}\p{M}_.\u00b7\u203f-\u2040-]/u

export function sanitizeXmlName(name: string): string {
  let out = ''
  for (const ch of name) out += NAME_CHAR.test(ch) ? ch : '_'

  if (out === '') return '_'
  // 数字、`-`、`.` 可以出现在名字里但不能开头。`-` 在字符组末尾是字面量，无需 `\-`
  return /^[0-9.-]/.test(out) ? `_${out}` : out
}

function escapeXmlText(value: string): string {
  // `&` 必须最先替换，否则会把后面生成的实体再次转义
  // 单独的 `\r` 会被 XML 解析器规范化成 `\n`，故写成字符引用以保住原文
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;')
}

function emitElement(
  name: string,
  node: JsonNode,
  unit: string,
  wrap: boolean,
  indent: string,
): string[] {
  if (node.kind === 'object') {
    if (node.entries.length === 0) return [`${indent}<${name}/>`]
    const inner = indent + unit
    const lines = [`${indent}<${name}>`]
    for (const entry of node.entries) {
      lines.push(...emitElement(sanitizeXmlName(entry.key), entry.value, unit, wrap, inner))
    }
    lines.push(`${indent}</${name}>`)
    return lines
  }

  if (node.kind === 'array') {
    if (node.items.length === 0) return [`${indent}<${name}/>`]

    if (wrap) {
      const inner = indent + unit
      const lines = [`${indent}<${name}>`]
      for (const item of node.items) lines.push(...emitElement('item', item, unit, wrap, inner))
      lines.push(`${indent}</${name}>`)
      return lines
    }

    const lines: string[] = []
    for (const item of node.items) lines.push(...emitElement(name, item, unit, wrap, indent))
    return lines
  }

  if (node.kind === 'null') return [`${indent}<${name}/>`]
  if (node.kind === 'string') {
    const value = JSON.parse(node.raw) as string
    return [`${indent}<${name}>${escapeXmlText(value)}</${name}>`]
  }

  return [`${indent}<${name}>${node.raw}</${name}>`]
}
