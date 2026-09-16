import { describe, expect, it } from 'vitest'
import { decodeJwt, type JwtDecoded } from './jwt'

const b64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

const b64urlText = (text: string): string => Buffer.from(text, 'utf8').toString('base64url')

/** exp = 1700000000（2023-11-14T22:13:20Z），相对当前时间必然是过期状态 */
const EXPIRED_TOKEN = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
  sub: '1',
  exp: 1_700_000_000,
  iat: 1_690_000_000,
  nbf: 1_690_000_000,
})}.c2ln`

function mustDecode(token: string, now?: number): JwtDecoded {
  const result = now === undefined ? decodeJwt(token) : decodeJwt(token, now)
  if (!result.ok) throw new Error(`期望解析成功，实际失败：${result.error}`)
  return result.value
}

describe('decodeJwt —— 三段拆解', () => {
  it('分别解出头部与载荷的 JSON，并保留签名片段', () => {
    const decoded = mustDecode(EXPIRED_TOKEN)
    expect(decoded.header.value).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect((decoded.payload.value as Record<string, unknown>)['sub']).toBe('1')
    expect(decoded.signature).toBe('c2ln')
    expect(decoded.header.segment).toBe(EXPIRED_TOKEN.split('.')[0])
  })

  it('头部摘要给出 alg 与 typ', () => {
    const decoded = mustDecode(EXPIRED_TOKEN)
    expect(decoded.alg).toBe('HS256')
    expect(decoded.typ).toBe('JWT')
  })

  it('头部缺少 alg / typ 时摘要为 null 而不是报错', () => {
    const token = `${b64url({ kid: 'k1' })}.${b64url({ a: 1 })}.sig`
    const decoded = mustDecode(token)
    expect(decoded.alg).toBeNull()
    expect(decoded.typ).toBeNull()
  })

  it('容忍前后空白（从日志粘贴的常态）', () => {
    expect(mustDecode(`  ${EXPIRED_TOKEN}  `).signature).toBe('c2ln')
  })

  it('载荷解码后的文本同时保留，供解析失败时展示', () => {
    expect(mustDecode(EXPIRED_TOKEN).payload.text).toContain('"sub"')
  })

  it('签名段为空串时也能解析（alg=none 的形态）', () => {
    const token = `${b64url({ alg: 'none' })}.${b64url({ a: 1 })}.`
    expect(mustDecode(token).signature).toBe('')
  })
})

describe('decodeJwt —— 段数不合法', () => {
  it('两段被拒绝并指出实际段数', () => {
    const result = decodeJwt('eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('BAD_SEGMENT_COUNT')
    expect(result.error).toContain('JWT 格式不合法')
    expect(result.detail).toContain('2 段')
  })

  it('四段被拒绝', () => {
    const result = decodeJwt('a.b.c.d')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_SEGMENT_COUNT')
      expect(result.detail).toContain('4 段')
    }
  })

  it('空输入返回 EMPTY_INPUT', () => {
    const result = decodeJwt('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('EMPTY_INPUT')
  })
})

describe('decodeJwt —— 载荷异常', () => {
  it('载荷不是合法 JSON 时报错，但仍给出头部', () => {
    const token = `${b64url({ alg: 'none' })}.${b64urlText('not json')}.sig`
    const decoded = mustDecode(token)
    expect(decoded.header.value).toEqual({ alg: 'none' })
    expect(decoded.payload.value).toBeNull()
    expect(decoded.payload.error?.error).toContain('载荷不是合法的 JSON')
    expect(decoded.payload.text).toBe('not json')
  })

  it('载荷不是合法 Base64URL 时报错且不产出文本', () => {
    const token = `${b64url({ alg: 'none' })}.!!!!.sig`
    const decoded = mustDecode(token)
    expect(decoded.payload.error?.code).toBe('BAD_BASE64')
    expect(decoded.payload.text).toBeNull()
  })

  it('载荷 Base64URL 合法但不是 UTF-8 时报错', () => {
    const token = `${b64url({ alg: 'none' })}.${Buffer.from([0xff, 0xfe]).toString('base64url')}.sig`
    const decoded = mustDecode(token)
    expect(decoded.payload.error?.code).toBe('BAD_UTF8')
  })

  it('载荷解析失败时时间声明与过期状态都为空', () => {
    const token = `${b64url({ alg: 'none' })}.${b64urlText('nope')}.sig`
    const decoded = mustDecode(token)
    expect(decoded.timeClaims).toEqual([])
    expect(decoded.expiry.status).toBe('absent')
  })

  it('头部异常时载荷仍可正常展示', () => {
    const token = `${b64urlText('oops')}.${b64url({ exp: 4_102_444_800 })}.sig`
    const decoded = mustDecode(token)
    expect(decoded.header.error?.error).toContain('头部不是合法的 JSON')
    expect(decoded.payload.value).toEqual({ exp: 4_102_444_800 })
  })
})

describe('decodeJwt —— 时间声明与过期状态', () => {
  it('exp / iat / nbf 都给出可读时间与中文含义', () => {
    const decoded = mustDecode(EXPIRED_TOKEN)
    expect(decoded.timeClaims.map((item) => item.claim)).toEqual(['exp', 'iat', 'nbf'])
    expect(decoded.timeClaims.map((item) => item.label)).toEqual([
      '过期时间',
      '签发时间',
      '生效时间',
    ])

    const exp = decoded.timeClaims[0]!
    expect(exp.epochSeconds).toBe(1_700_000_000)
    expect(exp.readable).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    // 可读时间是本地时区，故比较换算后的毫秒数
    expect(new Date(exp.readable.replace(' ', 'T')).getTime()).toBe(1_700_000_000_000)
  })

  it('仅声明部分时间字段时只输出声明了的那些', () => {
    const token = `${b64url({ alg: 'none' })}.${b64url({ exp: 1_700_000_000 })}.sig`
    expect(mustDecode(token).timeClaims.map((item) => item.claim)).toEqual(['exp'])
  })

  it('非数字的时间声明被忽略', () => {
    const token = `${b64url({ alg: 'none' })}.${b64url({ exp: '1700000000' })}.sig`
    expect(mustDecode(token).timeClaims).toEqual([])
    expect(mustDecode(token).expiry.status).toBe('absent')
  })

  it('exp 早于当前时间：判定过期并给出已过期时长', () => {
    const now = 1_700_000_000_000 + 2 * 86_400_000 + 3 * 3_600_000
    const decoded = mustDecode(EXPIRED_TOKEN, now)
    expect(decoded.expiry.status).toBe('expired')
    expect(decoded.expiry.expiresAt).toBe(1_700_000_000_000)
    expect(decoded.expiry.durationMs).toBe(2 * 86_400_000 + 3 * 3_600_000)
    expect(decoded.expiry.durationText).toBe('2 天 3 小时')
  })

  it('exp 晚于当前时间：判定有效并给出剩余时间', () => {
    const now = 1_700_000_000_000 - 90_000
    const decoded = mustDecode(EXPIRED_TOKEN, now)
    expect(decoded.expiry.status).toBe('valid')
    expect(decoded.expiry.durationMs).toBe(90_000)
    expect(decoded.expiry.durationText).toBe('1 分钟')
  })

  it('exp 恰好等于当前时间按已过期待', () => {
    expect(mustDecode(EXPIRED_TOKEN, 1_700_000_000_000).expiry.status).toBe('expired')
  })

  it('不含 exp 时状态为 absent，时长为空', () => {
    const token = `${b64url({ alg: 'none' })}.${b64url({ iat: 1_690_000_000 })}.sig`
    const decoded = mustDecode(token)
    expect(decoded.expiry.status).toBe('absent')
    expect(decoded.expiry.expiresAt).toBeNull()
    expect(decoded.expiry.durationText).toBe('')
  })

  it('秒级时长不足一分钟时以秒呈现', () => {
    const now = 1_700_000_000_000 - 45_000
    expect(mustDecode(EXPIRED_TOKEN, now).expiry.durationText).toBe('45 秒')
  })

  it('载荷不是对象时（数组 / 标量）不产生时间声明', () => {
    const token = `${b64url({ alg: 'none' })}.${b64url([1, 2, 3])}.sig`
    expect(mustDecode(token).timeClaims).toEqual([])
  })

  it('毫秒级时长包含天与小时两级', () => {
    const now = 1_700_000_000_000 - (86_400_000 + 3_600_000)
    expect(mustDecode(EXPIRED_TOKEN, now).expiry.durationText).toBe('1 天 1 小时')
  })
})
