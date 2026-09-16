import { dump, load, YAMLException } from 'js-yaml'
import { scanJson } from '../json/scanner'
import { err, ok } from '../result'
import type { Result } from '../result'

export type YamlIndent = 2 | 4

export interface YamlToJsonOptions {
  /** 输出 JSON 的缩进宽度，默认 2 */
  indent?: YamlIndent
}

/**
 * YAML → JSON。
 *
 * 空输入在调用 `load` 之前拦截：js-yaml 5 对空文档会抛
 * `expected a document, but the input is empty`，而 spec 要求空输入
 * 「不报错、不输出内容」。
 *
 * 错误定位来自 `YAMLException.mark`。注意 `mark.line` 与 `mark.column`
 * **都是 0 基**，上报给 `ErrorInfo` 前必须各 +1（`ErrorNote` 按 1 基展示）。
 */
export function yamlToJson(text: string, options: YamlToJsonOptions = {}): Result<string> {
  const { indent = 2 } = options
  if (text.trim().length === 0) return ok('')

  try {
    const value: unknown = load(text)
    // 仅含注释的文档会解析出 undefined，而 JSON.stringify(undefined) 返回 undefined 而非字符串
    if (value === undefined) return ok('null')
    return ok(JSON.stringify(value, null, indent))
  } catch (cause) {
    if (cause instanceof YAMLException) {
      const mark = cause.mark
      // 仅注释或仅空白的文档被 js-yaml 视为「空文档」并抛错（此类错误不带 mark），
      // 与 spec 的「空输入不报错、不输出内容」保持一致
      if (mark === undefined && /empty/i.test(cause.reason)) return ok('')
      return err('YAML 语法错误', {
        code: 'BAD_YAML',
        detail: mark ? `解析器报告：${cause.reason}` : cause.reason,
        line: mark ? mark.line + 1 : undefined,
        column: mark ? mark.column + 1 : undefined,
        offset: mark ? mark.position : undefined,
        suggestion: '请检查出错行的缩进与冒号后的空格',
      })
    }
    return err('YAML 语法错误', {
      code: 'BAD_YAML',
      detail: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

/**
 * JSON → YAML。
 *
 * 先用 `scanJson` 严格校验：它的报错带 `line` / `column` / `offset`，
 * 而 `JSON.parse` 的报错文案在 V8 与 JavaScriptCore 上不一致（WKWebView
 * 甚至不给位置），无法满足「指出出错位置」的 Scenario。
 *
 * `lineWidth: -1` 关闭折行、`noRefs: true` 关闭锚点/别名 —— 两者都是
 * 「YAML 再转回 JSON 必须语义等价」的前提。
 */
export function jsonToYaml(text: string): Result<string> {
  if (text.trim().length === 0) return ok('')

  const scanned = scanJson(text)
  if (!scanned.ok) {
    return err(scanned.error, {
      code: scanned.code,
      detail: scanned.detail,
      line: scanned.line,
      column: scanned.column,
      offset: scanned.offset,
      suggestion: scanned.suggestion,
    })
  }

  // 已由 scanJson 严格校验，故此处的 JSON.parse 不会抛错
  const value: unknown = JSON.parse(text)
  return ok(dump(value, { indent: 2, lineWidth: -1, noRefs: true }))
}
