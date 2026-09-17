import { ok, type Result } from '../result'
import { indentUnit, type JsonIndent } from '../json/format'
import { buildJsonNodes, type JsonNode } from '../json/nodes'
import { rewriteStringToken, type RewriteOptions, type UnicodeMode } from '../json/escape'

export interface JsonToJsOptions {
  /** 默认 2 */
  indent?: JsonIndent
  /** 默认 true：原样保留输入里的转义写法；false 时规范化为最小转义 */
  keepEscapes?: boolean
  /** 默认 'keep' */
  unicode?: UnicodeMode
}

/**
 * JSON → JS 对象字面量。
 *
 * 结构、数字原文与字符串字面量全部取自 token：`12345678912345678` 不会被取整，
 * `-0` / `1e2` 保持原写法，重复键各自保留一 `pair`。
 * 字符串直接复用 JSON 原文 —— JSON 的字符串字面量是 JS 字符串字面量的子集，
 * 且 `\/`、`\uXXXX` 在两边语义一致。
 *
 * `keepEscapes` / `unicode` 按 spec §5.3 / §8.2 生效，键与值一视同仁（`formatJson`
 * 对键值同等对待，转换器不能两样）。默认值（`true` / `'keep'`）下
 * `rewriteStringToken` 在 `!normalizeEscapes && unicode === 'keep'` 时原样返回，
 * 逐字节等于复用原文，不开这两个开关时零额外开销。
 */
export function jsonToJs(text: string, options: JsonToJsOptions = {}): Result<string> {
  if (text.trim().length === 0) return ok('')

  const built = buildJsonNodes(text)
  if (!built.ok) return built

  const unit = indentUnit(options.indent ?? 2)
  const rewrite: RewriteOptions = {
    normalizeEscapes: options.keepEscapes === false,
    unicode: options.unicode ?? 'keep',
  }
  return ok(`const data = ${emit(built.value, unit, '', rewrite)};`)
}

/**
 * ⚠️ 本骨架与 `json-to-php.ts` 的 `emit` **同构**：对象 / 数组分支的缩进推进与
 * `,\n` 连接逻辑逐字一致，函数签名也相同，仅三处不同 —— 空容器字面量（`{}` vs `[]`）、
 * 键写法（`rawKey:` vs `"k" =>`）、值写法（复用 JSON 原文 vs 字符串重新编码）。
 * 结构或分隔符语义变更时**两处必须同步修改** —— 漏改任一都会造成两路输出风格分叉。
 *
 * 刻意不抽公共 emitter：当前仅两个消费者，不足以反推出 4 个钩子的抽象边界；且第三个
 * 潜在消费者 XML 的形态本就不同（元素名净化、`<x/>` / `<x></x>` 两态、数组包裹），
 * CSV 是扁平结构。待真的出现第三个「同形」骨架时，再按 rule of three 一并抽取
 * （见 Task 7 的审查范围）。
 */
function emit(node: JsonNode, unit: string, indent: string, rewrite: RewriteOptions): string {
  if (node.kind === 'object') {
    if (node.entries.length === 0) return '{}'
    const inner = indent + unit
    const body = node.entries
      .map(
        (entry) =>
          `${inner}${rewriteStringToken(entry.rawKey, rewrite)}: ${emit(entry.value, unit, inner, rewrite)}`,
      )
      .join(',\n')
    return `{\n${body}\n${indent}}`
  }

  if (node.kind === 'array') {
    if (node.items.length === 0) return '[]'
    const inner = indent + unit
    const body = node.items
      .map((item) => `${inner}${emit(item, unit, inner, rewrite)}`)
      .join(',\n')
    return `[\n${body}\n${indent}]`
  }

  // `raw` 与 `rewriteStringToken` 同口径（含引号的完整 token），键与值走同一条改写路径
  if (node.kind === 'string') return rewriteStringToken(node.raw, rewrite)
  return node.raw
}
