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
 * - XML 1.0 不可表示的字符（见 `escapeXmlText`）替换为 U+FFFD，保证产物始终良构
 */
export function jsonToXml(text: string, options: JsonToXmlOptions = {}): Result<string> {
  if (text.trim().length === 0) return ok('')

  const built = buildJsonNodes(text)
  if (!built.ok) return built

  const unit = indentUnit(options.indent ?? 2)
  const wrap = options.wrapArrayItems ?? false
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>']

  // 顶层数组若走「同名元素重复」，会产出多个根元素 —— 那不是合法 XML，故在**根这一层**
  // 强制包裹。⚠️ 只对根强制：子层必须沿用用户的 `wrap` 语义，否则同一份数据会因「根是不是
  // 数组」而输出形态不同（例如嵌套的 `tags` 会被迫用 `<item>` 包裹）。
  if (built.value.kind === 'array') {
    if (built.value.items.length === 0) {
      lines.push('<root/>')
    } else {
      lines.push('<root>')
      for (const item of built.value.items) {
        lines.push(...emitElement('item', item, unit, wrap, unit))
      }
      lines.push('</root>')
    }
  } else {
    lines.push(...emitElement('root', built.value, unit, wrap, ''))
  }

  return ok(lines.join('\n'))
}

/**
 * XML 1.0 的 NameChar 允许：字母、数字、`_` `.` `-`、`·`、组合附标 `#x0300–#x036F`、`‿` `⁀`。
 * `:` 刻意不留（那是命名空间分隔符）。`-` 放在字符组末尾以免写成 `\-`（会被 lint 判为多余转义）
 */
const NAME_CHAR = /[\p{L}\p{N}_.\u00b7\u203f-\u2040-]/u

/**
 * 组合附标区间单独用码点判断，**精确到 XML 允许的 `#x0300–#x036F`**，不用更宽的 `\p{M}`：
 * `\p{M}` 会把该区间之外的标记（如 U+0903）放进元素名，产出严格意义上**非良构**的 XML。
 * 之所以不写进上面的字符组：字面量区间会触发 ESLint 的 `no-misleading-character-class`
 * （该规则针对无 `u` 标记时被拆散的多码元字符，此处属误报，但仓库无内联禁用先例，故避开）。
 */
function isNameChar(ch: string): boolean {
  if (NAME_CHAR.test(ch)) return true
  const code = ch.codePointAt(0) ?? 0
  return code >= 0x0300 && code <= 0x036f
}

export function sanitizeXmlName(name: string): string {
  let out = ''
  for (const ch of name) out += isNameChar(ch) ? ch : '_'

  if (out === '') return '_'
  // 数字、`-`、`.` 可以出现在名字里但不能开头。`-` 在字符组末尾是字面量，无需 `\-`
  return /^[0-9.-]/.test(out) ? `_${out}` : out
}

/**
 * XML 1.0 `Char` 产生式的补集中、**写成字符引用也不合法**的码点：
 * - C0 控制符除 `#x09`(TAB) `#x0A`(LF) `#x0D`(CR) 外：`#x00`–`#x08`、`#x0B`、`#x0C`、`#x0E`–`#x1F`
 * - 孤立代理 `#xD800`–`#xDFFF`（配对的代理对在 `for...of` 里是单个星平面码点，不落此区间）
 * - `#xFFFE`、`#xFFFF`
 *
 * 用码点判断而非正则：正则字面量里的控制符会被 `no-control-regex` 拦下。
 */
function isNonXmlChar(code: number): boolean {
  if (code <= 0x08 || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f)) return true
  if (code >= 0xd800 && code <= 0xdfff) return true
  return code === 0xfffe || code === 0xffff
}

function escapeXmlText(value: string): string {
  // `&` 必须最先替换，否则会把后面生成的实体再次转义
  // 单独的 `\r` 会被 XML 解析器规范化成 `\n`，故写成字符引用以保住原文
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;')

  // 不可表示的字符一律替换为 U+FFFD（标准「不可表示」标记，胜过无声丢字）。
  // `for...of` 按码点迭代，故配对的代理对不会被误伤。
  let out = ''
  for (const ch of escaped) out += isNonXmlChar(ch.codePointAt(0) ?? 0) ? '\uFFFD' : ch
  return out
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
