import { pickChars } from '../random'

export type CharsetId = 'alphanumeric' | 'hex' | 'base64' | 'base64url' | 'custom'

export interface TokenOptions {
  /**
   * 随机段长度（不含前缀）。按**码点**计数：自定义字符集里含代理对字符（如 emoji）时，
   * 返回值的 UTF-16 `length` 会大于该值。
   */
  length: number
  count: number
  charset: CharsetId
  /** 仅在 charset === 'custom' 时使用 */
  custom?: string
  /** 加在随机段之前，不计入 length */
  prefix?: string
}

export const ALPHANUMERIC = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
export const HEX_CHARSET = '0123456789abcdef'
export const BASE64_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export const BASE64URL_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export const MAX_LENGTH = 4_096
export const MAX_COUNT = 1_000
/** 单次生成的随机字符总数上限：避免超大参数让界面长时间无响应。 */
export const MAX_TOTAL_LENGTH = 100_000

const BUILTIN_CHARSETS: Record<Exclude<CharsetId, 'custom'>, string> = {
  alphanumeric: ALPHANUMERIC,
  hex: HEX_CHARSET,
  base64: BASE64_CHARSET,
  base64url: BASE64URL_CHARSET,
}

/**
 * 解析字符集。
 *
 * 自定义字符集**去重**：重复字符会让该字符被选中的概率成倍提高，密码学场景下这种
 * 偏斜不可接受。全空白视为空 —— 否则会产出肉眼不可见的 Token。
 *
 * 注意 `pickChars` 内部用 `[...alphabet]` 计数，重复字符会被算两次，故去重必须在这里完成，
 * 不能留给调用方。
 */
export function resolveCharset(charset: CharsetId, custom = ''): string {
  if (charset !== 'custom') {
    const builtin: string | undefined = BUILTIN_CHARSETS[charset]
    // 运行期兜底：类型之外传进来的非法值，不应该以 TypeError 的形式炸在 random.ts 里
    if (builtin === undefined) {
      throw new RangeError(`未知的字符集：${String(charset)}`)
    }
    return builtin
  }

  if (custom.trim().length === 0) {
    throw new RangeError('自定义字符集不可为空')
  }

  const distinct = [...new Set([...custom])].join('')
  if (distinct.length < 2) {
    throw new RangeError('自定义字符集至少需要 2 个不同字符')
  }
  return distinct
}

export function generateTokens(options: TokenOptions): string[] {
  const { length, count, charset, custom = '', prefix = '' } = options

  if (!Number.isInteger(length) || length < 1 || length > MAX_LENGTH) {
    throw new RangeError(`长度必须为 1 到 ${MAX_LENGTH} 之间的整数`)
  }
  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
    throw new RangeError(`数量必须为 0 到 ${MAX_COUNT} 之间的整数`)
  }
  // 前缀是自由文本，同样占用界面渲染与复制的时间，必须计入总量
  if ((length + prefix.length) * count > MAX_TOTAL_LENGTH) {
    throw new RangeError(`单次生成的字符总数不得超过 ${MAX_TOTAL_LENGTH}`)
  }

  const alphabet = resolveCharset(charset, custom)

  const output: string[] = []
  for (let i = 0; i < count; i++) {
    output.push(prefix + pickChars(alphabet, length))
  }
  return output
}
