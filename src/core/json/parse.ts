import { err, ok } from '../result'
import type { Result } from '../result'
import { scanJson } from './scanner'
import type { JsonToken } from './scanner'

export interface ParsedJson {
  value: unknown
  /** 原样 token 序列，供 minify / format 这类需要保留字面量的消费者使用 */
  tokens: readonly JsonToken[]
}

/**
 * 严格 JSON 解析入口。
 *
 * 两步走：先用 `scanJson` 做逐 token 的 RFC 8259 校验（错误自带行号 / 列号 / 偏移），
 * 再用 `JSON.parse` 取回真实值。之所以还要 `JSON.parse`：从 token 重建值等于
 * 重写一遍解析器，而 `scanJson` 已保证文本合法，此处只剩它自身的实现限制要兜。
 *
 * 那个限制是真实存在的：`JSON.parse` 在 V8 里是迭代实现（实测 50 万层嵌套仍能
 * 解析），但在 JavaScriptCore 里是递归实现，超深嵌套会抛 `RangeError`。
 * 本应用的 macOS 运行时正是 WKWebView（JSC），因此这一层 try/catch 不可省。
 * 该分支在 Node 环境构造不出来，故没有对应用例 —— 这是有意的例外，不是遗漏。
 */
export function parseJson(text: string): Result<ParsedJson> {
  const scanned = scanJson(text)
  if (!scanned.ok) {
    return err(scanned.error, {
      code: scanned.code,
      detail: scanned.detail,
      offset: scanned.offset,
      line: scanned.line,
      column: scanned.column,
      suggestion: scanned.suggestion,
    })
  }

  try {
    return ok({ value: JSON.parse(text) as unknown, tokens: scanned.tokens })
  } catch (cause) {
    return err('JSON 嵌套层级过深，无法解析', {
      code: 'TOO_DEEP',
      detail: cause instanceof Error ? cause.message : String(cause),
      suggestion: '请减少嵌套层数后重试',
    })
  }
}

/** 只要值、不要 token 的便捷入口。 */
export function parseJsonValue(text: string): Result<unknown> {
  const parsed = parseJson(text)
  // 注意取 parsed.value.value：parsed.value 是整个 ParsedJson（含 tokens），
  // 少一层解构会把 { value, tokens } 当成解析结果传出去
  return parsed.ok ? ok(parsed.value.value) : parsed
}
