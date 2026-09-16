import { useMemo } from 'react'
import { minifyJson } from '@/core/json/minify'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'

const INITIAL_STATE = { input: '', options: {} }

const SAMPLE = `{
  "name": "it-toolbox",
  "version": "1.0.0",
  "tags": ["json", "工具"],
  "escaped": "\\u0041"
}`

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

export default function JsonMinifyTool() {
  const { state, update } = useToolState('json-minify', INITIAL_STATE)
  const { input } = state

  const isEmpty = input.trim().length === 0

  // 依赖全部是原始值（计划① R16：对象依赖会造成无限渲染循环）
  const result = useMemo(() => (isEmpty ? null : minifyJson(input)), [input, isEmpty])

  // 空输入时不给比例：0 → 0 算出来的「节省 0%」是在回答一个没人问的问题
  const savingsPercent =
    result !== null && result.ok && result.value.inputBytes > 0
      ? ((result.value.inputBytes - result.value.outputBytes) / result.value.inputBytes) * 100
      : 0

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
          placeholder="粘贴带缩进或换行的 JSON"
        />
      }
      output={
        result === null ? (
          <EmptyState title="尚未输入" hint="粘贴 JSON 即可压缩成单行" />
        ) : !result.ok ? (
          <ErrorNote info={result} />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={result.value.output} label="复制" />
              <DownloadButton
                filename="minified.json"
                text={result.value.output}
                mime="application/json;charset=utf-8"
                label="下载"
              />
            </div>
            <CodeArea value={result.value.output} readOnly label="压缩结果" />
          </>
        )
      }
      status={
        result === null ? (
          <span>等待输入</span>
        ) : !result.ok ? (
          <span className="text-danger">{result.error}</span>
        ) : (
          <span>
            {result.value.inputBytes} → {result.value.outputBytes} 字节 · 节省{' '}
            {savingsPercent.toFixed(1)}%
          </span>
        )
      }
    />
  )
}
