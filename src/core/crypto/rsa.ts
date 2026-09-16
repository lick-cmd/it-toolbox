import { base64ToBytes } from '../bytes'
import { bytesToPem, derInteger, derSequence } from '../der'
import { sshRsaPublicKey } from '../ssh-key'

export type RsaKeySize = 1024 | 2048 | 3072 | 4096
export type PrivateKeyFormat = 'pkcs1' | 'pkcs8'
export type PublicKeyFormat = 'spki' | 'pkcs1' | 'openssh'

export interface RsaKeyPair {
  publicKey: string
  privateKey: string
  algorithm: 'RSASSA-PKCS1-v1_5'
  keySize: RsaKeySize
  generatedAt: number
}

export interface RsaOptions {
  keySize: RsaKeySize
  privateKeyFormat: PrivateKeyFormat
  publicKeyFormat: PublicKeyFormat
}

interface RsaJwkParts {
  n: Uint8Array
  e: Uint8Array
  d: Uint8Array
  p: Uint8Array
  q: Uint8Array
  dp: Uint8Array
  dq: Uint8Array
  qi: Uint8Array
}

const KEY_SIZES: readonly RsaKeySize[] = [1024, 2048, 3072, 4096]

/** JWK 字段是 base64url（无填充）；base64ToBytes 同时接受标准与 url-safe 字母表。 */
function jwkField(jwk: JsonWebKey, name: keyof JsonWebKey): Uint8Array {
  const value = jwk[name]
  if (typeof value !== 'string') {
    throw new RangeError(`JWK 缺少字段 ${String(name)}`)
  }
  const decoded = base64ToBytes(value)
  if (!decoded.ok) {
    throw new RangeError(`JWK 字段 ${String(name)} 不是合法 base64url`)
  }
  return decoded.value
}

function readJwkParts(jwk: JsonWebKey): RsaJwkParts {
  return {
    n: jwkField(jwk, 'n'),
    e: jwkField(jwk, 'e'),
    d: jwkField(jwk, 'd'),
    p: jwkField(jwk, 'p'),
    q: jwkField(jwk, 'q'),
    dp: jwkField(jwk, 'dp'),
    dq: jwkField(jwk, 'dq'),
    qi: jwkField(jwk, 'qi'),
  }
}

/** RSAPrivateKey ::= SEQUENCE { version, n, e, d, p, q, dp, dq, qi }（RFC 8017 A.1.2）。 */
function toPkcs1PrivateKey(parts: RsaJwkParts): Uint8Array {
  return derSequence([
    derInteger(new Uint8Array([0x00])),
    derInteger(parts.n),
    derInteger(parts.e),
    derInteger(parts.d),
    derInteger(parts.p),
    derInteger(parts.q),
    derInteger(parts.dp),
    derInteger(parts.dq),
    derInteger(parts.qi),
  ])
}

/** RSAPublicKey ::= SEQUENCE { n, e }（RFC 8017 A.1.1）。 */
function toPkcs1PublicKey(parts: RsaJwkParts): Uint8Array {
  return derSequence([derInteger(parts.n), derInteger(parts.e)])
}

async function exportPemKey(
  key: CryptoKey,
  format: 'spki' | 'pkcs8',
  label: string,
): Promise<string> {
  const exported = await globalThis.crypto.subtle.exportKey(format, key)
  return bytesToPem(new Uint8Array(exported), label)
}

export async function generateRsaKeyPair(options: RsaOptions): Promise<RsaKeyPair> {
  const { keySize, privateKeyFormat, publicKeyFormat } = options

  if (!KEY_SIZES.includes(keySize)) {
    throw new RangeError(`密钥长度仅支持 ${KEY_SIZES.join(' / ')}`)
  }

  const keyPair = await globalThis.crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: keySize,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    // extractable 必须为 true：否则 exportKey 抛 InvalidAccessError，
    // 而那时密钥已经生成完毕，报错位置离原因很远
    true,
    ['sign', 'verify'],
  )

  const parts = readJwkParts(await globalThis.crypto.subtle.exportKey('jwk', keyPair.privateKey))

  const privateKey =
    privateKeyFormat === 'pkcs8'
      ? await exportPemKey(keyPair.privateKey, 'pkcs8', 'PRIVATE KEY')
      : bytesToPem(toPkcs1PrivateKey(parts), 'RSA PRIVATE KEY')

  const publicKey =
    publicKeyFormat === 'spki'
      ? await exportPemKey(keyPair.publicKey, 'spki', 'PUBLIC KEY')
      : publicKeyFormat === 'pkcs1'
        ? bytesToPem(toPkcs1PublicKey(parts), 'RSA PUBLIC KEY')
        : sshRsaPublicKey(parts.n, parts.e)

  return {
    publicKey,
    privateKey,
    algorithm: 'RSASSA-PKCS1-v1_5',
    keySize,
    generatedAt: Date.now(),
  }
}
