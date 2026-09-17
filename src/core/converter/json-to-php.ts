import { ok, type Result } from '../result'
import { indentUnit, type JsonIndent } from '../json/format'
import { buildJsonNodes, type JsonNode } from '../json/nodes'
import type { RewriteOptions, UnicodeMode } from '../json/escape'

export interface JsonToPhpOptions {
  /** 默认 4（PSR-12） */
  indent?: JsonIndent
  /**
   * 仅为满足 spec §5.3 的签名而接受。对 PHP 是 moot：字符串必须重新编码，
   * `\/` 这类 JSON 写法本就不会出现，规范化与保留的产物完全相同（① 不产生差异）。
   */
  keepEscapes?: boolean
  /**
   * 默认 'keep'。'escape' 时非 ASCII 输出为 `\u{码点}`（PHP 7+ 双引号语法）。
   * 'unescape' 与 'keep' 等价 —— 值已由 `decodeJsonString` 解出，无需再还原。
   */
  unicode?: UnicodeMode
}

/**
 * JSON → PHP 短数组字面量。
 *
 * 数字用原文（保大整数与 `-0` / `1e2`），字符串**必须重新编码**：PHP 双引号
 * 字符串不认 `\/`，直接贴 JSON 原文会得到 `a\/b` 而非 `a/b`。
 *
 * spec §6.2 对 PHP 只提 ②（选「转义」时非 ASCII 写成 `\u{4e2d}`），
 * 故这里只有 `unicode` 真正影响输出；`keepEscapes` 见其字段注释。
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
  const rewrite: RewriteOptions = {
    normalizeEscapes: options.keepEscapes === false,
    unicode: options.unicode ?? 'keep',
  }
  return ok(`$data = ${emit(built.value, unit, '', rewrite)};`)
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
function emit(node: JsonNode, unit: string, indent: string, rewrite: RewriteOptions): string {
  if (node.kind === 'object') {
    if (node.entries.length === 0) return '[]'
    const inner = indent + unit
    const body = node.entries
      .map(
        (entry) =>
          `${inner}${phpString(entry.key, rewrite.unicode)} => ${emit(entry.value, unit, inner, rewrite)}`,
      )
      .join(',\n')
    return `[\n${body}\n${indent}]`
  }

  if (node.kind === 'array') {
    if (node.items.length === 0) return '[]'
    const inner = indent + unit
    const body = node.items
      .map((item) => `${inner}${emit(item, unit, inner, rewrite)}`)
      .join(',\n')
    return `[\n${body}\n${indent}]`
  }

  if (node.kind === 'string') return phpString(decodeJsonString(node.raw), rewrite.unicode)
  return node.raw
}

/** 单个 JSON 字符串字面量 → 字符串值。scanner 已校验转义，这里不会抛 */
function decodeJsonString(raw: string): string {
  return JSON.parse(raw) as string
}

/**
 * 值 → PHP 双引号字符串字面量。
 *
 * 只有 `"` `\` `$` 需要转义；控制字符用短转义，其余按原样输出。
 * `unicode === 'escape'` 时非 ASCII 输出为 `\u{码点}`（PHP 7+ 双引号语法）。新分支
 * 只在「非 ASCII」处生效 —— 上面的 `"` `\` `$` 与 `\n`/`\r`/`\t`/`\xNN` 优先级与写法不变。
 * 孤立代理码元（0xD800-0xDFFF）即使开了 escape 也按原样输出：PHP 的 `\u{}` 只接受
 * 真正的码点，喂一个代理码元会写出非法字面量；这类码元本就只在残缺输入里出现。
 */
function phpString(value: string, unicode: UnicodeMode): string {
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
    if (unicode === 'escape' && code >= 0x80 && !(code >= 0xd800 && code <= 0xdfff)) {
      out += `\\u{${code.toString(16)}}`
      continue
    }
    out += ch
  }
  return `${out}"`
}
