/**
 * 解析类操作的统一返回类型。
 *
 * 设计取舍：仅用于「非法输入是常规路径」的解析类函数
 * （JSON / YAML / JWT / URL / Base64 / 日期）。
 * 生成类操作（token / uuid / ulid / hmac / rsa）的输入由控件约束，直接返回终值。
 */
export type Result<T> = { ok: true; value: T } | ({ ok: false } & ErrorInfo)

export interface ErrorInfo {
  /** 面向用户的错误原因 */
  error: string
  /** 机器可判别的错误码，例如 'NOT_ABSOLUTE'、'BAD_ESCAPE' */
  code?: string
  /** 补充说明 */
  detail?: string
  /** 可操作的修复建议 */
  suggestion?: string
  /** 字符偏移（0 基） */
  offset?: number
  /** 行号（1 基） */
  line?: number
  /** 列号（1 基） */
  column?: number
}

export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function err(error: string, info?: Omit<ErrorInfo, 'error'>): Result<never> {
  return { ok: false, error, ...info }
}

/** 成功时取值，失败时返回兜底值。 */
export function unwrapOr<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.value : fallback
}
