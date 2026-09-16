import { describe, expect, it } from 'vitest'
import { decodeUrl, encodeUrl, URL_CODEC_MODES, URL_DIRECTIONS } from './url-codec'

/** 断言成功并取值；失败时把错误原样抛出，便于定位 */
function mustEncode(text: string, mode: Parameters<typeof encodeUrl>[1]): string {
  const result = encodeUrl(text, mode)
  if (!result.ok) throw new Error(`期望编码成功，实际失败：${result.error}`)
  return result.value
}

function mustDecode(text: string, mode: Parameters<typeof decodeUrl>[1]): string {
  const result = decodeUrl(text, mode)
  if (!result.ok) throw new Error(`期望解码成功，实际失败：${result.error}`)
  return result.value
}

describe('encodeUrl', () => {
  it('组件模式等价于 encodeURIComponent', () => {
    expect(mustEncode('a b&c=d', 'component')).toBe('a%20b%26c%3Dd')
  })

  it('整体 URI 模式保留 :/?&= 等结构字符，只编码空格等非法字符', () => {
    const encoded = mustEncode('https://a.com/b c?d=e&f=g', 'uri')
    expect(encoded).toBe('https://a.com/b%20c?d=e&f=g')
    expect(encoded).toContain('://')
    expect(encoded).toContain('?d=e&f=g')
  })

  it('表单模式把空格编码为 +', () => {
    expect(mustEncode('a b', 'form')).toBe('a+b')
    expect(mustEncode('a b', 'form')).not.toContain('%20')
  })

  it('落单代理项返回 BAD_SURROGATE 而不是抛异常', () => {
    const result = encodeUrl('\uD800', 'component')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_SURROGATE')
      expect(result.suggestion).toBeTruthy()
    }
  })

  it('空输入原样返回空串', () => {
    expect(mustEncode('', 'component')).toBe('')
  })
})

describe('decodeUrl', () => {
  it('组件模式解码', () => {
    expect(mustDecode('a%20b%26c%3Dd', 'component')).toBe('a b&c=d')
  })

  it('表单模式把 + 还原为空格', () => {
    expect(mustDecode('a+b', 'form')).toBe('a b')
  })

  it('整体 URI 模式保留结构字符不被解码', () => {
    expect(mustDecode('https://a.com/b%20c?d=e&f=g', 'uri')).toBe('https://a.com/b c?d=e&f=g')
  })

  it('中文与 emoji 往返一致', () => {
    const source = '你好，世界 —— 🚀 emoji'
    for (const mode of ['component', 'uri', 'form'] as const) {
      expect(mustDecode(mustEncode(source, mode), mode)).toBe(source)
    }
  })

  it('以 % 结尾的不完整转义序列被拒绝并定位', () => {
    const result = decodeUrl('abc%', 'component')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_ESCAPE')
      expect(result.offset).toBe(3)
      expect(result.detail).toContain('%')
    }
  })

  it('包含 %ZZ 的内容被拒绝', () => {
    const result = decodeUrl('%ZZ', 'component')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_ESCAPE')
      expect(result.offset).toBe(0)
    }
  })

  it('合法的转义序列不被误报', () => {
    expect(mustDecode('%E4%B8%AD%E6%96%87', 'component')).toBe('中文')
  })

  it('转义合法但解码后不是合法 UTF-8 时同样被拒绝', () => {
    const result = decodeUrl('%E4%BD', 'component')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_ESCAPE')
      expect(result.error).toContain('非法')
    }
  })

  it('表单模式下 `+` 先还原为空格再判断转义', () => {
    expect(mustDecode('a+b%20c', 'form')).toBe('a b c')
  })

  it('空输入原样返回空串', () => {
    expect(mustDecode('', 'component')).toBe('')
  })
})

describe('选项常量', () => {
  it('提供三种编码模式与两个方向', () => {
    expect(URL_CODEC_MODES.map((item) => item.value)).toEqual(['component', 'uri', 'form'])
    expect(URL_DIRECTIONS.map((item) => item.value)).toEqual(['encode', 'decode'])
  })
})
