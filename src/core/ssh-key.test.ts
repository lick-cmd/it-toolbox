import { describe, expect, it } from 'vitest'
import { base64ToBytes } from './bytes'
import { sshMpint, sshRsaPublicKey, sshString } from './ssh-key'

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 测试内独立解析：按 uint32 长度前缀逐段取出。 */
function readField(blob: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  const length =
    ((blob[offset] ?? 0) << 24) |
    ((blob[offset + 1] ?? 0) << 16) |
    ((blob[offset + 2] ?? 0) << 8) |
    (blob[offset + 3] ?? 0)

  return { value: blob.slice(offset + 4, offset + 4 + length), next: offset + 4 + length }
}

/** 剥掉 mpint 为正数补的 0x00，得到值语义。 */
function unsignedOf(mpint: Uint8Array): Uint8Array {
  let start = 0
  while (start < mpint.length - 1 && mpint[start] === 0x00) start++
  return mpint.slice(start)
}

describe('sshString', () => {
  it('前置 uint32 大端长度', () => {
    expect(toHex(sshString(fromHex('616263')))).toBe('00000003616263')
    expect(toHex(sshString(new Uint8Array(0)))).toBe('00000000')
  })
})

describe('sshMpint', () => {
  it('剥前导 0x00', () => {
    expect(toHex(sshMpint(fromHex('00000102')))).toBe('000000020102')
    expect(toHex(sshMpint(fromHex('0102')))).toBe(toHex(sshMpint(fromHex('00000102'))))
  })

  it('最高位为 1 时补 0x00', () => {
    expect(toHex(sshMpint(fromHex('80')))).toBe('000000020080')
    expect(toHex(sshMpint(fromHex('ff01')))).toBe('0000000300ff01')
  })

  it('零编码为空内容', () => {
    // RFC 4251 §5：零值编码为零长度；且不得含「不必要的前导 0x00」，
    // 故 00 与 0000 也必须落到空内容（此处与 DER INTEGER 的要求相反）。
    expect(toHex(sshMpint(new Uint8Array(0)))).toBe('00000000')
    expect(toHex(sshMpint(fromHex('00')))).toBe('00000000')
    expect(toHex(sshMpint(fromHex('0000')))).toBe('00000000')
  })
})

describe('sshRsaPublicKey', () => {
  const exponent = fromHex('010001')
  const modulus = fromHex('c1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1abc1ab')

  it('是单行 ssh-rsa 文本并以换行结尾', () => {
    const line = sshRsaPublicKey(modulus, exponent)

    expect(line.startsWith('ssh-rsa ')).toBe(true)
    expect(line.endsWith('\n')).toBe(true)
    expect(line.trimEnd().split('\n')).toHaveLength(1)
  })

  it('线下内容可被独立解析还原出算法名与 n / e', () => {
    const line = sshRsaPublicKey(modulus, exponent)
    const blob = base64ToBytes(line.trim().slice('ssh-rsa '.length))
    if (!blob.ok) throw new Error('公钥主体不是合法 Base64')

    const algorithm = readField(blob.value, 0)
    expect(new TextDecoder().decode(algorithm.value)).toBe('ssh-rsa')

    const e = readField(blob.value, algorithm.next)
    expect(toHex(unsignedOf(e.value))).toBe(toHex(exponent))
    // unsignedOf 会把两侧的前导零都剥掉，故它能通过并不代表输出端没有多余的 0x00；
    // 这两条按**原始字节**逐字节钉住字段内容（e 最高位为 0 ⇒ 恰好 3 字节，不补零）。
    expect(toHex(e.value)).toBe('010001')

    const n = readField(blob.value, e.next)
    expect(toHex(unsignedOf(n.value))).toBe(toHex(modulus))
    // 模数首字节 0xc1 最高位为 1 ⇒ 恰好补**一个** 0x00，多补一个都会被这里抓住。
    expect(toHex(n.value.slice(0, 3))).toBe('00c1ab')
    expect(n.value.length).toBe(modulus.length + 1)

    expect(n.next).toBe(blob.value.length)
  })

  it('模数最高位为 1 时，mpint 会多补一个 0x00 且仍能还原', () => {
    const highBitModulus = fromHex('ff' + '11'.repeat(15))
    const line = sshRsaPublicKey(highBitModulus, exponent)
    const blob = base64ToBytes(line.trim().slice('ssh-rsa '.length))
    if (!blob.ok) throw new Error('公钥主体不是合法 Base64')

    const algorithm = readField(blob.value, 0)
    const e = readField(blob.value, algorithm.next)
    const n = readField(blob.value, e.next)

    expect(n.value[0]).toBe(0x00)
    expect(n.value[1]).toBe(0xff)
    expect(n.value.length).toBe(highBitModulus.length + 1)
    expect(toHex(unsignedOf(n.value))).toBe(toHex(highBitModulus))
  })
})
