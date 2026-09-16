import { useEffect, useState } from 'react'
import type { CharsetId } from '@/core/crypto/token'
import {
  MAX_COUNT,
  MAX_LENGTH,
  MAX_TOTAL_LENGTH,
  generateTokens,
  resolveCharset,
} from '@/core/crypto/token'
import type { ErrorInfo } from '@/core/result'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { NumberInput, Select, TextInput } from '@/framework/ui/Inputs'

/** 必须定义在组件外部：useToolState 的 reset 依赖它，每次渲染新建字面量会让依赖持续变化。 */
const INITIAL_STATE = {
  input: '',
  options: {
    length: 32,
    count: 1,
    charset: 'alphanumeric' as CharsetId,
    custom: '',
    prefix: '',
  },
}

const CHARSET_OPTIONS = [
  { value: 'alphanumeric', label: '字母数字' },
  { value: 'hex', label: '十六进制' },
  { value: 'base64', label: 'Base64' },
  { value: 'base64url', label: 'Base64URL' },
  { value: 'custom', label: '自定义' },
] as const

/**
 * 参数校验。
 *
 * 把 core 的守卫在界面上重述一遍，是为了给出**具体原因**：core 抛出的 RangeError
 * 只有消息没有定位，而这里要区分「长度超限」「数量超限」「总数超限」「字符集为空」。
 * 校验通过后 core 仍可能抛错，故生成时另有一层 try/catch 兜底（且该兜底会显示原因）。
 *
 * 总数上限必须与 core 同口径：`generateTokens` 用的是 `(length + prefix.length) * count`，
 * 这里若漏掉 prefix，就会出现「界面校验通过 → core 抛错 → 输出区静默空态」。
 */
function validate(
  length: number,
  count: number,
  charset: CharsetId,
  custom: string,
  prefix: string,
): ErrorInfo | null {
  if (!Number.isInteger(length) || length < 1 || length > MAX_LENGTH) {
    return { error: `长度必须为 1 到 ${MAX_LENGTH} 之间的整数`, code: 'BAD_LENGTH' }
  }
  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
    return { error: `数量必须为 0 到 ${MAX_COUNT} 之间的整数`, code: 'BAD_COUNT' }
  }
  if (charset === 'custom') {
    try {
      resolveCharset(charset, custom)
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : '自定义字符集非法',
        code: 'BAD_CHARSET',
      }
    }
  }
  if ((length + prefix.length) * count > MAX_TOTAL_LENGTH) {
    return { error: `单次生成的字符总数不得超过 ${MAX_TOTAL_LENGTH}`, code: 'TOO_MANY_CHARS' }
  }
  return null
}

export default function TokenGeneratorTool() {
  const { state, updateOptions } = useToolState('token-generator', INITIAL_STATE)
  const { length, count, charset, custom, prefix } = state.options

  const paramError = validate(length, count, charset, custom, prefix)
  // 依赖必须是原始值：paramError 每次渲染都是新对象，直接进 deps 会造成无限渲染循环
  const paramIsValid = paramError === null

  const [tokens, setTokens] = useState<string[]>([])
  const [generateError, setGenerateError] = useState<ErrorInfo | null>(null)

  useEffect(() => {
    if (!paramIsValid) {
      setTokens((prev) => (prev.length === 0 ? prev : []))
      setGenerateError(null)
      return
    }
    try {
      setTokens(generateTokens({ length, count, charset, custom, prefix }))
      setGenerateError(null)
    } catch (error) {
      // 界面校验与 core 守卫是两处独立实现，可能不一致（TOO_MANY_CHARS 就曾漏算前缀）。
      // 兜底不能静默：把 core 的原因原样显示，避免「参数看着合法却什么都不输出」。
      setTokens((prev) => (prev.length === 0 ? prev : []))
      setGenerateError({ error: error instanceof Error ? error.message : '生成失败' })
    }
  }, [length, count, charset, custom, prefix, paramIsValid])

  const blockingError = paramError ?? generateError
  const joined = tokens.join('\n')

  return (
    <ToolLayout
      options={
        <>
          <Field label="字符集">
            <Select
              label="字符集"
              options={CHARSET_OPTIONS}
              value={charset}
              onChange={(value) => updateOptions({ charset: value })}
            />
          </Field>

          {charset === 'custom' && (
            <Field label="自定义字符集">
              <TextInput
                label="自定义字符集"
                value={custom}
                placeholder="例如 abcdef0123456789"
                onChange={(value) => updateOptions({ custom: value })}
              />
            </Field>
          )}

          <Field label="长度">
            <NumberInput
              label="长度"
              value={length}
              min={1}
              max={MAX_LENGTH}
              onChange={(value) => updateOptions({ length: value })}
            />
          </Field>

          <Field label="数量">
            <NumberInput
              label="数量"
              value={count}
              min={1}
              max={MAX_COUNT}
              onChange={(value) => updateOptions({ count: value })}
            />
          </Field>

          <Field label="前缀">
            <TextInput
              label="前缀"
              value={prefix}
              placeholder="例如 sk_"
              onChange={(value) => updateOptions({ prefix: value })}
            />
          </Field>
        </>
      }
      input={
        <div className="p-2.5 text-[12px] text-muted">
          <p>
            随机值取自 <span className="code-text text-fg">crypto.getRandomValues</span>
            ，逐字符等概率选取，不引入取模偏差；自定义字符集会先去重，避免个别字符被重复计权。
          </p>
        </div>
      }
      output={
        blockingError ? (
          <ErrorNote info={blockingError} />
        ) : tokens.length === 0 ? (
          <EmptyState title="尚未生成" hint="调整上方参数即可生成" />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={joined} label="复制全部" />
              <DownloadButton filename="tokens.txt" text={joined} />
            </div>
            <CodeArea value={joined} readOnly label="生成的 Token" />
          </>
        )
      }
      status={
        blockingError ? (
          <span className="text-danger">{blockingError.error}</span>
        ) : (
          <span>共 {tokens.length} 条</span>
        )
      }
    />
  )
}
