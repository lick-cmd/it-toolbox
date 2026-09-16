import { useMemo } from 'react'
import {
  parseDateInput,
  TIMESTAMP_UNITS,
  toDateFields,
  type TimestampUnit,
} from '@/core/converter/date'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { Select } from '@/framework/ui/Inputs'

/** 必须定义在组件外部：初始值参与 useToolState 的惰性初始化，每次渲染新建会让依赖持续失效 */
const INITIAL_STATE = {
  input: '',
  options: { unit: 'auto' as TimestampUnit },
}

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

export default function DateConverterTool() {
  const { state, update, updateOptions } = useToolState('date-converter', INITIAL_STATE)
  const { input } = state
  const { unit } = state.options

  // 依赖全部是原始值（计划① R16：对象依赖会造成无限渲染循环）
  const parsed = useMemo(
    () => (input.trim().length === 0 ? null : parseDateInput(input, unit)),
    [input, unit],
  )

  const fields = useMemo(() => {
    if (parsed === null || !parsed.ok) return []
    return toDateFields(parsed.value.epochMs)
  }, [parsed])

  return (
    <ToolLayout
      options={
        <>
          <Field label="时间戳单位">
            <Select
              label="时间戳单位"
              options={TIMESTAMP_UNITS}
              value={unit}
              onChange={(next) => updateOptions({ unit: next })}
            />
          </Field>
          <button
            type="button"
            className={BUTTON}
            onClick={() => update({ input: '1700000000' })}
          >
            填入示例
          </button>
          <button type="button" className={BUTTON} onClick={() => update({ input: '' })}>
            清空
          </button>
        </>
      }
      input={
        <CodeArea
          label="日期或时间戳"
          value={input}
          rows={6}
          onChange={(value) => update({ input: value })}
          placeholder="例如 1700000000、2024-03-15T08:30:00Z、2024/03/15 08:30:00"
        />
      }
      output={
        parsed === null ? (
          <EmptyState title="尚未输入" hint="输入时间戳或日期即可查看七种表示" />
        ) : !parsed.ok ? (
          <ErrorNote info={parsed} />
        ) : (
          <ul className="m-0 list-none p-0">
            {fields.map((field) => (
              <li
                key={field.id}
                className="flex items-start gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0"
              >
                <span className="w-32 shrink-0 text-muted">{field.label}</span>
                <code className="code-text min-w-0 flex-1 break-all">{field.value}</code>
                <CopyButton text={field.value} label="复制" />
              </li>
            ))}
          </ul>
        )
      }
      status={
        parsed === null ? (
          <span>等待输入</span>
        ) : !parsed.ok ? (
          <span className="text-danger">{parsed.error}</span>
        ) : (
          <span>
            识别为 {parsed.value.inputFormat} · {parsed.value.basis}
            {parsed.value.ambiguous && (
              <span className="text-warn"> · 该输入可能有多种解释，可手动指定单位</span>
            )}
          </span>
        )
      }
    />
  )
}
