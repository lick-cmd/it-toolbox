import { ok, type Result } from '../result'
import { indentUnit, type JsonIndent } from '../json/format'
import { buildJsonNodes, type JsonNode } from '../json/nodes'

export interface JsonToPhpOptions {
  /** 默认 4（PSR-12） */
  indent?: JsonIndent
}

/**
 * JSON → PHP 短数组字面量。
 *
 * 数字用原文（保大整数与 `-0` / `1e2`），字符串**必须重新编码**：PHP 双引号
 * 字符串不认 `\/`，直接贴 JSON 原文会得到 `a\/b` 而非 `a/b`。
 *
 * 两个不可避免的有损点（界面需标注，不在代码里掩盖）：
 * - 空对象 `{}` 与空数组 `[]` 都写成 `[]`（PHP 无法区分）
 * - 纯十进制整数的字符串键（`{"1":"a"}`）会被 PHP 当 int 键处理（语言行为）
 */
export function jsonToPhp(text: string, options: JsonToPhpOptions = {}): Result<string> {
  if (text.trim().length === 0) return ok('')

  const built = buildJsonNodes(text)
  if (!built.ok) return built

  const unit = indentUnit(options.indent ?? 4)
  return ok(`$data = ${emit(built.value, unit, '')};`)
}

function emit(node: JsonNode, unit: string, indent: string): string {
  if (node.kind === 'object') {
    if (node.entries.length === 0) return '[]'
    const inner = indent + unit
    const body = node.entries
      .map((entry) => `${inner}${phpString(entry.key)} => ${emit(entry.value, unit, inner)}`)
      .join(',\n')
    return `[\n${body}\n${indent}]`
  }

  if (node.kind === 'array') {
    if (node.items.length === 0) return '[]'
    const inner = indent + unit
    const body = node.items.map((item) => `${inner}${emit(item, unit, inner)}`).join(',\n')
    return `[\n${body}\n${indent}]`
  }

  if (node.kind === 'string') return phpString(decodeJsonString(node.raw))
  return node.raw
}

/** 单个 JSON 字符串字面量 → 字符串值。scanner 已校验转义，这里不会抛 */
function decodeJsonString(raw: string): string {
  return JSON.parse(raw) as string
}

/**
 * 值 → PHP 双引号字符串字面量。
 *
 * 只有 `"` `\` `$` 需要转义；控制字符用短转义，其余（含孤立代理码元）按原样输出。
 */
function phpString(value: string): string {
  let out = '"'
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0

    if (ch === '"') {
      out += '\\"'
      continue
    }
    if (ch === '\\') {
      out += '\\\\'
      continue
    }
    if (ch === '$') {
      out += '\\$'
      continue
    }
    if (code === 0x0a) {
      out += '\\n'
      continue
    }
    if (code === 0x0d) {
      out += '\\r'
      continue
    }
    if (code === 0x09) {
      out += '\\t'
      continue
    }
    if (code < 0x20) {
      out += `\\x${code.toString(16).padStart(2, '0')}`
      continue
    }
    out += ch
  }
  return `${out}"`
}
