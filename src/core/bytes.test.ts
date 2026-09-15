import { describe, expect, it } from 'vitest'
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  bytesToUtf8,
  hexToBytes,
  utf8ToBytes,
} from './bytes'

describe('hex', () => {
  it('编码为小写十六进制', () => {
    expect(bytesToHex(new Uint8Array([0x00, 0x0f, 0xff, 0xab]))).toBe('000fffab')
  })

  it('可按需输出大写', () => {
    expect(bytesToHex(new Uint8Array([0xab]), true)).toBe('AB')
  })

  it('解码忽略空白', () => {
    const r = hexToBytes('ab cd\nef')
    expect(r.ok).toBe(true)
    if (r.ok) expect(bytesToHex(r.value)).toBe('abcdef')
  })

  it('往返一致', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255])
    const r = hexToBytes(bytesToHex(bytes))
    expect(r.ok).toBe(true)
    if (r.ok) expect([...r.value]).toEqual([...bytes])
  })

  it('非十六进制字符报错并指出位置', () => {
    const r = hexToBytes('abz1')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('BAD_HEX_CHAR')
      expect(r.offset).toBe(2)
    }
  })

  it('奇数长度报错', () => {
    const r = hexToBytes('abc')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('BAD_HEX_LENGTH')
  })

  it('空输入得到空字节', () => {
    const r = hexToBytes('')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.length).toBe(0)
  })
})

describe('utf8', () => {
  it('中文与 emoji 往返一致', () => {
    const text = '工具箱 Toolbox 🧰'
    const r = bytesToUtf8(utf8ToBytes(text))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(text)
  })

  it('非法字节序列报错而非静默替换', () => {
    // 0xff 不是合法的 UTF-8 起始字节
    const r = bytesToUtf8(new Uint8Array([0xff, 0xfe]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('BAD_UTF8')
  })
})

describe('base64', () => {
  it('标准字母表带填充', () => {
    expect(bytesToBase64(utf8ToBytes('hello'))).toBe('aGVsbG8=')
  })

  it('可去掉填充', () => {
    expect(bytesToBase64(utf8ToBytes('hello'), { padding: false })).toBe('aGVsbG8')
  })

  it('url-safe 使用 - 与 _', () => {
    // 0xfb 0xff 0xbf 编码后在标准字母表中为 +/+/，url-safe 中为 -_-_
    // 该断言同时覆盖 '-' 与 '_' 两个被替换的字符（缺一即未真正验证映射）
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf])
    expect(bytesToBase64(bytes)).toBe('+/+/')
    expect(bytesToBase64(bytes, { variant: 'urlsafe' })).toBe('-_-_')
  })

  it('中文往返一致（标准）', () => {
    const text = '工具箱'
    const r = base64ToBytes(bytesToBase64(utf8ToBytes(text)))
    expect(r.ok).toBe(true)
    if (r.ok) expect(bytesToUtf8(r.value)).toEqual({ ok: true, value: text })
  })

  it('中文往返一致（url-safe 无填充）', () => {
    const text = '工具箱 Toolbox 🧰'
    const encoded = bytesToBase64(utf8ToBytes(text), { variant: 'urlsafe', padding: false })
    const r = base64ToBytes(encoded)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const decoded = bytesToUtf8(r.value)
      expect(decoded.ok).toBe(true)
      if (decoded.ok) expect(decoded.value).toBe(text)
    }
  })

  it('解码容忍空白与换行', () => {
    const r = base64ToBytes('aGVs\nbG8=')
    expect(r.ok).toBe(true)
    if (r.ok) expect(bytesToUtf8(r.value)).toEqual({ ok: true, value: 'hello' })
  })

  it('解码容忍缺失填充', () => {
    const r = base64ToBytes('aGVsbG8')
    expect(r.ok).toBe(true)
    if (r.ok) expect(bytesToUtf8(r.value)).toEqual({ ok: true, value: 'hello' })
  })

  it('非法字符报错并指出位置', () => {
    const r = base64ToBytes('aGVs!G8=')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('BAD_BASE64_CHAR')
      expect(r.offset).toBe(4)
    }
  })

  it('长度余数为 1 报错', () => {
    const r = base64ToBytes('aGVsb')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('BAD_BASE64_LENGTH')
  })

  it('空输入得到空字节', () => {
    const r = base64ToBytes('')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.length).toBe(0)
  })
})
