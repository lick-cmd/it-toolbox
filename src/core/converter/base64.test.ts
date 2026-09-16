import { describe, expect, it } from 'vitest'
import { decodeToBytes, decodeToText, encodeBytes, encodeText } from './base64'

function mustDecode(text: string): string {
  const result = decodeToText(text)
  if (!result.ok) throw new Error(`期望解码成功，实际失败：${result.error}`)
  return result.value
}

describe('encodeText / decodeToText', () => {
  it('标准变体编码 hello → aGVsbG8=', () => {
    expect(encodeText('hello')).toBe('aGVsbG8=')
  })

  it('标准变体解码 aGVsbG8= → hello', () => {
    expect(mustDecode('aGVsbG8=')).toBe('hello')
  })

  it('中文往返不产生乱码', () => {
    const text = '你好，世界 —— IT 工具箱'
    expect(mustDecode(encodeText(text))).toBe(text)
  })

  it('关闭填充后末尾无 = 且可被自身解码', () => {
    const encoded = encodeText('hello', { padding: false })
    expect(encoded).toBe('aGVsbG8')
    expect(encoded.endsWith('=')).toBe(false)
    expect(mustDecode(encoded)).toBe('hello')
  })
})

describe('URL-safe 变体', () => {
  it('标准变体会产出 + 与 /，URL-safe 变体改用 - 与 _', () => {
    const bytes = Uint8Array.of(0xff, 0xff, 0xff)
    expect(encodeBytes(bytes)).toBe('////')
    const urlsafe = encodeBytes(bytes, { variant: 'urlsafe' })
    expect(urlsafe).toBe('____')
    expect(urlsafe).not.toContain('+')
    expect(urlsafe).not.toContain('/')
  })

  it('URL-safe 变体的输出可被解码还原', () => {
    const bytes = Uint8Array.of(0xfb, 0xef, 0xbe)
    const urlsafe = encodeBytes(bytes, { variant: 'urlsafe', padding: false })
    const decoded = decodeToBytes(urlsafe)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(Array.from(decoded.value)).toEqual([0xfb, 0xef, 0xbe])
  })
})

describe('错误分支', () => {
  it('包含非法字符时解码失败并定位到该字符', () => {
    const result = decodeToText('abc!@#')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_BASE64_CHAR')
      expect(result.offset).toBe(3)
      expect(result.detail).toContain('!')
    }
  })

  it('解码出的字节不是合法 UTF-8 文本时返回 BAD_UTF8', () => {
    // 0xff 单独出现不是合法的 UTF-8 起始字节
    const result = decodeToText('/w==')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('BAD_UTF8')
  })

  it('空输入解码为空字节序列', () => {
    const result = decodeToBytes('')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.length).toBe(0)
  })

  it('容忍换行与空白（从日志 / 邮件粘贴的常态）', () => {
    expect(mustDecode('aGVs\nbG8=\n')).toBe('hello')
  })
})

describe('二进制安全', () => {
  it('任意字节往返保持逐字节一致', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index)
    const encoded = encodeBytes(bytes, { variant: 'urlsafe' })
    const decoded = decodeToBytes(encoded)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(Array.from(decoded.value)).toEqual(Array.from(bytes))
  })
})
