import { utf8ByteLength } from '../bytes'
import { ok, type Result } from '../result'
import { scanJson } from './scanner'

export interface JsonTextResult {
  output: string
  inputBytes: number
  outputBytes: number
}

/**
 * 逐 token 去空白：字符串 token 原样输出，因此转义字面量不被规范化。
 *
 * 若改为「解析成值再序列化」，"\u0041" 会变成 "A"、"\/" 会变成 "/"，
 * 与 spec 要求的逐字节往返相冲突。
 */
export function minifyJson(text: string): Result<JsonTextResult> {
  const scanned = scanJson(text)
  if (!scanned.ok) return scanned

  const output = scanned.tokens.map((token) => token.raw).join('')
  return ok({
    output,
    inputBytes: utf8ByteLength(text),
    outputBytes: utf8ByteLength(output),
  })
}
