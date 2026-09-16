import { create } from 'qrcode'
import { utf8ByteLength, utf8ToBytes } from '../bytes'
import { err, ok } from '../result'
import type { Result } from '../result'

/**
 * 二维码矩阵与 SVG 生成。
 *
 * **Core 不碰 DOM**（设计文档 `:208`）：这里只产出模组矩阵与 SVG 字符串，
 * Canvas 渲染完全留在工具层。这样这一层可以在 Node 环境的 Vitest 里全量断言，
 * 而 jsdom 根本没有 2D 上下文（实测 `getContext('2d')` 返回 `null`）。
 *
 * 编码引擎用既有的 `qrcode@1.5.4` 依赖，而不是自己写 Reed-Solomon 与掩码评分 ——
 * 那不是本项目的价值所在，且自行实现会引入一整张 RS 块结构表的转录风险。
 */

export type QrEcLevel = 'L' | 'M' | 'Q' | 'H'

export interface QrEcLevelOption {
  value: QrEcLevel
  label: string
  hint: string
}

export const QR_EC_LEVELS: readonly QrEcLevelOption[] = [
  { value: 'L', label: 'L', hint: '约可纠错 7% 的码字，容量最大' },
  { value: 'M', label: 'M', hint: '约可纠错 15% 的码字，日常推荐' },
  { value: 'Q', label: 'Q', hint: '约可纠错 25% 的码字' },
  { value: 'H', label: 'H', hint: '约可纠错 30% 的码字，最抗污损、容量最小' },
]

/**
 * 各纠错等级在 **version 40 + 字节模式** 下的容量（字节）。
 *
 * 硬编码而非现场二分试探（设计文档 `:209`）：这组数字是标准的固定值，
 * 而且「当前等级最大可容纳长度」这句提示必须立刻给得出。
 * `qrcode.test.ts` 用「恰好 N 字节成功、N+1 字节失败」逐等级钉住它。
 */
export const QR_MAX_BYTE_CAPACITY: Record<QrEcLevel, number> = {
  L: 2953,
  M: 2331,
  Q: 1663,
  H: 1273,
}

export const QR_MAX_VERSION = 40

export const QR_MODULE_SIZE = { min: 1, max: 16, default: 4 } as const

/** 静默区宽度，单位是模组（不是像素） */
export const QR_MARGIN = { min: 0, max: 16, default: 4 } as const

export const QR_DEFAULT_FOREGROUND = '#000000'
export const QR_DEFAULT_BACKGROUND = '#ffffff'

/** WCAG 对非文本内容的最小对比度要求是 3:1 */
export const QR_CONTRAST_THRESHOLD = 3

/** 等级由弱到强，容量由大到小 */
const EC_ORDER: readonly QrEcLevel[] = ['L', 'M', 'Q', 'H']

export interface QrOptions {
  ecLevel?: QrEcLevel
  moduleSize?: number
  margin?: number
  foreground?: string
  background?: string
}

export interface QrMatrix {
  /** 边长，单位是模组 */
  size: number
  version: number
  ecLevel: QrEcLevel
  maskPattern: number
  /** 行优先：`modules[row][col]`，`true` 表示暗模组 */
  modules: boolean[][]
}

export interface QrRenderOptions {
  moduleSize: number
  margin: number
  foreground: string
  background: string
}

export function maxByteCapacity(ecLevel: QrEcLevel): number {
  return QR_MAX_BYTE_CAPACITY[ecLevel]
}

/** 内容按 UTF-8 计长 —— 二维码字节模式装的是字节，不是字符 */
export function qrByteLength(text: string): number {
  return utf8ByteLength(text)
}

const HEX3 = /^#([0-9a-fA-F]{3})$/
const HEX6 = /^#([0-9a-fA-F]{6})$/

/**
 * 颜色归一化为小写 `#rrggbb`，无法识别返回 `null`。
 *
 * **这是进入 SVG 的唯一颜色入口**，也是整个模块唯一的注入面：
 * 颜色串最终会被拼进 `fill="…"`。只要这里只放过 `^#[0-9a-f]{6}$`，
 * 上层传什么都进不到 SVG 里。
 */
export function normalizeHexColor(input: string): string | null {
  const value = input.trim()

  const six = HEX6.exec(value)
  const sixBody = six?.[1]
  if (sixBody !== undefined) return `#${sixBody.toLowerCase()}`

  const three = HEX3.exec(value)
  const threeBody = three?.[1]
  if (threeBody !== undefined) {
    const expanded = threeBody
      .split('')
      .map((char) => char + char)
      .join('')
    return `#${expanded.toLowerCase()}`
  }

  return null
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.floor(value)))
}

/**
 * 把用户选项归一化成一份确定的渲染参数。
 *
 * 一次归一化、多处复用（SVG 与 Canvas 都用它），
 * 「导出的内容与预览一致」才由构造保证，而不是靠两处各写一遍默认值。
 */
export function resolveQrRenderOptions(options: QrOptions = {}): QrRenderOptions {
  return {
    moduleSize: clampInt(
      options.moduleSize,
      QR_MODULE_SIZE.min,
      QR_MODULE_SIZE.max,
      QR_MODULE_SIZE.default,
    ),
    margin: clampInt(options.margin, QR_MARGIN.min, QR_MARGIN.max, QR_MARGIN.default),
    foreground: normalizeHexColor(options.foreground ?? '') ?? QR_DEFAULT_FOREGROUND,
    background: normalizeHexColor(options.background ?? '') ?? QR_DEFAULT_BACKGROUND,
  }
}

/**
 * 生成模组矩阵。
 *
 * **强制字节模式**：`qrcode` 默认会按内容自动挑数字 / 字母数字模式
 * （纯数字在 v40-L 下能装 7089 位，远超字节模式的 2953 字节），
 * 那样「当前等级最大可容纳长度」就只能给一个含糊的近似值。
 * 固定成字节模式后，容量上限与 `QR_MAX_BYTE_CAPACITY` 精确相等，
 * 提示语永远准确。代价是约三千位纯数字会被拒 —— 已记录为有意取舍。
 */
export function generateQrMatrix(text: string, options: QrOptions = {}): Result<QrMatrix> {
  if (text.length === 0) {
    return err('请输入要生成二维码的内容', { code: 'EMPTY_INPUT' })
  }

  const ecLevel = options.ecLevel ?? 'M'
  const bytes = qrByteLength(text)
  const capacity = maxByteCapacity(ecLevel)

  if (bytes > capacity) {
    const roomier = EC_ORDER.slice(0, EC_ORDER.indexOf(ecLevel))
    return err('内容超出该纠错等级的容量上限', {
      code: 'TOO_LONG',
      detail: `当前内容 ${bytes} 字节（UTF-8），纠错等级 ${ecLevel} 最多可容纳 ${capacity} 字节`,
      suggestion:
        roomier.length > 0
          ? `请缩短内容，或改用容量更大的纠错等级 ${roomier.join(' / ')}`
          : '请缩短内容',
    })
  }

  try {
    // 显式传 UTF-8 字节：`qrcode` 对字符串也会自行 `TextEncoder().encode`，
    // 但类型定义只接受字节序列，且「容量按 UTF-8 字节算」在这里被写下一次
    const created = create([{ data: utf8ToBytes(text), mode: 'byte' }], {
      errorCorrectionLevel: ecLevel,
    })
    const size = created.modules.size

    const modules: boolean[][] = []
    for (let row = 0; row < size; row++) {
      const line: boolean[] = []
      for (let col = 0; col < size; col++) line.push(created.modules.get(row, col) === 1)
      modules.push(line)
    }

    return ok({
      size,
      version: created.version,
      ecLevel,
      maskPattern: created.maskPattern ?? 0,
      modules,
    })
  } catch (cause) {
    // 上面已有精确的容量预检，这条是安全网：编码器自身失败时也不能把异常抛出 Result
    return err('生成二维码失败', {
      code: 'QR_FAILED',
      detail: cause instanceof Error ? cause.message : String(cause),
      suggestion: '请尝试缩短内容或更换纠错等级',
    })
  }
}

/** (模组数 + 2 × 静默区) × 模块尺寸 —— SVG 的 width/height 与 Canvas 的像素尺寸共用 */
export function qrPixelSize(matrix: QrMatrix, render: QrRenderOptions): number {
  return (matrix.size + render.margin * 2) * render.moduleSize
}

export function darkModuleCount(matrix: QrMatrix): number {
  let count = 0
  for (const line of matrix.modules) {
    for (const cell of line) if (cell) count++
  }
  return count
}

/**
 * 生成 SVG 字符串。
 *
 * 三点设计：
 *
 * 1. **自己拼，不用 `qrcode.toString`** —— 那个 API 不传回调时返回 Promise，
 *    会让这一层变异步，而 Core 必须是同步纯函数才好断言。
 * 2. **`viewBox` 用模组单位、`width`/`height` 用像素** —— 因此矢量无损缩放，
 *    而导出尺寸严格等于 `qrPixelSize`。
 * 3. **行内游程合并**（`h{run}` 而不是逐格 `h1`）—— version 40 有近 1.5 万个暗模组，
 *    逐格输出会得到约 300KB 的 `d`，合并后小一个数量级。
 */
export function qrToSvg(matrix: QrMatrix, render: QrRenderOptions): string {
  const units = matrix.size + render.margin * 2
  const pixels = units * render.moduleSize

  const commands: string[] = []
  for (let row = 0; row < matrix.size; row++) {
    const line = matrix.modules[row]
    if (line === undefined) continue

    let col = 0
    while (col < matrix.size) {
      if (line[col] !== true) {
        col++
        continue
      }
      let run = 1
      while (col + run < matrix.size && line[col + run] === true) run++

      commands.push(`M${col + render.margin} ${row + render.margin}h${run}v1h-${run}z`)
      col += run
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}"`,
    ` viewBox="0 0 ${units} ${units}" shape-rendering="crispEdges"`,
    ` role="img" aria-label="二维码">`,
    `<rect width="${units}" height="${units}" fill="${render.background}"/>`,
    `<path d="${commands.join('')}" fill="${render.foreground}"/>`,
    `</svg>`,
  ].join('')
}

/** WCAG 2.x 相对亮度 */
export function relativeLuminance(color: string): number {
  const hex = normalizeHexColor(color)
  if (hex === null) return 0

  const channels: number[] = []
  for (const offset of [1, 3, 5]) {
    channels.push(Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
  }

  const [r = 0, g = 0, b = 0] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  )

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 对比度比值，范围 1（同色）到 21（纯黑对纯白） */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a)
  const second = relativeLuminance(b)
  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

export function isLowContrast(
  foreground: string,
  background: string,
  threshold: number = QR_CONTRAST_THRESHOLD,
): boolean {
  return contrastRatio(foreground, background) < threshold
}
