import { describe, expect, it } from 'vitest'
import { bytesToBase64 } from './bytes'
import {
  bytesToPem,
  derBitString,
  derInteger,
  derLength,
  derNull,
  derSequence,
} from './der'

/**
 * 测试内**独立重写**的 DER 读取器。
 *
 * 与写入器互校才有意义：用写入器自己验证自己只能证明「两次都错成一样」。
 * 这里的实现刻意不复用 der.ts 的任何函数。
 */
interface Tlv {
  tag: number
  value: Uint8Array
  next: number
}

function readTlv(bytes: Uint8Array, offset = 0): Tlv {
  const tag = bytes[offset] ?? 0
  const first = bytes[offset + 1] ?? 0

  let length: number
  let cursor: number
  if (first < 0x80) {
    length = first
    cursor = offset + 2
  } else {
    const count = first & 0x7f
    length = 0
    for (let i = 0; i < count; i++) length = length * 256 + (bytes[offset + 2 + i] ?? 0)
    cursor = offset + 2 + count
  }

  return { tag, value: bytes.slice(cursor, cursor + length), next: cursor + length }
}

/** 读 INTEGER 的值语义：剥掉正数补的 0x00。 */
function readIntegerValue(bytes: Uint8Array, offset = 0): Uint8Array {
  const { value } = readTlv(bytes, offset)
  let start = 0
  while (start < value.length - 1 && value[start] === 0x00) start++
  return value.slice(start)
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

describe('derLength', () => {
  it('小于 0x80 用短形式', () => {
    expect(toHex(derLength(0))).toBe('00')
    expect(toHex(derLength(1))).toBe('01')
    expect(toHex(derLength(0x7f))).toBe('7f')
  })

  it('0x80 与 0xff 用两字节长形式（不得退化为单字节）', () => {
    expect(toHex(derLength(0x80))).toBe('8180')
    expect(toHex(derLength(0xff))).toBe('81ff')
  })

  it('多位长度用大端', () => {
    expect(toHex(derLength(0x100))).toBe('820100')
    expect(toHex(derLength(70_000))).toBe('83011170')
    expect(toHex(derLength(0x10000))).toBe('83010000')
  })

  it('非整数或负数抛 RangeError', () => {
    expect(() => derLength(-1)).toThrow(RangeError)
    expect(() => derLength(1.5)).toThrow(RangeError)
  })
})

describe('derInteger', () => {
  it('最高位为 0 时不补零', () => {
    expect(toHex(derInteger(fromHex('7f')))).toBe('02017f')
  })

  it('最高位为 1 时补一个 0x00（正数语义）', () => {
    expect(toHex(derInteger(fromHex('80')))).toBe('02020080')
    expect(toHex(derInteger(fromHex('ff00')))).toBe('020300ff00')
  })

  it('剥离 JWK 字节的前导 0x00', () => {
    expect(toHex(derInteger(fromHex('0080')))).toBe(toHex(derInteger(fromHex('80'))))
    // 值 258 的规范 DER 是 02 02 01 02：全部前导零都要剥掉。
    // 反例 02 03 00 01 02 会被 openssl 判为 `BAD INTEGER:[000102]`（非规范编码）。
    expect(toHex(derInteger(fromHex('00000102')))).toBe('02020102')
  })

  it('零编码为 02 01 00', () => {
    expect(toHex(derInteger(fromHex('00')))).toBe('020100')
    expect(toHex(derInteger(new Uint8Array(0)))).toBe('020100')
  })
})

describe('derBitString', () => {
  it('首字节为未使用位数 0', () => {
    expect(toHex(derBitString(fromHex('0102')))).toBe('0303000102')
    expect(toHex(derBitString(new Uint8Array(0)))).toBe('030100')
  })
})

describe('derNull', () => {
  it('恒为 05 00', () => {
    expect(toHex(derNull())).toBe('0500')
  })
})

describe('derSequence', () => {
  it('按序拼接子元素并加 0x30 头', () => {
    const sequence = derSequence([derInteger(fromHex('01')), derNull()])

    expect(toHex(sequence)).toBe('30050201010500')
  })

  it('空序列为 30 00', () => {
    expect(toHex(derSequence([]))).toBe('3000')
  })

  it('长内容的长度字段用长形式', () => {
    const payload = new Uint8Array(200).fill(0x41)
    const sequence = derSequence([derInteger(payload)])

    // 200 字节负载 0x41 的最高位为 0，故不补零：INTEGER 内容 = 200 = 0xc8，
    // 头部占用 3 字节，SEQUENCE 内容 = 203 = 0xcb
    expect(toHex(sequence.slice(0, 5))).toBe('3081cb0281')
  })
})

describe('独立读取器互校', () => {
  it('嵌套结构可被独立读取器还原', () => {
    // 模拟 RSAPublicKey ::= SEQUENCE { INTEGER n, INTEGER e }
    const n = fromHex('00c1ab')
    const e = fromHex('010001')
    const der = derSequence([derInteger(n), derInteger(e)])

    const outer = readTlv(der)
    expect(outer.tag).toBe(0x30)

    const first = readTlv(outer.value, 0)
    expect(first.tag).toBe(0x02)
    expect(toHex(readIntegerValue(outer.value, 0))).toBe('c1ab')

    const second = readTlv(outer.value, first.next)
    expect(second.tag).toBe(0x02)
    expect(toHex(readIntegerValue(outer.value, first.next))).toBe('010001')
  })
})

describe('bytesToPem', () => {
  it('头尾行与标签正确，末尾保留换行', () => {
    const pem = bytesToPem(fromHex('0102'), 'PUBLIC KEY')

    expect(pem.startsWith('-----BEGIN PUBLIC KEY-----\n')).toBe(true)
    expect(pem.endsWith('-----END PUBLIC KEY-----\n')).toBe(true)
    expect(pem).toContain(bytesToBase64(fromHex('0102')))
  })

  it('每行不超过 64 个 Base64 字符', () => {
    const pem = bytesToPem(new Uint8Array(100).fill(0x41), 'RSA PUBLIC KEY')
    const body = pem.split('\n').slice(1, -2)

    expect(body.length).toBeGreaterThan(1)
    for (const line of body) expect(line.length).toBeLessThanOrEqual(64)
    expect(body.every((line) => /^[A-Za-z0-9+/=]+$/.test(line))).toBe(true)
  })
})
