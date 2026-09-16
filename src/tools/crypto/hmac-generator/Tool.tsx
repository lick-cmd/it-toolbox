import { useEffect, useState } from 'react'
import type { HmacAlgorithm, InputEncoding, OutputEncoding } from '@/core/crypto/hmac'
import { computeHmac } from '@/core/crypto/hmac'
import type { ErrorInfo } from '@/core/result'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { Select, TextInput } from '@/framework/ui/Inputs'

const INITIAL_STATE = {
  input: '',
  options: {
    key: '',
    algorithm: 'SHA-256' as HmacAlgorithm,
    messageEncoding: 'utf8' as InputEncoding,
    keyEncoding: 'utf8' as InputEncoding,
    outputEncoding: 'hex' as OutputEncoding,
  },
}

const ALGORITHM_OPTIONS = [
  { value: 'SHA-1', label: 'SHA-1' },
  { value: 'SHA-256', label: 'SHA-256' },
  { value: 'SHA-384', label: 'SHA-384' },
  { value: 'SHA-512', label: 'SHA-512' },
] as const

const INPUT_ENCODING_OPTIONS = [
  { value: 'utf8', label: 'UTF-8 文本' },
  { value: 'hex', label: '十六进制' },
  { value: 'base64', label: 'Base64' },
] as const

const OUTPUT_ENCODING_OPTIONS = [
  { value: 'hex', label: '十六进制' },
  { value: 'base64', label: 'Base64' },
  { value: 'base64url', label: 'Base64URL' },
] as const

const DIGEST_BITS: Record<HmacAlgorithm, number> = {
  'SHA-1': 160,
  'SHA-256': 256,
  'SHA-384': 384,
  'SHA-512': 512,
}

export default function HmacGeneratorTool() {
  const { state, update, updateOptions } = useToolState('hmac-generator', INITIAL_STATE)
  const { key, algorithm, messageEncoding, keyEncoding, outputEncoding } = state.options
  const message = state.input

  const [digest, setDigest] = useState<string | null>(null)
  const [error, setError] = useState<ErrorInfo | null>(null)

  useEffect(() => {
    // 过期结果守卫：快速连改参数时，先发出的计算可能后返回
    let cancelled = false

    void (async () => {
      try {
        const result = await computeHmac({
          message,
          key,
          algorithm,
          messageEncoding,
          keyEncoding,
          outputEncoding,
        })
        if (cancelled) return

        if (result.ok) {
          setDigest(result.value)
          setError(null)
        } else {
          setDigest(null)
          setError({
            error: result.error,
            code: result.code,
            detail: result.detail,
            offset: result.offset,
            suggestion: result.suggestion,
          })
        }
      } catch (thrown) {
        // computeHmac 的失败路径走 Result 而不抛错；真抛了（例如运行环境缺 subtle）也必须
        // 露出原因，否则输出区会永远停在空态 —— 与 Token / ULID 工具同一策略
        if (cancelled) return
        setDigest(null)
        setError({ error: thrown instanceof Error ? thrown.message : '计算失败' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [message, key, algorithm, messageEncoding, keyEncoding, outputEncoding])

  return (
    <ToolLayout
      options={
        <>
          <Field label="算法">
            <Select
              label="算法"
              options={ALGORITHM_OPTIONS}
              value={algorithm}
              onChange={(value) => updateOptions({ algorithm: value })}
            />
          </Field>

          <Field label="密钥">
            <TextInput
              label="密钥"
              value={key}
              placeholder="填入密钥"
              onChange={(value) => updateOptions({ key: value })}
            />
          </Field>

          <Field label="密钥编码">
            <Select
              label="密钥编码"
              options={INPUT_ENCODING_OPTIONS}
              value={keyEncoding}
              onChange={(value) => updateOptions({ keyEncoding: value })}
            />
          </Field>

          <Field label="消息编码">
            <Select
              label="消息编码"
              options={INPUT_ENCODING_OPTIONS}
              value={messageEncoding}
              onChange={(value) => updateOptions({ messageEncoding: value })}
            />
          </Field>

          <Field label="输出编码">
            <Select
              label="输出编码"
              options={OUTPUT_ENCODING_OPTIONS}
              value={outputEncoding}
              onChange={(value) => updateOptions({ outputEncoding: value })}
            />
          </Field>
        </>
      }
      input={
        <CodeArea
          label="消息"
          placeholder="填入要计算摘要的消息"
          value={message}
          onChange={(value) => update({ input: value })}
        />
      }
      output={
        error !== null ? (
          <ErrorNote info={error} />
        ) : digest === null ? (
          <EmptyState title="尚无摘要" hint="填入密钥后即自动计算" />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={digest} label="复制摘要" />
            </div>
            <CodeArea value={digest} readOnly label="摘要" />
          </>
        )
      }
      status={
        error !== null ? (
          <span className="text-danger">{error.error}</span>
        ) : (
          <span>
            {algorithm} · 摘要 {DIGEST_BITS[algorithm]} 位 · {outputEncoding}
          </span>
        )
      }
    />
  )
}
