import { useEffect, useMemo, useState } from 'react'
import { utf8ByteLength } from '@/core/bytes'
import { formatJson, type JsonIndent } from '@/core/json/format'
import { parseJsonValue } from '@/core/json/parse'
import { buildJsonTree } from '@/core/json/tree'
import { collectTypeHints } from '@/core/json/type-hints'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Checkbox, SegmentedControl } from '@/framework/ui/Inputs'
import { JsonCode } from '@/framework/ui/JsonCode'
import { JsonTree } from '@/framework/ui/JsonTree'
import { Spinner } from '@/framework/ui/Spinner'
import type { SelectOption } from '@/framework/ui'

/** UI 里的选项只能是字符串，故用 '2' | '4' | 'tab'，落到 Core 时再换算 */
type IndentChoice = '2' | '4' | 'tab'
type ViewChoice = 'json' | 'hints' | 'tree'

const INDENT_OPTIONS: readonly SelectOption<IndentChoice>[] = [
  { value: '2', label: '2 空格' },
  { value: '4', label: '4 空格' },
  { value: 'tab', label: '制表符' },
]

const VIEW_OPTIONS: readonly SelectOption<ViewChoice>[] = [
  { value: 'json', label: 'JSON' },
  { value: 'hints', label: '类型提示' },
  { value: 'tree', label: '树形' },
]

const INDENT_LABEL: Record<IndentChoice, string> = {
  '2': '2 空格',
  '4': '4 空格',
  tab: '制表符',
}

function toJsonIndent(choice: IndentChoice): JsonIndent {
  if (choice === 'tab') return 'tab'
  return choice === '2' ? 2 : 4
}

const INITIAL_STATE = {
  input: '',
  options: {
    indent: '2' as IndentChoice,
    sortKeys: false,
    view: 'json' as ViewChoice,
  },
}

const SAMPLE = '{"name":"it-toolbox","tags":["json",{"b":1,"a":2}],"escaped":"\\u0041"}'

/** 设计文档 `:211`：超过这个体量先渲染「处理中」再延迟计算 */
const LARGE_INPUT_BYTES = 512 * 1024

/**
 * 预览上限。
 *
 * 格式化结果每行、类型提示每条都要渲染 DOM，几万行会把界面拖垮
 * （jsdom 里同样会拖垮测试），故只预览前面这些；复制与下载给的始终是完整输出。
 */
const MAX_PREVIEW_ROWS = 2000

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

export default function JsonFormatTool() {
  const { state, update, updateOptions } = useToolState('json-format', INITIAL_STATE)
  const { input } = state
  const { indent, sortKeys, view } = state.options

  // 哪份文本已经算完了。小输入首帧就同步跟上（不会为每次按键闪一帧「处理中」），
  // 大输入让出一帧再算 —— 界面因此不出现无响应。
  const [settled, setSettled] = useState(input)
  const large = utf8ByteLength(input) > LARGE_INPUT_BYTES

  useEffect(() => {
    if (!large) {
      if (settled !== input) setSettled(input)
      return
    }
    const timer = setTimeout(() => setSettled(input), 0)
    return () => clearTimeout(timer)
  }, [input, large, settled])

  const computing = large && settled !== input
  const isEmpty = input.trim().length === 0

  // 依赖全部是原始值（计划① R16：对象依赖会造成无限渲染循环）
  const result = useMemo(
    () => (computing || isEmpty ? null : formatJson(input, { indent: toJsonIndent(indent), sortKeys })),
    [computing, isEmpty, input, indent, sortKeys],
  )

  const output = result !== null && result.ok ? result.value.output : null

  // 类型提示只在切到该视图时才算：它要把值对象再走一遍，大输入下不该白花这份钱
  const hints = useMemo(() => {
    if (view !== 'hints' || output === null) return []
    const parsed = parseJsonValue(input)
    return parsed.ok ? collectTypeHints(parsed.value) : []
  }, [view, output, input])

  // 树只在切到该视图时构建：与类型提示同理，大输入下不该白花这份钱
  const tree = useMemo(
    () => (view !== 'tree' || output === null ? null : buildJsonTree(input)),
    [view, output, input],
  )

  const preview = useMemo(() => {
    if (output === null) return null
    const lines = output.split('\n')
    return lines.length > MAX_PREVIEW_ROWS
      ? { text: lines.slice(0, MAX_PREVIEW_ROWS).join('\n'), total: lines.length }
      : { text: output, total: lines.length }
  }, [output])

  const visibleHints = hints.length > MAX_PREVIEW_ROWS ? hints.slice(0, MAX_PREVIEW_ROWS) : hints

  return (
    <ToolLayout
      options={
        <>
          <SegmentedControl
            label="缩进"
            options={INDENT_OPTIONS}
            value={indent}
            onChange={(next) => updateOptions({ indent: next })}
          />
          <SegmentedControl
            label="视图"
            options={VIEW_OPTIONS}
            value={view}
            onChange={(next) => updateOptions({ view: next })}
          />
          <Checkbox
            label="键排序"
            checked={sortKeys}
            onChange={(checked) => updateOptions({ sortKeys: checked })}
          />
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
          placeholder="粘贴需要美化的 JSON"
        />
      }
      output={
        computing ? (
          <div className="p-2.5">
            <Spinner label="正在处理…" />
          </div>
        ) : result === null ? (
          <EmptyState title="尚未输入" hint="粘贴 JSON 即可格式化" />
        ) : !result.ok ? (
          <ErrorNote info={result} />
        ) : (
          <>
            {sortKeys && (
              <p className="border-b border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-warn">
                键排序会按值对象重建输出：字符串里的等价转义写法（如 \u0041 → A）会被规范化，
                大整数精度、1e999 这类超范围指数、-0 与重复键也可能被改写
                {result.value.normalizedEscapes ? '（本次输出确实来自重建）' : ''}
                。不勾选键排序时不会重建，上述内容原样保留。
              </p>
            )}

            <div className="flex items-center justify-between gap-2 border-b border-border px-1.5 py-1">
              <span className="text-[11px] text-muted">
                {view === 'hints' ? '逐值类型提示' : view === 'tree' ? '树形视图' : '格式化结果'}
              </span>
              {view !== 'hints' && (
                <span className="flex items-center gap-1">
                  <CopyButton text={output ?? ''} label="复制" />
                  <DownloadButton
                    filename="formatted.json"
                    text={output ?? ''}
                    mime="application/json;charset=utf-8"
                    label="下载"
                  />
                </span>
              )}
            </div>

            {view === 'tree' ? (
              tree === null || !tree.ok ? (
                <p className="p-2.5 text-[12px] text-muted">（尚无可用结果）</p>
              ) : (
                <JsonTree tree={tree.value} label="树形视图" />
              )
            ) : view === 'hints' ? (
              hints.length === 0 ? (
                <p className="p-2.5 text-[12px] text-muted">（没有可提示的值）</p>
              ) : (
                <>
                  {visibleHints.length < hints.length && (
                    <p className="border-b border-border px-2.5 py-1 text-[12px] text-warn">
                      共 {hints.length} 个值，仅显示前 {MAX_PREVIEW_ROWS} 个。
                    </p>
                  )}
                  <ul className="m-0 list-none p-0 text-[12px]" data-testid="json-type-hints">
                    {visibleHints.map((hint) => (
                      <li
                        key={`${hint.path}:${hint.type}`}
                        className="flex flex-wrap items-baseline gap-2 border-b border-border/60 px-2.5 py-1 last:border-b-0"
                      >
                        <code className="code-text shrink-0">{hint.path}</code>
                        <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 text-muted">
                          {hint.label}
                        </span>
                        {hint.summary !== '' && (
                          <span className="text-muted">{hint.summary}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )
            ) : (
              <>
                {preview !== null && preview.total > MAX_PREVIEW_ROWS && (
                  <p className="border-b border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-warn">
                    输出共 {preview.total} 行，预览仅显示前 {MAX_PREVIEW_ROWS} 行；
                    预览内容不完整，因此不参与语法着色、也不提供折叠（两者都要求预览是一份完整合法的
                    JSON）；复制与下载给的是完整内容。
                  </p>
                )}
                <JsonCode value={preview?.text ?? ''} label="格式化结果" foldable />
              </>
            )}
          </>
        )
      }
      status={
        computing ? (
          <span>正在处理大输入…</span>
        ) : result === null ? (
          <span>等待输入</span>
        ) : !result.ok ? (
          <span className="text-danger">{result.error}</span>
        ) : (
          <span>
            缩进 {INDENT_LABEL[indent]}
            {sortKeys ? ' · 键排序' : ''} · {result.value.inputBytes} → {result.value.outputBytes} 字节
          </span>
        )
      }
    />
  )
}
