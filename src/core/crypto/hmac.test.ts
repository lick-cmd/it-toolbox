import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64, bytesToHex, utf8ToBytes } from '../bytes'
import type { Result } from '../result'
import { computeHmac, decodeInput } from './hmac'

/** 取出成功结果；失败直接抛错，避免每个断言都写一遍 ok 收窄。 */
function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`期望成功，实际失败：${result.error}`)
  return result.value
}

/** RFC 4231 第 1 组测试向量：密钥为 20 字节 0x0b，消息为 "Hi There"。 */
const RFC4231_KEY_HEX = '0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'
const RFC4231_MESSAGE = 'Hi There'

const BASE_OPTIONS = {
  message: RFC4231_MESSAGE,
  key: RFC4231_KEY_HEX,
  algorithm: 'SHA-256',
  messageEncoding: 'utf8',
  keyEncoding: 'hex',
  outputEncoding: 'hex',
} as const

describe('decodeInput', () => {
  it('三种编码各自解码', () => {
    expect([...unwrap(decodeInput('aGk=', 'base64'))]).toEqual([0x68, 0x69])
    expect([...unwrap(decodeInput('6869', 'hex'))]).toEqual([0x68, 0x69])
    expect([...unwrap(decodeInput('hi', 'utf8'))]).toEqual([0x68, 0x69])
  })

  it('非法 hex 返回错误且带偏移', () => {
    const result = decodeInput('68zz', 'hex')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_HEX_CHAR')
      expect(result.offset).toBe(2)
    }
  })

  it('非法 base64 返回错误', () => {
    const result = decodeInput('aGk=!!', 'base64')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('BAD_BASE64_CHAR')
  })
})

describe('computeHmac', () => {
  it('RFC 4231 向量：HMAC-SHA-256 的十六进制输出与标准值一致', async () => {
    const result = await computeHmac(BASE_OPTIONS)

    expect(unwrap(result)).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    )
  })

  it('十六进制密钥 6b6579 与 UTF-8 密钥 key 结果一致', async () => {
    const fromHex = await computeHmac({ ...BASE_OPTIONS, key: '6b6579' })
    const fromText = await computeHmac({ ...BASE_OPTIONS, key: 'key', keyEncoding: 'utf8' })

    expect(unwrap(fromHex)).toBe(unwrap(fromText))
  })

  it('切换算法改变摘要长度：SHA-256 → 64 字符，SHA-512 → 128 字符', async () => {
    const sha256 = unwrap(await computeHmac(BASE_OPTIONS))
    const sha512 = unwrap(await computeHmac({ ...BASE_OPTIONS, algorithm: 'SHA-512' }))

    expect(sha256).toHaveLength(64)
    expect(sha512).toHaveLength(128)
    expect(sha512.startsWith(sha256)).toBe(false)
  })

  it('SHA-1 与 SHA-384 也可用，长度分别为 40 与 96', async () => {
    const sha1 = unwrap(await computeHmac({ ...BASE_OPTIONS, algorithm: 'SHA-1' }))
    const sha384 = unwrap(await computeHmac({ ...BASE_OPTIONS, algorithm: 'SHA-384' }))

    expect(sha1).toHaveLength(40)
    expect(sha384).toHaveLength(96)
  })

  it('输出格式切换：base64 解码后的字节与 hex 输出逐字节一致', async () => {
    const hex = unwrap(await computeHmac(BASE_OPTIONS))
    const base64 = unwrap(await computeHmac({ ...BASE_OPTIONS, outputEncoding: 'base64' }))

    expect(bytesToHex(unwrap(base64ToBytes(base64)))).toBe(hex)
  })

  it('base64url 输出无填充，且解码后与 hex 输出逐字节一致', async () => {
    const hex = unwrap(await computeHmac(BASE_OPTIONS))
    const url = unwrap(await computeHmac({ ...BASE_OPTIONS, outputEncoding: 'base64url' }))

    expect(url).not.toContain('=')
    expect(url).not.toMatch(/[+/]/)
    expect(bytesToHex(unwrap(base64ToBytes(url)))).toBe(hex)
  })

  it('消息的三种编码指向同一字节时结果一致', async () => {
    const utf8 = unwrap(await computeHmac({ ...BASE_OPTIONS, messageEncoding: 'utf8' }))
    const hex = unwrap(
      await computeHmac({
        ...BASE_OPTIONS,
        message: bytesToHex(new TextEncoder().encode(RFC4231_MESSAGE)),
        messageEncoding: 'hex',
      }),
    )
    const base64 = unwrap(
      await computeHmac({
        ...BASE_OPTIONS,
        message: bytesToBase64(utf8ToBytes(RFC4231_MESSAGE)),
        messageEncoding: 'base64',
      }),
    )

    expect(hex).toBe(utf8)
    expect(base64).toBe(utf8)
  })

  it('密钥为空时返回错误且不输出结果', async () => {
    const result = await computeHmac({ ...BASE_OPTIONS, key: '' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('EMPTY_KEY')
      expect(result.error).toContain('密钥')
    }
  })

  it('密钥为非法十六进制时返回错误且不输出结果', async () => {
    const result = await computeHmac({ ...BASE_OPTIONS, key: 'zz' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_KEY')
      expect(result.error).toContain('密钥格式非法')
      expect(result.offset).toBe(0)
    }
  })

  it('非法 hex 的错误偏移指向首个非法字符，而非恒为 0', async () => {
    // 'zz' 的首个非法字符恰在 0 位，那条断言无法区分「真实偏移」与「硬编码 0」，
    // 故这里用非法字符不在起始位的向量。
    const result = await computeHmac({ ...BASE_OPTIONS, key: '0bzz' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_KEY')
      expect(result.offset).toBe(2)
    }
  })

  it('消息为非法十六进制时返回 BAD_MESSAGE 而不是抛错', async () => {
    const result = await computeHmac({ ...BASE_OPTIONS, message: '68zz', messageEncoding: 'hex' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('BAD_MESSAGE')
      expect(result.error).toContain('消息格式非法')
      expect(result.offset).toBe(2)
    }
  })

  it('消息为空是合法输入，仍产出摘要', async () => {
    const result = await computeHmac({ ...BASE_OPTIONS, message: '' })

    expect(unwrap(result)).toHaveLength(64)
  })
})
