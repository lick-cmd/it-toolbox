import { useEffect, useMemo, useState } from 'react'
import { MAX_COUNT, decodeUlidTimestamp, generateUlids } from '@/core/crypto/ulid'
import type { ErrorInfo } from '@/core/result'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { Checkbox, NumberInput } from '@/framework/ui/Inputs'

const INITIAL_STATE = {
  input: '',
  options: {
    count: 10,
    uppercase: true,
  },
}

/** 本地时间的 `YYYY-MM-DD HH:mm:ss.SSS`；不用 toLocaleString，避免跨环境格式差异。 */
function formatTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
  ].join(' ')
}

function validate(count: number): ErrorInfo | null {
  if (!Number.isInteger(count) || count < 0 || count > MAX_COUNT) {
    return { error: `数量必须为 0 到 ${MAX_COUNT} 之间的整数`, code: 'BAD_COUNT' }
  }
  return null
}

export default function UlidGeneratorTool() {
  const { state, updateOptions } = useToolState('ulid-generator', INITIAL_STATE)
  const { count, uppercase } = state.options

  const paramError = validate(count)
  const paramIsValid = paramError === null

  // 规范形式：恒为大写，随机段与时间戳都由 core 决定
  const [canonical, setCanonical] = useState<string[]>([])
  const [generateError, setGenerateError] = useState<ErrorInfo | null>(null)

  useEffect(() => {
    if (!paramIsValid) {
      setCanonical((prev) => (prev.length === 0 ? prev : []))
      setGenerateError(null)
      return
    }
    try {
      setCanonical(generateUlids({ count }))
      setGenerateError(null)
    } catch (error) {
      // 与 Token 生成器同款策略：兜底不静默，把 core 的原因显示出来
      setCanonical((prev) => (prev.length === 0 ? prev : []))
      setGenerateError({ error: error instanceof Error ? error.message : '生成失败' })
    }
  }, [count, paramIsValid])

  // 大小写只影响渲染：切换它不会让已生成的一批 ULID 变成另一批
  const rendered = useMemo(
    () => (uppercase ? canonical : canonical.map((item) => item.toLowerCase())),
    [canonical, uppercase],
  )

  const blockingError = paramError ?? generateError
  const joined = rendered.join('\n')
  const firstTimestamp = canonical.length > 0 ? decodeUlidTimestamp(canonical[0]!) : null
  const lastTimestamp =
    canonical.length > 1 ? decodeUlidTimestamp(canonical[canonical.length - 1]!) : null

  return (
    <ToolLayout
      options={
        <>
          <Field label="数量">
            <NumberInput
              label="数量"
              value={count}
              min={1}
              max={MAX_COUNT}
              onChange={(value) => updateOptions({ count: value })}
            />
          </Field>
          <Checkbox
            label="大写"
            checked={uppercase}
            onChange={(checked) => updateOptions({ uppercase: checked })}
          />
        </>
      }
      note={
        <p>
          ULID 的前 10 个字符是 48 位毫秒时间戳，因此按字典序排列即为时间顺序。同一毫秒内
          连续生成时递增随机段，溢出则推进到下一毫秒，保证严格单调。
        </p>
      }
      output={
        blockingError ? (
          <ErrorNote info={blockingError} />
        ) : rendered.length === 0 ? (
          <EmptyState title="尚未生成" hint="调整上方参数即可生成" />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={joined} label="复制全部" />
              <DownloadButton filename="ulids.txt" text={joined} />
            </div>
            <CodeArea value={joined} readOnly label="生成的 ULID" />
          </>
        )
      }
      status={
        blockingError ? (
          <span className="text-danger">{blockingError.error}</span>
        ) : firstTimestamp === null ? (
          // 解码失败（理论上不该发生）时不能说「共 0 条」：列表可能仍在渲染，那样会自相矛盾
          <span>共 {rendered.length} 条</span>
        ) : lastTimestamp === null ? (
          <span>时间戳 {formatTimestamp(firstTimestamp)}</span>
        ) : (
          <span>
            共 {rendered.length} 条 · 时间戳 {formatTimestamp(firstTimestamp)} ~{' '}
            {formatTimestamp(lastTimestamp)}
          </span>
        )
      }
    />
  )
}
