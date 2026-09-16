import { useMemo } from 'react'
import { markdownToHtml } from '@/core/converter/markdown'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { Field } from '@/framework/ui/Field'
import { SegmentedControl } from '@/framework/ui/Inputs'

type View = 'preview' | 'source'

const INITIAL_STATE = {
  input: '',
  options: { view: 'preview' as View },
}

const VIEW_OPTIONS = [
  { value: 'preview' as View, label: '预览' },
  { value: 'source' as View, label: '源码' },
]

const SAMPLE = [
  '# 标题',
  '',
  '一段正文，包含 `行内代码`。',
  '',
  '| 列 A | 列 B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```js',
  'const x = 1',
  '```',
  '',
  '![远程图片](https://example.com/a.png)',
  '',
  '[外部链接](https://example.com/docs)',
  '',
].join('\n')

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

export default function MarkdownToHtmlTool() {
  const { state, update, updateOptions } = useToolState('markdown-to-html', INITIAL_STATE)
  const { input } = state
  const { view } = state.options

  const html = useMemo(() => markdownToHtml(input), [input])
  const isEmpty = input.trim().length === 0

  return (
    <ToolLayout
      options={
        <>
          <Field label="视图">
            <SegmentedControl
              label="预览视图"
              options={VIEW_OPTIONS}
              value={view}
              onChange={(next) => updateOptions({ view: next })}
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
          label="Markdown 源码"
          value={input}
          rows={14}
          onChange={(value) => update({ input: value })}
          placeholder={'# 标题\n\n一段正文'}
        />
      }
      output={
        isEmpty ? (
          <EmptyState title="尚未输入" hint="输入 Markdown 即可查看渲染结果" />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={html} label="复制 HTML 源码" />
              <DownloadButton filename="output.html" text={html} />
            </div>
            {view === 'source' ? (
              <CodeArea value={html} readOnly label="HTML 源码" />
            ) : (
              /*
                预览用 dangerouslySetInnerHTML：安全性不来自 React 的转义，
                而来自 core/converter/markdown.ts 的三个硬约束 —— html:false
                （原始标签全部转义）、图片规则覆写（不产出 <img>）、
                链接规则覆写（不产出 <a href>）。三者都有 Core 层用例锁定。
              */
              <div
                className="md-preview p-2.5"
                data-testid="md-preview"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
          </>
        )
      }
      status={<span>输出 {html.length} 字符</span>}
    />
  )
}
