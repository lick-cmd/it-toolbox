import { describe, expect, it } from 'vitest'
import { err, ok, unwrapOr } from './result'

describe('Result', () => {
  it('ok 包装成功值与判别字段', () => {
    const r = ok(42)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(42)
  })

  it('err 只要求 error 字段', () => {
    const r = err('解析失败')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('解析失败')
      expect(r.line).toBeUndefined()
    }
  })

  it('err 保留三项定位信息', () => {
    const r = err('意外字符', { offset: 12, line: 2, column: 3 })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.offset).toBe(12)
      expect(r.line).toBe(2)
      expect(r.column).toBe(3)
    }
  })

  it('err 保留机器可判别的错误码与建议', () => {
    const r = err('不是绝对 URL', { code: 'NOT_ABSOLUTE', suggestion: 'https://a.com' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('NOT_ABSOLUTE')
      expect(r.suggestion).toBe('https://a.com')
    }
  })

  it('unwrapOr 在成功时取值、失败时取兜底', () => {
    expect(unwrapOr(ok('a'), 'z')).toBe('a')
    expect(unwrapOr<string>(err('boom'), 'z')).toBe('z')
  })
})
