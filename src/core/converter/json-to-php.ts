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

/**
 * ⚠️ 本骨架与 `json-to-js.ts:42-60` 的 `emit` **同构**：对象 / 数组分支的缩进推进与
 * `,\n` 连接逻辑逐字一致，函数签名也相同，仅三处不同 —— 空容器字面量（`[]` vs `{}`）、
 * 键写法（`"k" =>` vs `rawKey:`）、值写法（字符串重新编码 vs 复用 JSON 原文）。
 * 结构或分隔符语义变更时**两处必须同步修改** —— 漏改任一都会造成两路输出风格分叉。
 *
 * 刻意不抽公共 emitter：当前仅两个消费者，不足以反推出 4 个钩子的抽象边界；且第三个
 * 潜在消费者 XML 的形态本就不同（元素名净化、`<x/>` / `<x></x>` 两态、数组包裹），
 * CSV 是扁平结构。待真的出现第三个「同形」骨架时，再按 rule of three 一并抽取
 * （见 Task 7 的审查范围）。
 */
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
