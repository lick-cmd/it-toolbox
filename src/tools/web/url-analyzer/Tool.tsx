import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { analyzeUrl, type AnalyzedText, type UrlAnalysis } from '@/core/web/url-analyzer'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'

const INITIAL_STATE = { input: '', options: {} }

const SAMPLE = 'https://user:pass@example.com:8443/a/b?x=1&x=2&q=%E4%B8%AD%E6%96%87#sec'

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'
const ROW = 'grid grid-cols-[5.5rem_1fr] gap-x-3 py-0.5'
const TERM = 'text-muted'

/**
 * 有解码形式时两种并列展示；没有时只展示原始形式。
 *
 * spec 要求「同时展示原始编码形式与解码后的可读形式」，故只在
 * `encoded` 为真时渲染两行 —— 否则到处都是重复的一行。
 */
function TextValue({ text, label }: { text: AnalyzedText; label: string }) {
  if (text.raw === '') return <span className="text-muted">（无）</span>
  if (!text.encoded) return <code className="code-text break-all">{text.raw}</code>

  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-baseline gap-1.5">
        <span className="shrink-0 text-[11px] text-muted">原始</span>
        <code className="code-text break-all">{text.raw}</code>
      </span>
      <span className="flex items-baseline gap-1.5">
        <span className="shrink-0 text-[11px] text-muted">解码</span>
        <code className="code-text break-all text-fg">{text.decoded}</code>
      </span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

function PartsTable({ analysis }: { analysis: UrlAnalysis }) {
  const rows: { term: string; value: ReactNode }[] = [
    { term: '协议', value: <code className="code-text">{analysis.protocol}</code> },
    {
      term: '用户名',
      value: analysis.username ? (
        <code className="code-text">{analysis.username}</code>
      ) : (
        <span className="text-muted">（无）</span>
      ),
    },
    {
      term: '密码',
      value: analysis.password ? (
        <code className="code-text">{analysis.password}</code>
      ) : (
        <span className="text-muted">（无）</span>
      ),
    },
    { term: '主机名', value: <code className="code-text">{analysis.hostname}</code> },
    {
      term: '端口',
      value: (
        <span className="flex items-baseline gap-2">
          <code className="code-text">{analysis.port}</code>
          {analysis.isDefaultPort && (
            <span className="text-[11px] text-muted">协议默认端口</span>
          )}
          {analysis.explicitPort === null && (
            <span className="text-[11px] text-muted">（输入中未写出）</span>
          )}
        </span>
      ),
    },
    { term: 'Origin', value: <code className="code-text break-all">{analysis.origin}</code> },
    { term: '路径', value: <TextValue text={analysis.pathname} label="路径" /> },
    { term: '片段', value: <TextValue text={analysis.hash} label="片段" /> },
  ]

  return (
    <dl className="m-0 px-2.5 py-2 text-[12px]" data-testid="url-parts">
      {rows.map((row) => (
        <div key={row.term} className={ROW}>
          <dt className={TERM}>{row.term}</dt>
          <dd className="m-0 min-w-0">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function UrlAnalyzerTool() {
  const { state, update } = useToolState('url-analyzer', INITIAL_STATE)
  const { input } = state

  // 依赖只有原始值（计划① R16：对象依赖会造成无限渲染循环）
  const analyzed = useMemo(
    () => (input.trim().length === 0 ? null : analyzeUrl(input)),
    [input],
  )

  const notAbsolute =
    analyzed !== null && !analyzed.ok && analyzed.code === 'NOT_ABSOLUTE'
      ? analyzed.suggestion
      : null

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
          label="URL"
          value={input}
          rows={6}
          onChange={(value) => update({ input: value })}
          placeholder="https://example.com/a/b?x=1#sec"
        />
      }
      output={
        analyzed === null ? (
          <EmptyState title="尚未输入" hint="粘贴 URL 即可查看各组成部分" />
        ) : !analyzed.ok ? (
          <div className="space-y-2">
            <ErrorNote info={analyzed} />
            {notAbsolute !== null && notAbsolute !== '' && (
              <div className="px-2.5">
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => update({ input: notAbsolute })}
                >
                  按 https:// 补全
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y divide-border">
            <PartsTable analysis={analyzed.value} />

            <section className="px-2.5 py-2">
              <h3 className="mb-1 text-[11px] tracking-wide text-muted uppercase">路径分段</h3>
              {analyzed.value.pathSegments.length === 0 ? (
                <p className="text-[12px] text-muted">（无分段）</p>
              ) : (
                <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" data-testid="url-segments">
                  {analyzed.value.pathSegments.map((segment, index) => (
                    <li
                      key={`${index}-${segment.raw}`}
                      className="code-text rounded-sm bg-surface-2 px-1.5 py-0.5"
                    >
                      {segment.encoded ? `${segment.raw} → ${segment.decoded}` : segment.raw}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="px-2.5 py-2">
              <h3 className="mb-1 text-[11px] tracking-wide text-muted uppercase">
                查询参数（{analyzed.value.params.length}）
              </h3>
              {analyzed.value.params.length === 0 ? (
                <p className="text-[12px] text-muted">（无查询参数）</p>
              ) : (
                <table
                  className="w-full border-collapse text-left text-[12px]"
                  data-testid="url-params"
                >
                  <thead>
                    <tr className="text-muted">
                      <th className="border-b border-border py-1 pr-3 font-normal">键</th>
                      <th className="border-b border-border py-1 font-normal">值（原始 / 解码）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyzed.value.params.map((param, index) => (
                      <tr key={`${index}-${param.key.raw}`}>
                        <td className="border-b border-border/60 py-1 pr-3 align-top">
                          <TextValue text={param.key} label={`参数键 ${param.key.raw}`} />
                        </td>
                        <td className="border-b border-border/60 py-1 align-top">
                          <TextValue text={param.value} label={`参数值 ${param.value.raw}`} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        )
      }
      status={
        analyzed === null ? (
          <span>等待输入</span>
        ) : !analyzed.ok ? (
          <span className="text-danger">{analyzed.error}</span>
        ) : (
          <span>
            绝对 URL · 路径 {analyzed.value.pathSegments.length} 段 · 参数{' '}
            {analyzed.value.params.length} 个
          </span>
        )
      }
    />
  )
}
