import { qrPixelSize, type QrMatrix, type QrRenderOptions } from '@/core/image/qrcode'
import { err, ok } from '@/core/result'
import type { Result } from '@/core/result'

/**
 * Canvas 渲染。
 *
 * 这是本功能里**唯一碰 DOM 的地方** —— `core/image/qrcode.ts` 只产出矩阵与 SVG 字符串
 * （设计文档 `:208`）。放在工具目录而不是框架目录：只有二维码导出用得到它，
 * 提进框架会变成没人用的公共 API。
 */

export const CANVAS_UNAVAILABLE = '当前环境不支持 Canvas，无法导出 PNG，可改用导出 SVG'
export const PNG_UNAVAILABLE = '浏览器未能生成 PNG 数据，可改用导出 SVG'

/**
 * 把矩阵画到 canvas 上，返回是否成功。
 *
 * 尺寸取 `qrPixelSize`，与 SVG 的 `width`/`height` 同源 ⇒ 导出的 PNG 与预览
 * 内容一致、尺寸与所选模块尺寸一致。
 *
 * 拿不到 2D 上下文时**返回 false 而不是抛错**：jsdom 就是这种情况
 * （实测 `getContext('2d')` 返回 `null`），而工具在测试环境里也要能正常渲染。
 */
export function renderQrToCanvas(
  canvas: HTMLCanvasElement,
  matrix: QrMatrix,
  render: QrRenderOptions,
): boolean {
  const pixels = qrPixelSize(matrix, render)
  canvas.width = pixels
  canvas.height = pixels

  const context = canvas.getContext('2d')
  if (context === null) return false

  context.fillStyle = render.background
  context.fillRect(0, 0, pixels, pixels)

  context.fillStyle = render.foreground
  const { moduleSize, margin } = render
  for (let row = 0; row < matrix.size; row++) {
    const line = matrix.modules[row]
    if (line === undefined) continue
    for (let col = 0; col < matrix.size; col++) {
      if (line[col] !== true) continue
      context.fillRect(
        (col + margin) * moduleSize,
        (row + margin) * moduleSize,
        moduleSize,
        moduleSize,
      )
    }
  }

  return true
}

/**
 * 取 PNG 字节。
 *
 * 调用前必须确认 `renderQrToCanvas` 已返回 true —— jsdom 的 `toBlob` 存在但**永不回调**，
 * 直接调用会让 Promise 悬死。这里的 `typeof`/`throw`/`null` 三重判断是给真实浏览器
 * 留的安全网（`toBlob` 在某些实现里会失败或给出 `null`）。
 */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Result<Blob>> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(err(CANVAS_UNAVAILABLE, { code: 'CANVAS_UNAVAILABLE' }))
      return
    }

    try {
      canvas.toBlob((blob) => {
        resolve(
          blob === null ? err(PNG_UNAVAILABLE, { code: 'PNG_UNAVAILABLE' }) : ok(blob),
        )
      }, 'image/png')
    } catch (cause) {
      resolve(
        err(PNG_UNAVAILABLE, {
          code: 'PNG_UNAVAILABLE',
          detail: cause instanceof Error ? cause.message : String(cause),
        }),
      )
    }
  })
}
