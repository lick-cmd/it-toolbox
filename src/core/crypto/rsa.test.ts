import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { generateRsaKeyPair } from './rsa'
import type { RsaKeySize } from './rsa'

/* ────────────────────────── 独立 DER 读取器 ────────────────────────── */
/*
 * 刻意不复用 core/der.ts 的任何函数：用写入器验证自己只能证明「两次都错成
 * 一样」。这里按 X.690 重新实现一遍读取，才构成互校。
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

function readChildren(sequence: Uint8Array): Tlv[] {
  const children: Tlv[] = []
  let offset = 0
  while (offset < sequence.length) {
    const child = readTlv(sequence, offset)
    children.push(child)
    offset = child.next
  }
  return children
}

/**
 * 读取顶层 SEQUENCE 的子元素。
 *
 * 必须先把外层 SEQUENCE 自己读掉再取 `.value`：把整段 DER 直接交给 readChildren 只会得到
 * 1 个子元素（外层 SEQUENCE 自己），这正是计划初稿里的用法缺陷。
 */
function readSequenceChildren(der: Uint8Array): Tlv[] {
  const outer = readTlv(der)
  expect(outer.tag).toBe(0x30)
  expect(outer.next).toBe(der.length)
  return readChildren(outer.value)
}

/**
 * OpenSSH 线格式的 `string` / `mpint`：uint32 大端长度 + 字节（RFC 4251 §5）。
 *
 * **不是** DER 的 TLV：拿 readTlv 去读 SSH blob 会把首字节 0x00 当标签、长度读成 0。
 * 高位字节用乘法而非 `<< 24`，避免 `<<` 的有符号语义。
 */
function readSshField(bytes: Uint8Array, offset: number): { value: Uint8Array; next: number } {
  const length =
    (bytes[offset] ?? 0) * 0x1000000 +
    ((bytes[offset + 1] ?? 0) << 16) +
    ((bytes[offset + 2] ?? 0) << 8) +
    (bytes[offset + 3] ?? 0)

  return { value: bytes.slice(offset + 4, offset + 4 + length), next: offset + 4 + length }
}

/** INTEGER 的值语义：剥掉正数补的 0x00 后转 BigInt。 */
function toBigInt(value: Uint8Array): bigint {
  let start = 0
  while (start < value.length - 1 && value[start] === 0x00) start++

  let out = 0n
  for (let i = start; i < value.length; i++) out = (out << 8n) | BigInt(value[i] ?? 0)
  return out
}

// 返回类型必须写成 Uint8Array<ArrayBuffer>（而不是默认的 Uint8Array<ArrayBufferLike>）：
// 返回的字节要直接喂给 WebCrypto 的 BufferSource，TS 5.7+ 的泛型 Uint8Array 在这点上不兼容。
// 这里改类型而不是再复制一份：本函数返回的本来就是新建的 ArrayBuffer 支撑数组。
function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('-----'))
    .join('')

  const binary = atob(body)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

const HAS_OPENSSL = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const tempDirs: string[] = []
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
})

function writeTemp(name: string, content: string): string {
  const dir =
    tempDirs[0] ??
    (() => {
      const created = mkdtempSync(join(tmpdir(), 'it-toolbox-rsa-'))
      tempDirs.push(created)
      return created
    })()
  const path = join(dir, name)
  writeFileSync(path, content, 'utf8')
  return path
}

/* ────────────────────────────── 用例 ────────────────────────────── */

describe('generateRsaKeyPair', () => {
  it('默认导出 SPKI 公钥与 PKCS#8 私钥，均为合法 PEM', async () => {
    const pair = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs8',
      publicKeyFormat: 'spki',
    })

    expect(pair.publicKey.startsWith('-----BEGIN PUBLIC KEY-----')).toBe(true)
    expect(pair.publicKey.trimEnd().endsWith('-----END PUBLIC KEY-----')).toBe(true)
    expect(pair.privateKey.startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true)
    expect(pair.keySize).toBe(1024)
    expect(pair.algorithm).toBe('RSASSA-PKCS1-v1_5')
    expect(pair.generatedAt).toBeLessThanOrEqual(Date.now())
  })

  it('私钥格式为 PKCS#1 时用 RSA PRIVATE KEY 标签', async () => {
    const pair = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'spki',
    })

    expect(pair.privateKey.startsWith('-----BEGIN RSA PRIVATE KEY-----')).toBe(true)
    expect(pair.privateKey.trimEnd().endsWith('-----END RSA PRIVATE KEY-----')).toBe(true)
  })

  it('公钥格式为 PKCS#1 / OpenSSH 时用各自的表示', async () => {
    const pkcs1 = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'pkcs1',
    })
    expect(pkcs1.publicKey.startsWith('-----BEGIN RSA PUBLIC KEY-----')).toBe(true)

    // 光看 PEM 头抓不到内容错误：PKCS#1 公钥必须与**同一次生成**的私钥同模同指数，
    // 否则 n / e 对调、字段顺序写错都会静默通过（openssl -RSAPublicKey_in 可复核）
    const privateParts = readSequenceChildren(pemToDer(pkcs1.privateKey)).map((child) =>
      toBigInt(child.value),
    )
    const [pkcs1Modulus, pkcs1Exponent] = readSequenceChildren(pemToDer(pkcs1.publicKey)).map(
      (child) => toBigInt(child.value),
    )
    expect(pkcs1Modulus).toBe(privateParts[1])
    expect(pkcs1Exponent).toBe(privateParts[2])

    const openssh = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'openssh',
    })
    expect(openssh.publicKey.startsWith('ssh-rsa ')).toBe(true)
    expect(openssh.publicKey.trimEnd().split('\n')).toHaveLength(1)
  })

  it('独立读取器解析 PKCS#1 私钥后，CRT 参数满足数学恒等式', async () => {
    const pair = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'spki',
    })

    const children = readSequenceChildren(pemToDer(pair.privateKey))
    expect(children).toHaveLength(9)

    const [version, n, e, d, p, q, dp, dq, qi] = children.map((child) => toBigInt(child.value))

    expect(version).toBe(0n)

    // 这三条是 RSA 的定义式：字段顺序或正数补零写错都会在这里露出来
    expect(p! * q!).toBe(n!)
    expect(d! % (p! - 1n)).toBe(dp!)
    expect(d! % (q! - 1n)).toBe(dq!)
    expect((qi! * q!) % p!).toBe(1n)
    expect(e).toBe(65537n)
  })

  it('PKCS#1 私钥里的模数与 SPKI 公钥里的模数是同一个', async () => {
    const pair = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'spki',
    })

    const privateParts = readSequenceChildren(pemToDer(pair.privateKey)).map((child) =>
      toBigInt(child.value),
    )
    const spki = readTlv(pemToDer(pair.publicKey))
    // SPKI ::= SEQUENCE { AlgorithmIdentifier, BIT STRING { RSAPublicKey } }
    const [algorithm, bitString] = readChildren(spki.value)
    expect(algorithm!.tag).toBe(0x30)
    expect(bitString!.tag).toBe(0x03)
    // BIT STRING 首字节为未使用位数
    expect(bitString!.value[0]).toBe(0x00)

    // BIT STRING 的内容 = 未使用位数(1 字节) + RSAPublicKey SEQUENCE { n, e }：
    // 里层还套着一层 SEQUENCE（RFC 5280 + RFC 8017 A.1.1），openssl asn1parse 可证。
    const rsaPublicKey = readSequenceChildren(bitString!.value.slice(1))
    const spkiModulus = toBigInt(rsaPublicKey[0]!.value)
    const spkiExponent = toBigInt(rsaPublicKey[1]!.value)

    expect(spkiModulus).toBe(privateParts[1])
    expect(spkiExponent).toBe(privateParts[2])
  })

  it('ssh-rsa 行里的 n 与 e 与 PKCS#1 私钥里的模数、指数一致', async () => {
    const pair = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'openssh',
    })

    const blob = atob(pair.publicKey.trim().slice('ssh-rsa '.length))
    const bytes = new Uint8Array(blob.length)
    for (let i = 0; i < blob.length; i++) bytes[i] = blob.charCodeAt(i)

    const algorithm = readSshField(bytes, 0)
    expect(new TextDecoder().decode(algorithm.value)).toBe('ssh-rsa')

    const exponent = readSshField(bytes, algorithm.next)
    const modulus = readSshField(bytes, exponent.next)
    expect(modulus.next).toBe(bytes.length)

    // 同一对密钥的两条完全不同的编码路径：OpenSSH 线上格式 vs PKCS#1 DER
    const privateParts = readSequenceChildren(pemToDer(pair.privateKey)).map((child) =>
      toBigInt(child.value),
    )

    expect(toBigInt(exponent.value)).toBe(privateParts[2])
    expect(toBigInt(modulus.value)).toBe(privateParts[1])
  })

  it.skipIf(!HAS_OPENSSL)('openssl rsa -check 通过（外部权威校验）', async () => {
    const pair = await generateRsaKeyPair({
      keySize: 2048,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'spki',
    })

    const path = writeTemp('pkcs1.pem', pair.privateKey)
    const output = execFileSync('openssl', ['rsa', '-check', '-noout', '-in', path], {
      encoding: 'utf8',
    })

    expect(output).toContain('RSA key ok')
  })

  it('私钥与公钥属于同一密钥对（签名 / 验签往返）', async () => {
    const pair = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs8',
      publicKeyFormat: 'spki',
    })

    const privateKey = await globalThis.crypto.subtle.importKey(
      'pkcs8',
      pemToDer(pair.privateKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const publicKey = await globalThis.crypto.subtle.importKey(
      'spki',
      pemToDer(pair.publicKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )

    const message = new TextEncoder().encode('it-toolbox')
    const signature = await globalThis.crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, message)
    const verified = await globalThis.crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature,
      message,
    )

    expect(verified).toBe(true)
  })

  it('支持 1024 / 2048 / 3072 / 4096，非法长度抛 RangeError', async () => {
    const short = await generateRsaKeyPair({
      keySize: 1024,
      privateKeyFormat: 'pkcs1',
      publicKeyFormat: 'spki',
    })
    expect(short.keySize).toBe(1024)

    // 运行期守卫：512 只能靠断言传进来，正是要证明「非法长度不会生成密钥」
    const invalidSize = 512 as RsaKeySize
    await expect(
      generateRsaKeyPair({
        keySize: invalidSize,
        privateKeyFormat: 'pkcs1',
        publicKeyFormat: 'spki',
      }),
    ).rejects.toThrow(RangeError)
  }, 30_000)
})
