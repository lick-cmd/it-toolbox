import { useMemo } from 'react'
import { decodeJwt, type JwtDecoded, type JwtPart } from '@/core/web/jwt'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'

/** 必须定义在组件外部：初始值参与 useToolState 的惰性初始化 */
const INITIAL_STATE = { input: '', options: {} }

const SECTION = 'border-b border-border px-2.5 py-2 last:border-b-0'
const SECTION_TITLE = 'mb-1 text-[11px] tracking-wide text-muted uppercase'
const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

/** 头部 / 载荷：解析成功展示格式化 JSON，失败展示原因 + 已解出的原始文本 */
function PartView({ title, part, label }: { title: string; part: JwtPart; label: string }) {
  const json = part.value === null ? null : JSON.stringify(part.value, null, 2)

  return (
    <section className={SECTION}>
      <div className="flex items-center justify-between gap-2">
        <h3 className={SECTION_TITLE}>{title}</h3>
        {json !== null && <CopyButton text={json} label="复制" />}
      </div>
      {part.error ? (
        <div className="space-y-1">
          <p className="text-[12px] text-danger">{part.error.error}</p>
          {part.text !== null && (
            <pre className="code-text m-0 overflow-auto rounded-md bg-surface-2 p-2 whitespace-pre-wrap">
              {part.text}
            </pre>
          )}
        </div>
      ) : (
        <CodeArea value={json ?? ''} readOnly label={label} />
      )}
    </section>
  )
}

function ExpiryBanner({ decoded }: { decoded: JwtDecoded }) {
  const { expiry } = decoded
  if (expiry.status === 'expired') {
    return (
      <p className="text-[12px] text-danger">该令牌已过期（已过期 {expiry.durationText}）</p>
    )
  }
  if (expiry.status === 'valid') {
    return (
      <p className="text-[12px] text-success">
        该令牌仍在有效期内（剩余 {expiry.durationText}）
      </p>
    )
  }
  return <p className="text-[12px] text-muted">该令牌未声明过期时间（载荷中没有 exp）</p>
}

export default function JwtParserTool() {
  const { state, update } = useToolState('jwt-parser', INITIAL_STATE)
  const { input } = state

  // 依赖只有原始值（计划① R16：对象依赖会造成无限渲染循环）
  const decoded = useMemo(
    () => (input.trim().length === 0 ? null : decodeJwt(input)),
    [input],
  )

  return (
    <ToolLayout
      options={
        <>
          <button type="button" className={BUTTON} onClick={() => update({ input: '' })}>
            清空
          </button>
        </>
      }
      input={
        <CodeArea
          label="JWT 令牌"
          value={input}
          rows={12}
          onChange={(value) => update({ input: value })}
          placeholder="粘贴形如 header.payload.signature 的令牌"
        />
      }
      output={
        decoded === null ? (
          <EmptyState title="尚未输入" hint="粘贴 JWT 即可查看三部分内容" />
        ) : !decoded.ok ? (
          <ErrorNote info={decoded} />
        ) : (
          <>
            <section className={SECTION}>
              <h3 className={SECTION_TITLE}>概览</h3>
              <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
                <dt className="text-muted">算法 alg</dt>
                <dd className="code-text m-0">{decoded.value.alg ?? '（未声明）'}</dd>
                <dt className="text-muted">类型 typ</dt>
                <dd className="code-text m-0">{decoded.value.typ ?? '（未声明）'}</dd>
              </dl>
              <div className="mt-1">
                <ExpiryBanner decoded={decoded.value} />
              </div>
            </section>

            <PartView title="头部 Header" part={decoded.value.header} label="头部 JSON" />
            <PartView title="载荷 Payload" part={decoded.value.payload} label="载荷 JSON" />

            {decoded.value.timeClaims.length > 0 && (
              <section className={SECTION}>
                <h3 className={SECTION_TITLE}>时间声明</h3>
                <ul className="m-0 list-none p-0 text-[12px]">
                  {decoded.value.timeClaims.map((claim) => (
                    <li key={claim.claim} className="flex flex-wrap items-baseline gap-2 py-0.5">
                      <span className="w-16 shrink-0 text-muted">{claim.label}</span>
                      <span className="code-text">{claim.readable}</span>
                      <span className="code-text text-muted">({claim.epochSeconds})</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className={SECTION}>
              <h3 className={SECTION_TITLE}>签名 Signature</h3>
              <code className="code-text block break-all">
                {decoded.value.signature || '（空）'}
              </code>
              <p className="mt-1 text-[12px] text-warn">
                签名未被校验：本工具只做 Base64URL 解码，不验证签名，不能据此判断令牌是否可信。
              </p>
            </section>
          </>
        )
      }
      status={
        decoded === null ? (
          <span>等待输入</span>
        ) : !decoded.ok ? (
          <span className="text-danger">{decoded.error}</span>
        ) : (
          <span>3 段 · 算法 {decoded.value.alg ?? '未声明'}</span>
        )
      }
    />
  )
}
