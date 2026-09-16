import { useState } from 'react'
import type { PrivateKeyFormat, PublicKeyFormat, RsaKeyPair, RsaKeySize } from '@/core/crypto/rsa'
import { generateRsaKeyPair } from '@/core/crypto/rsa'
import type { ErrorInfo } from '@/core/result'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { Button, Select } from '@/framework/ui/Inputs'
import { Spinner } from '@/framework/ui/Spinner'

const INITIAL_STATE = {
  input: '',
  options: {
    keySize: '2048',
    privateKeyFormat: 'pkcs1' as PrivateKeyFormat,
    publicKeyFormat: 'spki' as PublicKeyFormat,
  },
}

const KEY_SIZE_OPTIONS = [
  { value: '1024', label: '1024 位' },
  { value: '2048', label: '2048 位（推荐）' },
  { value: '3072', label: '3072 位' },
  { value: '4096', label: '4096 位（较慢）' },
] as const

const PRIVATE_FORMAT_OPTIONS = [
  { value: 'pkcs1', label: 'PKCS#1（RSA PRIVATE KEY）' },
  { value: 'pkcs8', label: 'PKCS#8（PRIVATE KEY）' },
] as const

const PUBLIC_FORMAT_OPTIONS = [
  { value: 'spki', label: 'SPKI（PUBLIC KEY）' },
  { value: 'pkcs1', label: 'PKCS#1（RSA PUBLIC KEY）' },
  { value: 'openssh', label: 'OpenSSH（ssh-rsa）' },
] as const

/** 生成时用的参数快照：用来判断当前参数是否与结果不一致。 */
interface GenerateSnapshot {
  keySize: RsaKeySize
  privateKeyFormat: PrivateKeyFormat
  publicKeyFormat: PublicKeyFormat
}

function isStale(snapshot: GenerateSnapshot | null, current: GenerateSnapshot): boolean {
  if (snapshot === null) return false
  return (
    snapshot.keySize !== current.keySize ||
    snapshot.privateKeyFormat !== current.privateKeyFormat ||
    snapshot.publicKeyFormat !== current.publicKeyFormat
  )
}

export default function RsaKeyGeneratorTool() {
  const { state, updateOptions } = useToolState('rsa-key-generator', INITIAL_STATE)
  const { keySize, privateKeyFormat, publicKeyFormat } = state.options

  // 密钥材料只存在内存里：不写进 useToolState，避免私钥落进 localStorage
  const [pair, setPair] = useState<RsaKeyPair | null>(null)
  const [snapshot, setSnapshot] = useState<GenerateSnapshot | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<ErrorInfo | null>(null)

  const numericKeySize = Number(keySize) as RsaKeySize
  const stale = isStale(snapshot, {
    keySize: numericKeySize,
    privateKeyFormat,
    publicKeyFormat,
  })

  // 导出文件名必须跟随**已生成结果**的格式：只改公钥格式而不重新生成时，结果区内容仍是旧格式，
  // 文件名若提前跳到 public.pub 就会名实不符（用户拿到的 .pub 里其实是 PEM）。
  // 结果区只在 pair !== null 时渲染，而 pair 与 snapshot 同生同灭，故 ?? 只用于满足类型。
  const generatedPublicFormat = snapshot?.publicKeyFormat ?? publicKeyFormat

  // 刻意不写依赖参数的 useEffect：spec 要求结果保留直至用户重新生成
  const handleGenerate = async () => {
    setIsGenerating(true)
    setError(null)
    try {
      const next = await generateRsaKeyPair({
        keySize: numericKeySize,
        privateKeyFormat,
        publicKeyFormat,
      })
      setPair(next)
      setSnapshot({ keySize: numericKeySize, privateKeyFormat, publicKeyFormat })
    } catch (cause) {
      setPair(null)
      setSnapshot(null)
      setError({
        error: cause instanceof Error ? cause.message : '密钥生成失败',
        code: 'RSA_GENERATE_FAILED',
        suggestion: '换用更小的密钥长度后重试',
      })
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <ToolLayout
      options={
        <>
          <Field label="密钥长度">
            <Select
              label="密钥长度"
              options={KEY_SIZE_OPTIONS}
              value={keySize}
              onChange={(value) => updateOptions({ keySize: value })}
            />
          </Field>
          <Field label="私钥格式">
            <Select
              label="私钥格式"
              options={PRIVATE_FORMAT_OPTIONS}
              value={privateKeyFormat}
              onChange={(value) => updateOptions({ privateKeyFormat: value })}
            />
          </Field>
          <Field label="公钥格式">
            <Select
              label="公钥格式"
              options={PUBLIC_FORMAT_OPTIONS}
              value={publicKeyFormat}
              onChange={(value) => updateOptions({ publicKeyFormat: value })}
            />
          </Field>
          {/* 文案在生成前后保持一致：改文案会让按可访问名定位的查询在生成中失效，
              且按钮已被 Spinner 与禁用态表达清楚 */}
          <Button onClick={() => void handleGenerate()} disabled={isGenerating}>
            生成密钥对
          </Button>
        </>
      }
      note={
        <>
          <p>
            密钥在你自己的设备上用 WebCrypto 生成，全程不发往任何服务器。私钥只保留在当前
            会话的内存中，刷新或重新打开工具后需要重新生成。
          </p>
          <p className="mt-2">
            1024 位已不足以抵抗现代算力，仅用于兼容旧系统；一般用途选 2048 位，长期用途选 3072
            位以上。
          </p>
        </>
      }
      output={
        error !== null ? (
          <ErrorNote info={error} />
        ) : isGenerating ? (
          <div className="flex h-full items-center justify-center">
            <Spinner label="正在生成密钥对…" />
          </div>
        ) : pair === null ? (
          <EmptyState title="尚未生成" hint="选择参数后点击生成" />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <section aria-label="公钥" className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-1.5 py-1">
                <span className="text-[12px] text-muted">公钥</span>
                <span className="inline-flex items-center gap-1">
                  <CopyButton text={pair.publicKey} label="复制公钥" />
                  <DownloadButton
                    filename={generatedPublicFormat === 'openssh' ? 'public.pub' : 'public.pem'}
                    text={pair.publicKey}
                  />
                </span>
              </div>
              <CodeArea value={pair.publicKey} readOnly />
            </section>

            <section aria-label="私钥" className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-1.5 py-1">
                <span className="text-[12px] text-muted">私钥</span>
                <span className="inline-flex items-center gap-1">
                  <CopyButton text={pair.privateKey} label="复制私钥" />
                  <DownloadButton filename="private.pem" text={pair.privateKey} />
                </span>
              </div>
              <CodeArea value={pair.privateKey} readOnly />
            </section>
          </div>
        )
      }
      status={
        error !== null ? (
          <span className="text-danger">{error.error}</span>
        ) : isGenerating ? (
          <span>正在生成…</span>
        ) : stale ? (
          <span className="text-danger">参数已变更，点击生成以应用</span>
        ) : pair === null ? (
          <span>尚未生成</span>
        ) : (
          <span>
            已生成 {pair.keySize} 位密钥对 · 私钥 {privateKeyFormat} · 公钥 {publicKeyFormat}
          </span>
        )
      }
    />
  )
}
