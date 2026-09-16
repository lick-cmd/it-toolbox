import type { ReactNode } from 'react'
import { Pane } from './ui/Pane'
import { ToolbarRow } from './ui/Inputs'

export type ToolLayoutProps = {
  options?: ReactNode
  status?: ReactNode
  /** 工具说明文案（如「本工具不联网」「v1 基于时间戳」），与输入无关 */
  note?: ReactNode
} & (
  | { body: ReactNode; input?: never; output?: never }
  | { input?: ReactNode; output: ReactNode; body?: never }
)

/**
 * 工具的四区域布局。
 *
 * 判别联合覆盖两种形态：
 * - 标准形态（14 个工具）：传入 input / output，左右并排
 * - 自由形态（JSON diff 双栏、二维码预览）：传入 body，自行排布
 *
 * **无输入工具**（UUID / ULID / Token / RSA 生成器）只传 output：
 * 输入面板整个不渲染，输出占满整宽 —— spec 要求「输入区不占据界面空间」，
 * 说明文案改走 note 槽位，不再借用输入面板当占位容器。
 *
 * 720px 以下是 spec 要求的并排转堆叠断点，用 arbitrary variant
 * 精确命中该宽度，而非 Tailwind 默认的 768px（md）。
 */
export function ToolLayout(props: ToolLayoutProps) {
  const hasBody = 'body' in props && props.body !== undefined

  return (
    <div className="flex h-full min-h-0 flex-col">
      {props.options !== undefined && (
        <div className="shrink-0 border-b border-border bg-surface px-3 py-2">
          <ToolbarRow>{props.options}</ToolbarRow>
        </div>
      )}

      {props.note !== undefined && (
        <div className="shrink-0 border-b border-border bg-surface px-3 py-2 text-[12px] text-muted">
          {props.note}
        </div>
      )}

      {hasBody ? (
        <div className="min-h-0 flex-1 p-2.5">{props.body}</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-2.5 min-[720px]:flex-row">
          {props.input !== undefined && (
            <Pane title="输入" className="min-h-0 flex-1">
              {props.input}
            </Pane>
          )}
          <Pane title="输出" className="min-h-0 flex-1">
            {props.output}
          </Pane>
        </div>
      )}

      {props.status !== undefined && (
        <div className="shrink-0 border-t border-border px-3 py-1.5 text-[12px] text-muted">
          {props.status}
        </div>
      )}
    </div>
  )
}
