import { useMemo } from 'react'
import { yamlToJson, type YamlIndent } from '@/core/converter/yaml'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { Select } from '@/framework/ui/Inputs'

const INITIAL_STATE = {
  input: '',
  options: { indent: 2 as YamlIndent },
}

const INDENT_OPTIONS = [
  { value: '2' as const, label: '2 空格' },
  { value: '4' as const, label: '4 空格' },
]

const SAMPLE = ['name: toolbox', 'tags:', '  - crypto', '  - converter', 'meta:', '  ok: true', ''].join(
  '\n',
)

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

export default function YamlToJsonTool() {
  const { state, update, updateOptions } = useToolState('yaml-to-json', INITIAL_STATE)
  const { input } = state
  const { indent } = state.options

  const converted = useMemo(
    () => (input.trim().length === 0 ? null : yamlToJson(input, { indent })),
    [input, indent],
  )

  return (
    <ToolLayout
      options={
        <>
          <Field label="输出缩进">
            <Select
              label="输出缩进"
              options={INDENT_OPTIONS}
              value={String(indent) as '2' | '4'}
              onChange={(next) => updateOptions({ indent: Number(next) as YamlIndent })}
            />
          </Field>
          <button type="button" className={BUTTON} onClick={() => update({ input: SAMPLE })}>
            填入示例
          </button>
          <button type="button" className={BUTTON} onClick={() => update({ input: '' })}>
            清空
          </button>
        </>
      }
      input={
        <CodeArea
          label="YAML 源码"
          value={input}
          rows={12}
          onChange={(value) => update({ input: value })}
          placeholder={'name: toolbox\ntags:\n  - crypto'}
        />
      }
      output={
        converted === null ? (
          <EmptyState title="尚未输入" hint="粘贴 YAML 即可得到 JSON" />
        ) : !converted.ok ? (
          <ErrorNote info={converted} />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={converted.value} label="复制全部" />
              <DownloadButton filename="output.json" text={converted.value} />
            </div>
            <CodeArea value={converted.value} readOnly label="JSON 结果" />
          </>
        )
      }
      status={
        converted === null ? (
          <span>等待输入</span>
        ) : !converted.ok ? (
          <span className="text-danger">{converted.error}</span>
        ) : (
          <span>
            缩进 {indent} 空格 · 输出 {converted.value.length} 字符
          </span>
        )
      }
    />
  )
}
