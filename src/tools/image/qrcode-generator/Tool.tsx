import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  contrastRatio,
  generateQrMatrix,
  isLowContrast,
  QR_EC_LEVELS,
  QR_MARGIN,
  qrByteLength,
  qrPixelSize,
  qrToSvg,
  resolveQrRenderOptions,
  QR_DEFAULT_BACKGROUND,
  QR_DEFAULT_FOREGROUND,
  QR_MODULE_SIZE,
  type QrEcLevel,
} from '@/core/image/qrcode'
import { copyImage } from '@/framework/clipboard'
import { downloadBlob, downloadText } from '@/framework/file'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { ColorInput, NumberInput, SegmentedControl } from '@/framework/ui/Inputs'
import { Pane } from '@/framework/ui/Pane'
import { CANVAS_UNAVAILABLE, canvasToPngBlob, renderQrToCanvas } from './canvas'

const INITIAL_STATE = {
  input: '',
  options: {
    ecLevel: 'M' as QrEcLevel,
    moduleSize: QR_MODULE_SIZE.default,
    foreground: QR_DEFAULT_FOREGROUND,
    background: QR_DEFAULT_BACKGROUND,
  },
}

const SAMPLE = 'https://example.com/it-toolbox'

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

type Notice = { tone: 'ok' | 'error'; text: string }

/**
 * 给分段控件配可见标签。
 *
 * **不用 `Field`**：`Field` 渲染的是 `<label>`，而可访问名计算里「宿主语言标签」
 * 排在「自身内容」之前，于是标签会**只**关联到第一个可聚焦后代 ——
 * 四个分段按钮里第一个的可访问名会变成「纠错等级」而不是「L」，
 * 剩下三个才正常。用 `<span>` 保留可见标签，按钮的可访问名就都是自身文字。
 */
function LabeledGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12px]">
      <span className="shrink-0 text-muted">{label}</span>
      {children}
    </span>
  )
}

export default function QrcodeGeneratorTool() {
  const { state, update, updateOptions } = useToolState('qrcode-generator', INITIAL_STATE)
  const { input } = state
  const { ecLevel, moduleSize, foreground, background } = state.options

  const [notice, setNotice] = useState<Notice | null>(null)

  const isEmpty = input.trim().length === 0

  // 依赖全部是原始值（计划① R16：对象依赖会造成无限渲染循环）
  const generated = useMemo(
    () => (isEmpty ? null : generateQrMatrix(input, { ecLevel })),
    [input, ecLevel, isEmpty],
  )

  // 一次归一化、SVG 与 Canvas 共用 ⇒ 导出内容与预览一致由构造保证
  const render = useMemo(
    () =>
      resolveQrRenderOptions({
        moduleSize,
        margin: QR_MARGIN.default,
        foreground,
        background,
      }),
    [moduleSize, foreground, background],
  )

  const matrix = generated !== null && generated.ok ? generated.value : null
  const svg = matrix === null ? null : qrToSvg(matrix, render)
  const lowContrast = isLowContrast(render.foreground, render.background)
  const pixels = matrix === null ? 0 : qrPixelSize(matrix, render)

  /** 导出 / 复制都要一块与预览同参的离屏 canvas */
  const drawOffscreen = (): HTMLCanvasElement | null => {
    if (matrix === null) return null
    const canvas = document.createElement('canvas')
    return renderQrToCanvas(canvas, matrix, render) ? canvas : null
  }

  const exportSvg = async () => {
    if (svg === null) return
    const result = await downloadText('qrcode.svg', svg, 'image/svg+xml')
    setNotice({ tone: result.ok ? 'ok' : 'error', text: result.ok ? '已导出 SVG' : result.error })
  }

  const exportPng = async () => {
    const canvas = drawOffscreen()
    if (canvas === null) {
      setNotice({ tone: 'error', text: CANVAS_UNAVAILABLE })
      return
    }
    const blob = await canvasToPngBlob(canvas)
    if (!blob.ok) {
      setNotice({ tone: 'error', text: blob.error })
      return
    }
    const result = await downloadBlob('qrcode.png', blob.value)
    setNotice({ tone: result.ok ? 'ok' : 'error', text: result.ok ? '已导出 PNG' : result.error })
  }

  const copyPng = async () => {
    const canvas = drawOffscreen()
    if (canvas === null) {
      setNotice({ tone: 'error', text: CANVAS_UNAVAILABLE })
      return
    }
    const blob = await canvasToPngBlob(canvas)
    if (!blob.ok) {
      setNotice({ tone: 'error', text: blob.error })
      return
    }
    // 失败时就地把原因显示出来（WKWebView 下 ClipboardItem 可能不存在），
    // 而不是把按钮藏掉 —— 藏掉会让「复制图片」这条能力在真机上永远不可达
    const result = await copyImage(blob.value)
    setNotice({ tone: result.ok ? 'ok' : 'error', text: result.ok ? '已复制图片' : result.error })
  }

  return (
    <ToolLayout
      options={
        <>
          <LabeledGroup label="纠错等级">
            <SegmentedControl
              label="纠错等级"
              options={QR_EC_LEVELS}
              value={ecLevel}
              onChange={(next) => updateOptions({ ecLevel: next })}
            />
          </LabeledGroup>
          <Field label="模块尺寸">
            <NumberInput
              label="模块尺寸"
              value={moduleSize}
              min={QR_MODULE_SIZE.min}
              max={QR_MODULE_SIZE.max}
              onChange={(next) => updateOptions({ moduleSize: next })}
            />
          </Field>
          <Field label="前景">
            <ColorInput
              label="前景色"
              value={foreground}
              onChange={(next) => updateOptions({ foreground: next })}
            />
          </Field>
          <Field label="背景">
            <ColorInput
              label="背景色"
              value={background}
              onChange={(next) => updateOptions({ background: next })}
            />
          </Field>
          <button type="button" className={BUTTON} onClick={() => update({ input: SAMPLE })}>
            填入示例
          </button>
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              update({ input: '' })
              setNotice(null)
            }}
          >
            清空
          </button>
        </>
      }
      body={
        <div className="flex h-full min-h-0 flex-col gap-2 min-[720px]:flex-row">
          <Pane title="输入" className="min-h-0 flex-1">
            <CodeArea
              label="输入内容"
              value={input}
              rows={6}
              onChange={(value) => update({ input: value })}
              placeholder="输入文本或网址，右侧实时生成"
            />
          </Pane>

          <Pane title="预览" className="min-h-0 flex-1">
            <div className="flex h-full min-h-0 flex-col">
              {lowContrast && (
                <p className="border-b border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-warn">
                  前景与背景的对比度约
                  {contrastRatio(render.foreground, render.background).toFixed(2)}:1，低于建议的 3:1，
                  部分扫码器可能无法识别 —— 已按当前配色生成，可加大明暗差异改善。
                </p>
              )}

              <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
                {generated !== null && !generated.ok ? (
                  <ErrorNote info={generated} />
                ) : svg === null ? (
                  <EmptyState title="需要输入内容" hint="输入文本即可实时生成二维码" />
                ) : (
                  <span
                    data-testid="qr-preview"
                    className="block [&>svg]:h-auto [&>svg]:max-h-full [&>svg]:w-auto [&>svg]:max-w-full"
                    // 安全性来自 Core 的三条硬约束（颜色只可能是 normalizeHexColor 产出的
                    // ^#[0-9a-f]{6}$、其余进入 SVG 的都是数字、文本内容从不进入 SVG），
                    // 三条都有 core/image/qrcode.test.ts 的断言锁定
                    dangerouslySetInnerHTML={{ __html: svg }}
                  />
                )}
              </div>

              {svg !== null && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border p-2">
                  <button type="button" className={BUTTON} onClick={exportPng}>
                    导出 PNG
                  </button>
                  <button type="button" className={BUTTON} onClick={exportSvg}>
                    导出 SVG
                  </button>
                  <button type="button" className={BUTTON} onClick={copyPng}>
                    复制图片
                  </button>
                  {notice !== null && (
                    <span
                      role="status"
                      className={notice.tone === 'ok' ? 'text-[12px] text-success' : 'text-[12px] text-danger'}
                    >
                      {notice.text}
                    </span>
                  )}
                </div>
              )}
            </div>
          </Pane>
        </div>
      }
      status={
        generated === null ? (
          <span>等待输入</span>
        ) : !generated.ok ? (
          <span className="text-danger">{generated.error}</span>
        ) : (
          <span>
            版本 v{generated.value.version} · 模组 {generated.value.size}×{generated.value.size} · 输出{' '}
            {pixels}×{pixels} 像素 · 内容 {qrByteLength(input)} 字节
          </span>
        )
      }
    />
  )
}
