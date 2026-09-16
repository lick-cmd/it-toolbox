import { describe, expect, it, vi } from 'vitest'
import { generateQrMatrix, resolveQrRenderOptions, type QrMatrix } from '@/core/image/qrcode'
import { CANVAS_UNAVAILABLE, canvasToPngBlob, PNG_UNAVAILABLE, renderQrToCanvas } from './canvas'

function mustMatrix(text: string): QrMatrix {
  const result = generateQrMatrix(text)
  if (!result.ok) throw new Error(`期望生成成功，实际失败：${result.error}`)
  return result.value
}

const RENDER = resolveQrRenderOptions({ moduleSize: 4, margin: 4 })

/** 假 canvas：用桩替掉 toBlob，让真实浏览器才会走到的分支也能断言 */
function fakeCanvas(toBlob?: unknown): HTMLCanvasElement {
  return (toBlob === undefined ? {} : { toBlob }) as unknown as HTMLCanvasElement
}

describe('renderQrToCanvas', () => {
  it('jsdom 拿不到 2D 上下文时返回 false 而不抛错', () => {
    // 实测 jsdom 的 getContext('2d') 返回 null；这里正是那条路径
    const canvas = document.createElement('canvas')
    expect(renderQrToCanvas(canvas, mustMatrix('hello'), RENDER)).toBe(false)
  })

  it('上下文可用时按矩阵绘制，尺寸等于 qrPixelSize', () => {
    const calls: { fillStyle: string; rect: number[] }[] = []
    let current = ''
    const context = {
      set fillStyle(value: string) {
        current = value
      },
      get fillStyle() {
        return current
      },
      fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
        calls.push({ fillStyle: current, rect: [x, y, w, h] })
      }),
    }
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
    } as unknown as HTMLCanvasElement

    const matrix = mustMatrix('hello')
    expect(renderQrToCanvas(canvas, matrix, RENDER)).toBe(true)

    const units = matrix.size + RENDER.margin * 2
    expect(canvas.width).toBe(units * RENDER.moduleSize)
    expect(canvas.height).toBe(units * RENDER.moduleSize)

    // 第一次填充是铺满整块的背景
    expect(calls[0]?.fillStyle).toBe('#ffffff')
    expect(calls[0]?.rect).toEqual([0, 0, canvas.width, canvas.height])

    // 之后每个暗模组一次，坐标都带静默区偏移，且不用再画亮模组
    const dark = calls.filter((call) => call.fillStyle === '#000000')
    expect(dark).toHaveLength(
      matrix.modules.flat().filter((cell) => cell).length,
    )
    expect(dark[0]?.rect).toEqual([
      RENDER.margin * RENDER.moduleSize,
      RENDER.margin * RENDER.moduleSize,
      RENDER.moduleSize,
      RENDER.moduleSize,
    ])
  })
})

describe('canvasToPngBlob', () => {
  it('toBlob 缺失时返回 CANVAS_UNAVAILABLE', async () => {
    const result = await canvasToPngBlob(fakeCanvas())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('CANVAS_UNAVAILABLE')
      expect(result.error).toBe(CANVAS_UNAVAILABLE)
    }
  })

  it('回调给出 null 时返回 PNG_UNAVAILABLE', async () => {
    const result = await canvasToPngBlob(fakeCanvas((callback: (blob: null) => void) => callback(null)))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('PNG_UNAVAILABLE')
      expect(result.error).toBe(PNG_UNAVAILABLE)
    }
  })

  it('toBlob 抛错时降级为 PNG_UNAVAILABLE 而不是把异常抛出 Result', async () => {
    const result = await canvasToPngBlob(
      fakeCanvas(() => {
        throw new Error('boom')
      }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('PNG_UNAVAILABLE')
      expect(result.detail).toContain('boom')
    }
  })

  it('成功时返回 PNG blob', async () => {
    const blob = new Blob(['x'], { type: 'image/png' })
    const result = await canvasToPngBlob(fakeCanvas((callback: (value: Blob) => void) => callback(blob)))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(blob)
  })
})
