import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  darkModuleCount,
  generateQrMatrix,
  isLowContrast,
  maxByteCapacity,
  normalizeHexColor,
  QR_CONTRAST_THRESHOLD,
  QR_DEFAULT_BACKGROUND,
  QR_DEFAULT_FOREGROUND,
  QR_EC_LEVELS,
  QR_MARGIN,
  QR_MAX_BYTE_CAPACITY,
  QR_MAX_VERSION,
  QR_MODULE_SIZE,
  qrByteLength,
  qrPixelSize,
  qrToSvg,
  relativeLuminance,
  resolveQrRenderOptions,
  type QrEcLevel,
  type QrMatrix,
} from './qrcode'

/* ------------------------------------------------------------------ *
 * 测试内独立解码器（**只支持 version 1**）
 *
 * spec 的两条 Scenario（中文内容、自定义颜色后仍可识别）说的都是
 * 「可被标准扫码器扫描还原」。本机实测没有任何二维码解码器可用
 * （zbarimg / qrencode / pyzbar / cv2 / python qrcode 全部不存在），
 * 因此「解码」这条证据链只能在测试内自建。
 *
 * 限定 version 1 的原因：v1 的四个纠错等级**都是单 RS 块**
 * （L=19 / M=16 / Q=13 / H=9 个数据码字），取出码字后不需要块结构表
 * 去交错，前若干码字就是数据流本身。多块符号需要整张 RS 块结构表，
 * 本计划不做 —— 所有解码用例都以 `expect(matrix.version).toBe(1)`
 * 把这条前提钉在明面上。
 * ------------------------------------------------------------------ */

/** v1（21×21）的功能图案：三个定位图案 + 分隔符 + 格式信息 + 时序图案 + 暗模组 */
function isReservedV1(row: number, col: number, size: number): boolean {
  if (row <= 8 && col <= 8) return true
  if (row <= 8 && col >= size - 8) return true
  if (row >= size - 8 && col <= 8) return true
  if (row === 6 || col === 6) return true
  return false
}

/** ISO/IEC 18004 的 8 种掩码条件；命中即需翻转 */
function maskCondition(mask: number, row: number, col: number): boolean {
  switch (mask) {
    case 0:
      return (row + col) % 2 === 0
    case 1:
      return row % 2 === 0
    case 2:
      return col % 3 === 0
    case 3:
      return (row + col) % 3 === 0
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0
    default:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0
  }
}

/** 反掩码 + 按锯齿序读出码字（每列一对，右列先于左列，高位先行） */
function readCodewords(matrix: QrMatrix): number[] {
  const { size, modules, maskPattern } = matrix
  const bits: number[] = []

  let upward = true
  for (let col = size - 1; col > 0; col -= 2) {
    // 竖向时序图案所在的第 6 列不参与，整条竖带左移一列
    if (col === 6) col = 5
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i
      for (const c of [col, col - 1]) {
        if (c < 0 || isReservedV1(row, c, size)) continue
        const dark = modules[row]?.[c] === true
        bits.push(dark !== maskCondition(maskPattern, row, c) ? 1 : 0)
      }
    }
    upward = !upward
  }

  const codewords: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ?? 0)
    codewords.push(byte)
  }
  return codewords
}

/** 从矩阵里真解出字节模式的文本；任何一步不符即抛错，让用例失败得可定位 */
function decodeByteModeText(matrix: QrMatrix): string {
  const codewords = readCodewords(matrix)

  // 4 位模式指示符：0100 = 字节模式
  const mode = (codewords[0] ?? 0) >> 4
  if (mode !== 0b0100) throw new Error(`期望字节模式（0100），实际 ${mode.toString(2).padStart(4, '0')}`)

  // v1–v9 的字节模式用 8 位字符计数
  const first = codewords[0] ?? 0
  const second = codewords[1] ?? 0
  const length = ((first & 0x0f) << 4) | (second >> 4)

  // 数据字节从第 2 个码字的低 4 位之后开始
  const bytes: number[] = []
  let bitIndex = 12
  for (let i = 0; i < length; i++) {
    let value = 0
    for (let j = 0; j < 8; j++) {
      const index = bitIndex + j
      const codeword = codewords[index >> 3] ?? 0
      value = (value << 1) | ((codeword >> (7 - (index & 7))) & 1)
    }
    bytes.push(value)
    bitIndex += 8
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/**
 * 读取某处 15 位格式信息（bit i = 第 i 个位置的模组）。
 *
 * 坐标是**实测反查**出来的，不是凭记忆写的：先用 BCH(15,5) + `XOR 0x5412`
 * 独立算出该符号应有的 15 位格式值，再逐个坐标比对矩阵里实际的值，
 * 找出唯一自洽的映射（两处副本都通过）。
 *
 * 记录这次弯路：参考实现的 `setFunctionModule(x, y)` 入参顺序是**先列后行**，
 * 照抄成 `(row, col)` 会让两处副本各错 6 位 —— 而「两处副本逐位一致」
 * 这条不变量正好把它抓了出来。
 */
function readFormatBits(matrix: QrMatrix, copy: 'a' | 'b'): number {
  const { size, modules } = matrix
  const at = (row: number, col: number) => (modules[row]?.[col] === true ? 1 : 0)

  const positions: [number, number][] = []
  for (let i = 0; i < 15; i++) {
    if (copy === 'a') {
      if (i <= 5) positions.push([i, 8])
      else if (i === 6) positions.push([7, 8])
      else if (i === 7) positions.push([8, 8])
      else if (i === 8) positions.push([8, 7])
      else positions.push([8, 14 - i])
    } else if (i < 8) {
      positions.push([8, size - 1 - i])
    } else {
      positions.push([size - 15 + i, 8])
    }
  }

  let value = 0
  for (let i = 0; i < 15; i++) {
    const [row, col] = positions[i] ?? [0, 0]
    value |= at(row, col) << i
  }
  return value
}

/** 格式信息里的 2 位纠错等级编码：L=01 / M=00 / Q=11 / H=10 */
const EC_FORMAT_BITS: Record<QrEcLevel, number> = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 }

/** 由格式信息反解出（纠错等级, 掩码）——只取高 5 位，BCH 部分不校验 */
function decodeFormat(value: number): { ecLevel: QrEcLevel; mask: number } {
  const data = ((value ^ 0x5412) >>> 10) & 0x1f
  const ecBits = (data >>> 3) & 0b11
  const mask = data & 0b111
  const entry = (Object.keys(EC_FORMAT_BITS) as QrEcLevel[]).find(
    (level) => EC_FORMAT_BITS[level] === ecBits,
  )
  if (entry === undefined) throw new Error(`无法识别的纠错等级编码 ${ecBits}`)
  return { ecLevel: entry, mask }
}

const FINDER =
  '1111111/1000001/1011101/1011101/1011101/1000001/1111111'

/** 取 7×7 区域，按 '#' 与 '.' 拼成可直接比对的字符串 */
function windowAt(matrix: QrMatrix, rowStart: number, colStart: number): string {
  const rows: string[] = []
  for (let r = 0; r < 7; r++) {
    let line = ''
    for (let c = 0; c < 7; c++) line += matrix.modules[rowStart + r]?.[colStart + c] === true ? '1' : '0'
    rows.push(line)
  }
  return rows.join('/')
}

const mustMatrix = (text: string, options?: Parameters<typeof generateQrMatrix>[1]): QrMatrix => {
  const result = generateQrMatrix(text, options)
  if (!result.ok) throw new Error(`期望生成成功，实际失败：${result.error}`)
  return result.value
}

const DEFAULT_RENDER = resolveQrRenderOptions()

describe('generateQrMatrix —— 默认参数与结构', () => {
  it('默认纠错等级为 M，尺寸与版本自洽', () => {
    const matrix = mustMatrix('hello')
    expect(matrix.ecLevel).toBe('M')
    expect(matrix.version).toBeGreaterThanOrEqual(1)
    expect(matrix.size).toBe(4 * matrix.version + 17)
    expect(matrix.modules).toHaveLength(matrix.size)
    for (const line of matrix.modules) expect(line).toHaveLength(matrix.size)
  })

  it('掩码在 0..7 之间', () => {
    const matrix = mustMatrix('hello')
    expect(matrix.maskPattern).toBeGreaterThanOrEqual(0)
    expect(matrix.maskPattern).toBeLessThanOrEqual(7)
  })

  it('可指定纠错等级', () => {
    expect(mustMatrix('hello', { ecLevel: 'H' }).ecLevel).toBe('H')
    expect(mustMatrix('hello', { ecLevel: 'L' }).ecLevel).toBe('L')
  })

  it('默认渲染选项为黑前景、白背景、模组 4、静默区 4', () => {
    expect(DEFAULT_RENDER).toEqual({
      moduleSize: 4,
      margin: 4,
      foreground: '#000000',
      background: '#ffffff',
    })
    expect(QR_DEFAULT_FOREGROUND).toBe('#000000')
    expect(QR_DEFAULT_BACKGROUND).toBe('#ffffff')
  })

  it('darkModuleCount 与逐格统计一致', () => {
    const matrix = mustMatrix('hello')
    let manual = 0
    for (const line of matrix.modules) for (const cell of line) if (cell) manual++
    expect(darkModuleCount(matrix)).toBe(manual)
    expect(manual).toBeGreaterThan(0)
  })
})

describe('矩阵方向 —— 三个定位图案', () => {
  it('左上、右上、左下都是标准定位图案', () => {
    const matrix = mustMatrix('hello')
    expect(windowAt(matrix, 0, 0)).toBe(FINDER)
    expect(windowAt(matrix, 0, matrix.size - 7)).toBe(FINDER)
    expect(windowAt(matrix, matrix.size - 7, 0)).toBe(FINDER)
  })

  it('右下角不是定位图案（转置或翻转会被这条打挂）', () => {
    const matrix = mustMatrix('hello')
    expect(windowAt(matrix, matrix.size - 7, matrix.size - 7)).not.toBe(FINDER)
  })

  it('时序图案在第 6 行与第 6 列交替', () => {
    const matrix = mustMatrix('hello')
    const row = [8, 9, 10, 11, 12].map((col) => (matrix.modules[6]?.[col] === true ? 1 : 0))
    const col = [8, 9, 10, 11, 12].map((r) => (matrix.modules[r]?.[6] === true ? 1 : 0))
    expect(row).toEqual([1, 0, 1, 0, 1])
    expect(col).toEqual([1, 0, 1, 0, 1])
  })

  it('暗模组位于 (4 * version + 9, 8)', () => {
    const matrix = mustMatrix('hello')
    expect(matrix.modules[4 * matrix.version + 9]?.[8]).toBe(true)
  })
})

describe('格式信息自洽', () => {
  it('两处副本逐位一致', () => {
    const matrix = mustMatrix('hello', { ecLevel: 'Q' })
    expect(readFormatBits(matrix, 'a')).toBe(readFormatBits(matrix, 'b'))
  })

  it('格式信息里编码的纠错等级与掩码同实际一致', () => {
    for (const ecLevel of ['L', 'M', 'Q', 'H'] as QrEcLevel[]) {
      const matrix = mustMatrix('hello', { ecLevel })
      const decoded = decodeFormat(readFormatBits(matrix, 'a'))
      expect(decoded.ecLevel).toBe(ecLevel)
      expect(decoded.mask).toBe(matrix.maskPattern)
    }
  })
})

describe('中文与 emoji 真往返（测试内解码器）', () => {
  it('qrByteLength 按 UTF-8 字节计，而非 UTF-16 码元', () => {
    expect(qrByteLength('hello')).toBe(5)
    expect(qrByteLength('中')).toBe(3)
    expect(qrByteLength('中文')).toBe(6)
    expect(qrByteLength('🚀')).toBe(4)
    expect(qrByteLength('')).toBe(0)
    // '🚀'.length === 2，按码元会算成 4 字节的一半，属典型错误
    expect('🚀'.length).not.toBe(qrByteLength('🚀'))
  })

  it('短文本解回来与原文逐字相同', () => {
    for (const text of ['中', '中文', 'hello', '🚀', '中文 abc']) {
      const matrix = mustMatrix(text)
      expect(matrix.version).toBe(1) // 解码器的前提：单块符号
      expect(decodeByteModeText(matrix)).toBe(text)
    }
  })

  it('emoji 与中文混排也能逐字还原', () => {
    const text = '中文🚀'
    const matrix = mustMatrix(text)
    expect(matrix.version).toBe(1)
    expect(decodeByteModeText(matrix)).toBe(text)
  })
})

describe('容量上限', () => {
  it('容量表与设计决策逐字一致', () => {
    expect(QR_MAX_BYTE_CAPACITY).toEqual({ L: 2953, M: 2331, Q: 1663, H: 1273 })
    expect(maxByteCapacity('L')).toBe(2953)
    expect(maxByteCapacity('H')).toBe(1273)
  })

  it('恰好达到上限时成功且为 version 40，超出 1 字节即报容量错误', () => {
    for (const ecLevel of ['L', 'M', 'Q', 'H'] as QrEcLevel[]) {
      const capacity = maxByteCapacity(ecLevel)

      const ok = generateQrMatrix('a'.repeat(capacity), { ecLevel })
      expect(ok.ok).toBe(true)
      if (ok.ok) expect(ok.value.version).toBe(QR_MAX_VERSION)

      const tooLong = generateQrMatrix('a'.repeat(capacity + 1), { ecLevel })
      expect(tooLong.ok).toBe(false)
      if (!tooLong.ok) {
        expect(tooLong.code).toBe('TOO_LONG')
        expect(tooLong.detail).toContain(String(capacity + 1))
        expect(tooLong.detail).toContain(String(capacity))
        expect(tooLong.detail).toContain(ecLevel)
        expect(tooLong.suggestion).toBeTruthy()
      }
    }
  })

  it('容量错误会给出容量更大的等级建议', () => {
    const result = generateQrMatrix('中'.repeat(425), { ecLevel: 'H' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.suggestion).toContain('L')
  })

  it('中文按 3 字节计：H 等级 424 个汉字可生成，425 个超出', () => {
    expect(generateQrMatrix('中'.repeat(424), { ecLevel: 'H' }).ok).toBe(true)

    const tooLong = generateQrMatrix('中'.repeat(425), { ecLevel: 'H' })
    expect(tooLong.ok).toBe(false)
    if (!tooLong.ok) expect(tooLong.code).toBe('TOO_LONG')
  })
})

describe('空输入', () => {
  it('空串返回 EMPTY_INPUT', () => {
    const result = generateQrMatrix('')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('EMPTY_INPUT')
  })

  it('单个空格是合法内容（空态判定属界面职责）', () => {
    expect(generateQrMatrix(' ').ok).toBe(true)
  })
})

describe('模块尺寸与纠错等级', () => {
  it('模块尺寸只改分辨率，不改编码内容', () => {
    const matrix = mustMatrix('hello')
    const small = qrToSvg(matrix, { ...DEFAULT_RENDER, moduleSize: 2 })
    const large = qrToSvg(matrix, { ...DEFAULT_RENDER, moduleSize: 8 })

    const units = matrix.size + DEFAULT_RENDER.margin * 2
    expect(small).toContain(`width="${units * 2}"`)
    expect(large).toContain(`width="${units * 8}"`)
    expect(small).toContain(`viewBox="0 0 ${units} ${units}"`)
    expect(large).toContain(`viewBox="0 0 ${units} ${units}"`)
    // 路径完全一致 ⇒ 编码内容没被分辨率影响
    expect(small.slice(small.indexOf('<path'))).toBe(large.slice(large.indexOf('<path')))
  })

  it('qrPixelSize 等于 (模组数 + 2 × 静默区) × 模块尺寸', () => {
    const matrix = mustMatrix('hello')
    expect(qrPixelSize(matrix, DEFAULT_RENDER)).toBe((matrix.size + 8) * 4)
  })

  it('纠错等级提高不会减少模组数，且 H 严格多于 L', () => {
    const text = 'a'.repeat(120)
    const versions = (['L', 'M', 'Q', 'H'] as QrEcLevel[]).map(
      (ecLevel) => mustMatrix(text, { ecLevel }).version,
    )
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i] ?? 0).toBeGreaterThanOrEqual(versions[i - 1] ?? 0)
    }
    const [l = 0, , , h = 0] = versions
    expect(h).toBeGreaterThan(l)
  })
})

describe('SVG 输出', () => {
  it('具备矢量与尺寸契约', () => {
    const matrix = mustMatrix('hello')
    const units = matrix.size + DEFAULT_RENDER.margin * 2
    const svg = qrToSvg(matrix, DEFAULT_RENDER)

    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).toContain('shape-rendering="crispEdges"')
    expect(svg).toContain('role="img"')
    expect(svg).toContain(`viewBox="0 0 ${units} ${units}"`)
    expect(svg).toContain(`width="${units * DEFAULT_RENDER.moduleSize}"`)
    expect(svg).toContain(`height="${units * DEFAULT_RENDER.moduleSize}"`)
  })

  it('背景矩形覆盖整个画布（含静默区）', () => {
    const matrix = mustMatrix('hello')
    const units = matrix.size + DEFAULT_RENDER.margin * 2
    const svg = qrToSvg(matrix, DEFAULT_RENDER)
    expect(svg).toMatch(
      new RegExp(`<rect width="${units}" height="${units}" fill="#ffffff"/>`),
    )
  })

  it('静默区通过路径偏移体现', () => {
    const matrix = mustMatrix('hello')
    const withMargin = qrToSvg(matrix, { ...DEFAULT_RENDER, margin: 4 })
    const without = qrToSvg(matrix, { ...DEFAULT_RENDER, margin: 0 })
    expect(withMargin).toContain('<path d="M4 4h')
    expect(without).toContain('<path d="M0 0h')
  })

  it('不含任何可执行内容', () => {
    const svg = qrToSvg(mustMatrix('<script>alert(1)</script>'), DEFAULT_RENDER)
    expect(svg).not.toContain('<script')
    expect(svg).not.toContain('onload')
    expect(svg).not.toContain('javascript:')
  })
})

describe('颜色选项', () => {
  it('自定义前景色与背景色如实进入 SVG', () => {
    const matrix = mustMatrix('hello')
    const svg = qrToSvg(matrix, {
      ...DEFAULT_RENDER,
      foreground: '#1565c0',
      background: '#fffde7',
    })
    expect(svg).toMatch(/<rect[^>]*fill="#fffde7"/)
    expect(svg).toMatch(/<path[^>]*fill="#1565c0"/)
  })

  it('大写颜色被归一化为小写', () => {
    expect(resolveQrRenderOptions({ foreground: '#1565C0' }).foreground).toBe('#1565c0')
  })

  it('非法颜色回落到默认色（这是 SVG 的唯一注入面）', () => {
    const render = resolveQrRenderOptions({ foreground: 'red', background: '#12345' })
    expect(render.foreground).toBe(QR_DEFAULT_FOREGROUND)
    expect(render.background).toBe(QR_DEFAULT_BACKGROUND)

    const matrix = mustMatrix('hello')
    const svg = qrToSvg(matrix, render)
    expect(svg).not.toContain('red')
    expect(svg).toContain('fill="#000000"')
  })
})

describe('normalizeHexColor', () => {
  it('接受 3 位与 6 位十六进制', () => {
    expect(normalizeHexColor('#FFF')).toBe('#ffffff')
    expect(normalizeHexColor('#1565C0')).toBe('#1565c0')
    expect(normalizeHexColor('  #abcdef  ')).toBe('#abcdef')
  })

  it('拒绝其余一切写法', () => {
    for (const bad of ['red', '#12345', '#gggggg', '', '#', 'rgb(1,2,3)', '#1234567']) {
      expect(normalizeHexColor(bad)).toBeNull()
    }
  })
})

describe('对比度（WCAG 相对亮度）', () => {
  it('相对亮度边界', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10)
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 10)
  })

  it('黑白对比度为 21', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 6)
  })

  it('spec 举的配色（深蓝 / 米白）在阈值之上', () => {
    expect(contrastRatio('#1565c0', '#fffde7')).toBeCloseTo(5.5975, 3)
    expect(isLowContrast('#1565c0', '#fffde7')).toBe(false)
  })

  it('近似同色判为对比度不足', () => {
    expect(isLowContrast('#ffffff', '#fffffe')).toBe(true)
    expect(isLowContrast('#cccccc', '#ffffff')).toBe(true)
  })

  it('阈值上方不告警', () => {
    // 3.5449，刚好高于默认阈值 3
    expect(contrastRatio('#888888', '#ffffff')).toBeCloseTo(3.5449, 3)
    expect(isLowContrast('#888888', '#ffffff')).toBe(false)
    expect(isLowContrast('#888888', '#ffffff', 4)).toBe(true)
  })

  it('默认阈值是 3', () => {
    expect(QR_CONTRAST_THRESHOLD).toBe(3)
  })
})

describe('选项归一化', () => {
  it('模块尺寸 clamp 到 [1, 16] 并向下取整', () => {
    expect(resolveQrRenderOptions({ moduleSize: 0 }).moduleSize).toBe(QR_MODULE_SIZE.min)
    expect(resolveQrRenderOptions({ moduleSize: 99 }).moduleSize).toBe(QR_MODULE_SIZE.max)
    expect(resolveQrRenderOptions({ moduleSize: 2.7 }).moduleSize).toBe(2)
  })

  it('静默区 clamp 到 [0, 16]', () => {
    expect(resolveQrRenderOptions({ margin: -1 }).margin).toBe(0)
    expect(resolveQrRenderOptions({ margin: 99 }).margin).toBe(QR_MARGIN.max)
  })

  it('非有限数回落默认值', () => {
    expect(resolveQrRenderOptions({ moduleSize: Number.NaN }).moduleSize).toBe(4)
    expect(resolveQrRenderOptions({ margin: Number.POSITIVE_INFINITY }).margin).toBe(4)
  })
})

describe('纠错等级常量', () => {
  it('四个等级齐全且都带说明', () => {
    expect(QR_EC_LEVELS.map((item) => item.value)).toEqual(['L', 'M', 'Q', 'H'])
    for (const item of QR_EC_LEVELS) {
      expect(item.label).toBe(item.value)
      expect(item.hint.length).toBeGreaterThan(0)
    }
  })

  it('容量随纠错等级提高而下降', () => {
    const capacities = QR_EC_LEVELS.map((item) => maxByteCapacity(item.value))
    for (let i = 1; i < capacities.length; i++) {
      expect(capacities[i] ?? 0).toBeLessThan(capacities[i - 1] ?? 0)
    }
  })
})
