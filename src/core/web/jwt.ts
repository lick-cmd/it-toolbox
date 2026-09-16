import { base64ToBytes, bytesToUtf8 } from '../bytes'
import { parseJsonValue } from '../json/parse'
import { err, ok } from '../result'
import type { ErrorInfo, Result } from '../result'

/**
 * JWT 的一个可解码片段。
 *
 * 三段里只有头部与载荷是 Base64URL 编码的 JSON；签名段只原样保留 —— 本工具
 * 不校验签名，也不尝试解码它（解码结果无意义，且可能不是 UTF-8）。
 */
export interface JwtPart {
  /** 原始片段（Base64URL 文本） */
  segment: string
  /** 解码后的 UTF-8 文本；Base64URL 或 UTF-8 解码失败为 null */
  text: string | null
  /** JSON 解析结果；解析失败为 null */
  value: unknown | null
  /** 解码或解析失败的原因 */
  error?: ErrorInfo
}

export type JwtExpiryStatus = 'expired' | 'valid' | 'absent'

export interface JwtTimeClaim {
  claim: 'exp' | 'iat' | 'nbf'
  /** 中文含义，界面直接展示 */
  label: string
  epochSeconds: number
  /** 本地时间的可读形式 YYYY-MM-DD HH:mm:ss */
  readable: string
}

export interface JwtExpiry {
  status: JwtExpiryStatus
  /** exp 对应的绝对时刻（毫秒）；无 exp 为 null */
  expiresAt: number | null
  /** 已过期或剩余时长（毫秒）；status 为 absent 时为 0 */
  durationMs: number
  /** 时长的人类可读形式，如 "2 天 3 小时"；absent 时为空串 */
  durationText: string
}

export interface JwtDecoded {
  header: JwtPart
  payload: JwtPart
  /** 原始签名片段，不校验、不解码 */
  signature: string
  /** 头部 alg（非字符串时为 null） */
  alg: string | null
  /** 头部 typ（非字符串时为 null） */
  typ: string | null
  /** 按 spec 的枚举顺序 exp → iat → nbf */
  timeClaims: JwtTimeClaim[]
  expiry: JwtExpiry
}

const TIME_CLAIMS: readonly { claim: JwtTimeClaim['claim']; label: string }[] = [
  { claim: 'exp', label: '过期时间' },
  { claim: 'iat', label: '签发时间' },
  { claim: 'nbf', label: '生效时间' },
]

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatEpochSeconds(seconds: number): string {
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return '（超出可表示范围）'
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  )
}

/** 只保留最大的几级单位，够读即可（不足一分钟时以秒呈现） */
function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  const parts: string[] = []
  if (days > 0) parts.push(`${days} 天`)
  if (hours > 0) parts.push(`${hours} 小时`)
  if (minutes > 0) parts.push(`${minutes} 分钟`)
  if (parts.length === 0) parts.push(`${totalSeconds % 60} 秒`)
  return parts.join(' ')
}

function decodePart(segment: string, label: string): JwtPart {
  const part: JwtPart = { segment, text: null, value: null }

  const bytes = base64ToBytes(segment)
  if (!bytes.ok) {
    part.error = {
      error: `${label}不是合法的 Base64URL`,
      code: 'BAD_BASE64',
      detail: bytes.error,
      offset: bytes.offset,
    }
    return part
  }

  const text = bytesToUtf8(bytes.value)
  if (!text.ok) {
    part.error = {
      error: `${label}解码后不是合法的 UTF-8 文本`,
      code: 'BAD_UTF8',
      detail: text.error,
    }
    return part
  }
  part.text = text.value

  const value = parseJsonValue(text.value)
  if (!value.ok) {
    // 保留 text：界面在解析失败时展示原始文本，比只报错有用
    part.error = {
      error: `${label}不是合法的 JSON`,
      code: 'BAD_JSON',
      detail: value.error,
      line: value.line,
      column: value.column,
      offset: value.offset,
    }
    return part
  }

  part.value = value.value
  return part
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function collectTimeClaims(payload: unknown): JwtTimeClaim[] {
  const record = asRecord(payload)
  if (!record) return []

  const claims: JwtTimeClaim[] = []
  for (const { claim, label } of TIME_CLAIMS) {
    const raw = record[claim]
    // 字符串形式的 "1700000000" 不是 JWT 规范的时间声明，忽略而不是猜测
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
    claims.push({ claim, label, epochSeconds: raw, readable: formatEpochSeconds(raw) })
  }
  return claims
}

function computeExpiry(claims: JwtTimeClaim[], now: number): JwtExpiry {
  const exp = claims.find((item) => item.claim === 'exp')
  if (!exp) return { status: 'absent', expiresAt: null, durationMs: 0, durationText: '' }

  const expiresAt = exp.epochSeconds * 1000
  const diff = expiresAt - now
  const durationMs = Math.abs(diff)
  return {
    // 恰好等于当前时刻按已过期待：exp 表示「在该时刻及之后失效」
    status: diff <= 0 ? 'expired' : 'valid',
    expiresAt,
    durationMs,
    durationText: formatDuration(durationMs),
  }
}

/**
 * 解析 JWT。
 *
 * 只有「不是三段」会让整体失败 —— 段数是结构性问题，此时没有任何可展示的内容。
 * 头部 / 载荷各自的问题记录在对应的 `JwtPart.error` 上，因为 spec 要求
 * 「载荷解码失败时仍展示可解码的头部信息」。
 *
 * `now` 可注入，使过期状态的用例不依赖真实时钟。
 */
export function decodeJwt(token: string, now: number = Date.now()): Result<JwtDecoded> {
  const trimmed = token.trim()
  if (trimmed.length === 0) {
    return err('请输入 JWT', { code: 'EMPTY_INPUT' })
  }

  const segments = trimmed.split('.')
  if (segments.length !== 3) {
    return err('JWT 格式不合法', {
      code: 'BAD_SEGMENT_COUNT',
      detail: `JWT 应由三段以 "." 分隔的内容组成，实际为 ${segments.length} 段`,
      suggestion: '标准形式形如 header.payload.signature',
    })
  }

  const [headerSegment = '', payloadSegment = '', signature = ''] = segments
  const header = decodePart(headerSegment, '头部')
  const payload = decodePart(payloadSegment, '载荷')

  const headerRecord = asRecord(header.value)
  const alg = typeof headerRecord?.['alg'] === 'string' ? (headerRecord['alg'] as string) : null
  const typ = typeof headerRecord?.['typ'] === 'string' ? (headerRecord['typ'] as string) : null

  const timeClaims = collectTimeClaims(payload.value)

  return ok({
    header,
    payload,
    signature,
    alg,
    typ,
    timeClaims,
    expiry: computeExpiry(timeClaims, now),
  })
}
