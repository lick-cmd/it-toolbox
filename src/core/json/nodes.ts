import { ok, type Result } from '../result'
import { scanJson } from './scanner'

export type JsonNodeKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

export interface JsonObjectEntry {
  /** 解码后的键。`JSON.parse` 只用来解引用，结构判断一律看 token */
  key: string
  /** 键的原文 token（含引号与转义），JS 输出直接复用它 */
  rawKey: string
  value: JsonNode
}

export interface JsonObjectNode {
  kind: 'object'
  entries: readonly JsonObjectEntry[]
}

export interface JsonArrayNode {
  kind: 'array'
  items: readonly JsonNode[]
}

export interface JsonScalarNode {
  kind: 'string' | 'number' | 'boolean' | 'null'
  /** 原文 token：字符串含引号与转义，数字是原写法（`1e2` / `-0` 不被改写） */
  raw: string
}

export type JsonNode = JsonObjectNode | JsonArrayNode | JsonScalarNode

/**
 * 把 JSON 文本转成最小结构树，**结构、类型与文本全部取自 token**。
 *
 * 不走 `JSON.parse` 的值对象：那会丢大整数精度、丢重复键、改写 `-0` 与 `1e2`。
 * 键解码用 `JSON.parse(rawKey)` —— 单个字符串字面量，无嵌套风险。
 *
 * 与 `tree.ts#buildJsonTree` 的分工：那边带 path / label / summary 等视图信息且有
 * 256 层深度上限（达上限后只消费 token 不建节点）；转换器不能接受静默丢数据，
 * 因此这里自建。递归深度与 `scanJson` 自身同阶 —— 扫描器本就是逐层递归，
 * 能扫完就说明这个深度是安全的。
 */
export function buildJsonNodes(text: string): Result<JsonNode> {
  const scanned = scanJson(text)
  if (!scanned.ok) return scanned

  const tokens = scanned.tokens
  let cursor = 0

  const rawAt = (index: number): string => tokens[index]?.raw ?? ''

  const walk = (): JsonNode => {
    const token = tokens[cursor]
    if (token === undefined) {
      // scanJson 已保证结构完整，这里只为不让异常逃出 Result
      return { kind: 'null', raw: 'null' }
    }

    if (token.raw === '{') {
      cursor++
      const entries: JsonObjectEntry[] = []
      while (cursor < tokens.length && rawAt(cursor) !== '}') {
        const keyToken = tokens[cursor]
        // 键位置不是字符串 token 说明结构判断有误：停手保底，宁可少建节点也不吞异常
        if (keyToken === undefined || keyToken.kind !== 'string') break
        cursor++ // 键
        cursor++ // ':'
        entries.push({
          key: JSON.parse(keyToken.raw) as string,
          rawKey: keyToken.raw,
          value: walk(),
        })
        if (rawAt(cursor) === ',') cursor++
      }
      cursor++ // '}'
      return { kind: 'object', entries }
    }

    if (token.raw === '[') {
      cursor++
      const items: JsonNode[] = []
      while (cursor < tokens.length && rawAt(cursor) !== ']') {
        items.push(walk())
        if (rawAt(cursor) === ',') cursor++
      }
      cursor++ // ']'
      return { kind: 'array', items }
    }

    cursor++
    if (token.kind === 'string') return { kind: 'string', raw: token.raw }
    if (token.kind === 'number') return { kind: 'number', raw: token.raw }
    if (token.raw === 'null') return { kind: 'null', raw: token.raw }
    return { kind: 'boolean', raw: token.raw }
  }

  return ok(walk())
}

/**
 * 是否含超出 JS 安全整数范围的整数字面量。
 *
 * YAML 路径经 `js-yaml` 重新序列化，会丢这类整数的精度，界面据此挂提示条。
 * 扫描器已拒绝前导零，故 `^-?\d+$` 足以判定「是十进制整数字面量」。
 */
export function hasUnsafeInteger(text: string): boolean {
  const scanned = scanJson(text)
  if (!scanned.ok) return false

  for (const token of scanned.tokens) {
    if (token.kind !== 'number') continue
    if (!/^-?\d+$/.test(token.raw)) continue
    if (!Number.isSafeInteger(Number(token.raw))) return true
  }
  return false
}
