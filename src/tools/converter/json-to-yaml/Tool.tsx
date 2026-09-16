import { useMemo } from 'react'
import { jsonToYaml } from '@/core/converter/yaml'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'

/**
 * `options` 为空对象是有意的：本工具没有参数，但 `useToolState` 的状态形状
 * 需要为 `options` 留位（持久化的载荷统一是 `{ input, options, updatedAt }`）。
 */
const INITIAL_STATE = {
  input: '',
  options: {},
}

const SAMPLE = '{"name":"toolbox","tags":["crypto","converter"],"meta":{"ok":true}}'

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

export default function JsonToYamlTool() {
  const { state, update } = useToolState('json-to-yaml', INITIAL_STATE)
  const { input } = state

  const converted = useMemo(() => (input.trim().length === 0 ? null : jsonToYaml(input)), [input])

  return (
    <ToolLayout
      options={
        <>
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
          label="JSON 源码"
          value={input}
          rows={12}
          onChange={(value) => update({ input: value })}
          placeholder={'{"name":"toolbox"}'}
        />
      }
      output={
        converted === null ? (
          <EmptyState title="尚未输入" hint="粘贴 JSON 即可得到 YAML" />
        ) : !converted.ok ? (
          <ErrorNote info={converted} />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={converted.value} label="复制全部" />
              <DownloadButton filename="output.yaml" text={converted.value} />
            </div>
            <CodeArea value={converted.value} readOnly label="YAML 结果" />
          </>
        )
      }
      status={
        converted === null ? (
          <span>等待输入</span>
        ) : !converted.ok ? (
          <span className="text-danger">{converted.error}</span>
        ) : (
          <span>输出 {converted.value.split('\n').length - 1} 行</span>
        )
      }
    />
  )
}
