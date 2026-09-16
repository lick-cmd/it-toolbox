import { describe, expect, it } from 'vitest'
import { analyzeUrl, DEFAULT_PORTS, NON_ABSOLUTE_PREFIX, type UrlAnalysis } from './url-analyzer'

function analyze(input: string): UrlAnalysis {
  const result = analyzeUrl(input)
  if (!result.ok) throw new Error(`期望解析成功，实际失败：${result.error}`)
  return result.value
}

/** 取某个查询参数键的全部取值（原始形式） */
function valuesOf(analysis: UrlAnalysis, key: string): string[] {
  return analysis.params
    .filter((param) => param.key.decoded === key)
    .map((param) => param.value.raw)
}

describe('analyzeUrl —— 完整拆解', () => {
  const FULL = 'https://user:pass@example.com:8443/a/b?x=1&x=2#sec'

  it('拆出协议 / 用户名 / 密码 / 主机名 / 端口 / 路径 / 片段', () => {
    const analysis = analyze(FULL)
    expect(analysis.protocol).toBe('https:')
    expect(analysis.username).toBe('user')
    expect(analysis.password).toBe('pass')
    expect(analysis.hostname).toBe('example.com')
    expect(analysis.explicitPort).toBe('8443')
    expect(analysis.port).toBe('8443')
    expect(analysis.pathname.raw).toBe('/a/b')
    expect(analysis.hash.raw).toBe('sec')
  })

  it('同名查询参数的两个取值都保留且顺序不变', () => {
    const analysis = analyze(FULL)
    expect(analysis.params).toHaveLength(2)
    expect(valuesOf(analysis, 'x')).toEqual(['1', '2'])
  })

  it('Origin 含显式端口', () => {
    expect(analyze(FULL).origin).toBe('https://example.com:8443')
  })

  it('无查询、无片段时对应部分为空', () => {
    const analysis = analyze('https://example.com/')
    expect(analysis.params).toEqual([])
    expect(analysis.search).toBe('')
    expect(analysis.hash.raw).toBe('')
  })

  it('键没有等号时值按空串处理', () => {
    const analysis = analyze('https://example.com/?flag')
    expect(analysis.params).toHaveLength(1)
    expect(analysis.params[0]?.key.raw).toBe('flag')
    expect(analysis.params[0]?.value.raw).toBe('')
  })
})

describe('analyzeUrl —— Origin 与默认端口', () => {
  it('未写端口时补默认端口并标注', () => {
    const analysis = analyze('https://example.com/path')
    expect(analysis.explicitPort).toBeNull()
    expect(analysis.port).toBe('443')
    expect(analysis.isDefaultPort).toBe(true)
  })

  it('默认端口的 Origin 不含端口', () => {
    expect(analyze('https://example.com/path').origin).toBe('https://example.com')
  })

  it('显式写出默认端口时仍能识别为「用户写出的端口」', () => {
    const analysis = analyze('https://example.com:443/path')
    expect(analysis.explicitPort).toBe('443')
    expect(analysis.isDefaultPort).toBe(true)
    expect(analysis.origin).toBe('https://example.com')
  })

  it('非默认端口不算默认', () => {
    const analysis = analyze('http://example.com:8443/')
    expect(analysis.port).toBe('8443')
    expect(analysis.isDefaultPort).toBe(false)
    expect(DEFAULT_PORTS['http:']).toBe('80')
  })

  it('无默认端口表的协议（如 file:）端口为空', () => {
    const analysis = analyze('file:///tmp/x')
    expect(analysis.explicitPort).toBeNull()
    expect(analysis.port).toBe('')
    expect(analysis.isDefaultPort).toBe(false)
  })

  it('IPv6 主机的中括号与端口都能识别', () => {
    const analysis = analyze('http://[::1]:8080/x')
    expect(analysis.hostname).toBe('[::1]')
    expect(analysis.explicitPort).toBe('8080')
    expect(analysis.port).toBe('8080')
  })

  it('IPv6 主机未写端口时为默认端口', () => {
    const analysis = analyze('http://[::1]/x')
    expect(analysis.explicitPort).toBeNull()
    expect(analysis.port).toBe('80')
    expect(analysis.isDefaultPort).toBe(true)
  })
})

describe('analyzeUrl —— 路径分段与编码字符', () => {
  it('路径拆成逐段展示', () => {
    const analysis = analyze('https://example.com/a/b/c')
    expect(analysis.pathSegments.map((segment) => segment.raw)).toEqual(['a', 'b', 'c'])
  })

  it('路径中的百分号编码同时给出原始与解码形式', () => {
    const analysis = analyze('https://example.com/%E4%B8%AD%E6%96%87/x')
    expect(analysis.pathname.raw).toBe('/%E4%B8%AD%E6%96%87/x')
    expect(analysis.pathname.decoded).toBe('/中文/x')
    expect(analysis.pathname.encoded).toBe(true)
    expect(analysis.pathSegments[0]).toEqual({
      raw: '%E4%B8%AD%E6%96%87',
      decoded: '中文',
      encoded: true,
    })
    expect(analysis.pathSegments[1]).toEqual({ raw: 'x', decoded: 'x', encoded: false })
  })

  it('查询参数的键与值都给出两种形式', () => {
    const analysis = analyze('https://example.com/?a%20b=c%2Bd')
    expect(analysis.params[0]?.key).toEqual({ raw: 'a%20b', decoded: 'a b', encoded: true })
    expect(analysis.params[0]?.value).toEqual({ raw: 'c%2Bd', decoded: 'c+d', encoded: true })
  })

  it('查询参数里的 + 按空格解释', () => {
    const analysis = analyze('https://example.com/?q=a+b')
    expect(analysis.params[0]?.value.decoded).toBe('a b')
    expect(analysis.params[0]?.value.encoded).toBe(true)
  })

  it('片段也被解码', () => {
    const analysis = analyze('https://example.com/#%E6%AE%B5')
    expect(analysis.hash.raw).toBe('%E6%AE%B5')
    expect(analysis.hash.decoded).toBe('段')
  })

  it('路径里的非法转义序列不会让整体失败，只退化为原始形式', () => {
    const analysis = analyze('https://example.com/%zz')
    expect(analysis.pathname.raw).toBe('/%zz')
    expect(analysis.pathname.decoded).toBe('/%zz')
    expect(analysis.pathname.encoded).toBe(false)
  })

  it('路径为根时没有分段', () => {
    expect(analyze('https://example.com').pathSegments).toEqual([])
  })

  it('路径末尾的斜杠不产生空分段', () => {
    expect(analyze('https://example.com/a/').pathSegments.map((s) => s.raw)).toEqual(['a'])
  })
})

describe('analyzeUrl —— 非绝对与非法输入', () => {
  it('无协议输入提示不是绝对 URL 并给出 https 补全建议', () => {
    const result = analyzeUrl('example.com/a?x=1')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('NOT_ABSOLUTE')
    expect(result.error).toContain('不是绝对 URL')
    expect(result.suggestion).toBe(`${NON_ABSOLUTE_PREFIX}example.com/a?x=1`)
  })

  it('相对路径同样提示不是绝对 URL', () => {
    const result = analyzeUrl('/a/b?x=1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NOT_ABSOLUTE')
  })

  it('补全后仍无法解析的输入按非法 URL 处理', () => {
    const result = analyzeUrl(':::')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('INVALID_URL')
      expect(result.suggestion).toBeTruthy()
    }
  })

  it('有协议但语法非法时按非法 URL 处理', () => {
    const result = analyzeUrl('https://exa mple.com/path')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_URL')
  })

  it('只有协议没有主机时按非法 URL 处理', () => {
    const result = analyzeUrl('https://')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_URL')
  })

  it('空输入返回 EMPTY_INPUT', () => {
    const result = analyzeUrl('  ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('EMPTY_INPUT')
  })
})
