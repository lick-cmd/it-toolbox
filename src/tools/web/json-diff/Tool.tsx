import { useMemo } from 'react'
import {
  compareJson,
  DIFF_KIND_LABEL,
  failedSide,
  JSON_TYPE_LABEL,
  type DiffEntry,
  type DiffKind,
} from '@/core/web/json-diff'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Icon } from '@/framework/ui/Icon'
import { Pane } from '@/framework/ui/Pane'

/**
 * 右侧输入放在 `options` 而不是 `input` 里：`input` 是「主输入」字段（会被
 * `useToolState` 与清空语义特殊对待），双输入工具把主输入留给左侧，右侧随
 * 参数一起持久化。
 */
const INITIAL_STATE = {
  input: '',
  options: { right: '' },
}

const SAMPLE_LEFT = '{"a":1,"b":[1,2,3],"c":{"d":"x"}}'
const SAMPLE_RIGHT = '{"a":2,"b":[1,9],"c":{"d":"x"},"e":true}'

const KIND_CLASS: Record<DiffKind, string> = {
  added: 'text-success',
  removed: 'text-danger',
  changed: 'text-warn',
}

const BUTTON =
  'inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

function formatValue(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function DiffRow({ entry }: { entry: DiffEntry }) {
  // 只在「修改」且两侧类型不同时并列类型，避免新增 / 删除项被「缺失 → 数字」这类噪声刷屏
  const showTypes = entry.kind === 'changed' && entry.leftType !== entry.rightType

  return (
    <li className="flex flex-wrap items-baseline gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0">
      <span className={`w-8 shrink-0 text-[12px] font-medium ${KIND_CLASS[entry.kind]}`}>
        {DIFF_KIND_LABEL[entry.kind]}
      </span>
      <code className="code-text shrink-0 text-fg">{entry.path}</code>
      <span className="code-text min-w-0 break-all text-muted">
        {formatValue(entry.left)}
        {' → '}
        {formatValue(entry.right)}
      </span>
      {showTypes && (
        <span className="text-[12px] text-warn">
          （{JSON_TYPE_LABEL[entry.leftType]} → {JSON_TYPE_LABEL[entry.rightType]}）
        </span>
      )}
    </li>
  )
}

export default function JsonDiffTool() {
  const { state, update, updateOptions, reset } = useToolState('json-diff', INITIAL_STATE)
  const { input } = state
  const right = state.options.right

  const bothEmpty = input.trim().length === 0 && right.trim().length === 0

  // 依赖全部是原始值（计划① R16：对象依赖会造成无限渲染循环）
  const compared = useMemo(
    () => (bothEmpty ? null : compareJson(input, right)),
    [input, right, bothEmpty],
  )

  const failure = compared !== null && !compared.ok ? compared : null
  const entries = compared !== null && compared.ok ? compared.value : []
  const badSide = failure === null ? null : failedSide(failure)

  const counts = useMemo(() => {
    const tally = { added: 0, removed: 0, changed: 0 }
    for (const entry of entries) tally[entry.kind] += 1
    return tally
  }, [entries])

  return (
    <ToolLayout
      options={
        <>
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              // 两次函数式 setState 会被 React 批处理，顺序安全
              const previousLeft = input
              update({ input: right })
              updateOptions({ right: previousLeft })
            }}
          >
            <Icon name="swap" size={13} />
            交换两侧
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              update({ input: SAMPLE_LEFT })
              updateOptions({ right: SAMPLE_RIGHT })
            }}
          >
            填入示例
          </button>
          <button
            type="button"
            className={BUTTON}
            // 用框架层的 reset，而不是自己拼两次 setState：它同时抹掉该工具已落盘的快照，
            // 「清空」于是对持久化也成立（否则旧内容还躺在 localStorage 里）
            onClick={() => reset()}
          >
            清空
          </button>
        </>
      }
      body={
        <div className="flex h-full min-h-0 flex-col gap-2">
          <div className="flex min-h-0 flex-1 flex-col gap-2 min-[720px]:flex-row">
            <Pane
              title="左侧 JSON"
              tone={badSide === 'left' ? 'danger' : 'default'}
              className="min-h-0 flex-1"
            >
              <CodeArea
                label="左侧 JSON"
                value={input}
                rows={10}
                onChange={(value) => update({ input: value })}
                errorLine={badSide === 'left' && failure !== null ? failure.line : undefined}
                placeholder="粘贴第一段 JSON"
              />
              {badSide === 'left' && failure !== null && <ErrorNote info={failure} />}
            </Pane>

            <Pane
              title="右侧 JSON"
              tone={badSide === 'right' ? 'danger' : 'default'}
              className="min-h-0 flex-1"
            >
              <CodeArea
                label="右侧 JSON"
                value={right}
                rows={10}
                onChange={(value) => updateOptions({ right: value })}
                errorLine={badSide === 'right' && failure !== null ? failure.line : undefined}
                placeholder="粘贴第二段 JSON"
              />
              {badSide === 'right' && failure !== null && <ErrorNote info={failure} />}
            </Pane>
          </div>

          <Pane title="差异结果" className="min-h-0 flex-1">
            {compared === null ? (
              <EmptyState title="尚未输入" hint="左右各粘贴一段 JSON 即可比较" />
            ) : failure !== null ? (
              <p className="p-2.5 text-[12px] text-muted">修正该侧 JSON 后才会输出差异。</p>
            ) : entries.length === 0 ? (
              <p className="p-2.5 text-[12px] text-success">两段 JSON 无差异</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {entries.map((entry) => (
                  <DiffRow key={`${entry.kind}:${entry.path}`} entry={entry} />
                ))}
              </ul>
            )}
          </Pane>
        </div>
      }
      status={
        compared === null ? (
          <span>等待输入</span>
        ) : failure !== null ? (
          <span className="text-danger">{failure.error}</span>
        ) : entries.length === 0 ? (
          <span className="text-success">无差异</span>
        ) : (
          <span>
            新增 {counts.added} · 删除 {counts.removed} · 修改 {counts.changed}
          </span>
        )
      }
    />
  )
}
