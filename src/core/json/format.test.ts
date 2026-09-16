import { describe, expect, it } from 'vitest'
import { formatJson } from './format'
import { minifyJson } from './minify'

const out = (text: string, options?: Parameters<typeof formatJson>[1]): string => {
  const r = formatJson(text, options)
  if (!r.ok) throw new Error(`意外失败：${r.error}`)
  return r.value.output
}

describe('formatJson — 缩进', () => {
  it('默认两空格缩进', () => {
    expect(out('{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}')
  })

  it('四空格缩进', () => {
    expect(out('{"a":1}', { indent: 4 })).toBe('{\n    "a": 1\n}')
  })

  it('制表符缩进', () => {
    expect(out('{"a":1}', { indent: 'tab' })).toBe('{\n\t"a": 1\n}')
  })

  it('空对象与空数组保持紧凑', () => {
    expect(out('{"a":{},"b":[]}')).toBe('{\n  "a": {},\n  "b": []\n}')
  })

  it('冒号后恰好一个空格', () => {
    expect(out('{"a":   1}')).toBe('{\n  "a": 1\n}')
  })

  it('嵌套深度正确递进', () => {
    expect(out('{"a":{"b":{"c":1}}}')).toBe(
      '{\n  "a": {\n    "b": {\n      "c": 1\n    }\n  }\n}',
    )
  })
})

describe('formatJson — 转义保真', () => {
  it('默认模式下不改写转义字面量', () => {
    const r = formatJson(String.raw`{"s":"\u0041\/\n"}`)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.output).toContain(String.raw`"\u0041\/\n"`)
      expect(r.value.normalizedEscapes).toBe(false)
    }
  })

  it('逐字节往返：minify(format(x)) 等于 minify(x)', () => {
    const samples = [
      String.raw`{"s":"\u0041\/\n","n":-1.5e-3,"t":true,"z":null}`,
      '{"a":[{"b":[]},{"c":{}}],"d":""}',
      '[1,2,3]',
      '{"中文键":"中文值 🧰"}',
    ]
    for (const sample of samples) {
      const formatted = formatJson(sample)
      expect(formatted.ok).toBe(true)
      if (!formatted.ok) continue

      const remade = minifyJson(formatted.value.output)
      const direct = minifyJson(sample)
      expect(remade.ok && direct.ok).toBe(true)
      if (remade.ok && direct.ok) {
        expect(remade.value.output).toBe(direct.value.output)
      }
    }
  })
})

describe('formatJson — 键排序', () => {
  it('对象键按字典序排列，数组顺序不变', () => {
    expect(out('{"c":1,"a":2,"b":3}', { sortKeys: true })).toBe(
      '{\n  "a": 2,\n  "b": 3,\n  "c": 1\n}',
    )
    expect(out('[3,1,2]', { sortKeys: true })).toBe('[\n  3,\n  1,\n  2\n]')
  })

  it('递归排序嵌套对象', () => {
    expect(out('{"z":{"b":1,"a":2}}', { sortKeys: true })).toBe(
      '{\n  "z": {\n    "a": 2,\n    "b": 1\n  }\n}',
    )
  })

  it('标记转义可能被规范化，供界面提示', () => {
    const r = formatJson(String.raw`{"s":"\u0041"}`, { sortKeys: true })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.normalizedEscapes).toBe(true)
      expect(r.value.output).toContain('"A"')
    }
  })
})

describe('formatJson — 错误透传', () => {
  it('非法输入保留错误码与三定位', () => {
    const r = formatJson('{\n  "a": 1,\n}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('TRAILING_COMMA')
      expect(r.line).toBe(3)
      expect(r.column).toBe(1)
    }
  })
})

describe('转义与 Unicode 选项', () => {
  const SRC = '{"a":"\\/","b":"\\u0041","c":"中","d":"\\u4e2d"}'

  const DEFAULT_OUTPUT = '{\n  "a": "\\/",\n  "b": "\\u0041",\n  "c": "中",\n  "d": "\\u4e2d"\n}'
  const NORMALIZED = '{\n  "a": "/",\n  "b": "A",\n  "c": "中",\n  "d": "\\u4e2d"\n}'
  const ESCAPED = '{\n  "a": "\\/",\n  "b": "\\u0041",\n  "c": "\\u4e2d",\n  "d": "\\u4e2d"\n}'
  const BOTH = '{\n  "a": "/",\n  "b": "A",\n  "c": "\\u4e2d",\n  "d": "\\u4e2d"\n}'

  function outputOf(options: Parameters<typeof formatJson>[1]): string {
    const result = formatJson(SRC, options)
    if (!result.ok) throw new Error(`期望成功，实际失败：${result.error}`)
    return result.value.output
  }

  it('缺省即保留转义原样（零回归）', () => {
    expect(outputOf({ indent: 2 })).toBe(DEFAULT_OUTPUT)

    const result = formatJson(SRC, { indent: 2 })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.normalizedEscapes).toBe(false)
  })

  it('keepEscapes: false 规范化 ASCII 转义，但不碰非 ASCII', () => {
    expect(outputOf({ indent: 2, keepEscapes: false })).toBe(NORMALIZED)
  })

  it('unicode: escape 只动非 ASCII', () => {
    expect(outputOf({ indent: 2, unicode: 'escape' })).toBe(ESCAPED)
  })

  it('两者同开', () => {
    expect(outputOf({ indent: 2, keepEscapes: false, unicode: 'escape' })).toBe(BOTH)
  })

  it('unicode: unescape 还原非 ASCII 转义', () => {
    const result = formatJson('{"c":"\\u4e2d"}', { indent: 2, unicode: 'unescape' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.output).toBe('{\n  "c": "中"\n}')
  })

  it('键排序路径与逐 token 路径在开 unicode 后风格一致', () => {
    expect(outputOf({ sortKeys: true, unicode: 'escape' })).toBe(BOTH)
  })

  it('发生转义改写时 normalizedEscapes 为 true', () => {
    const result = formatJson(SRC, { indent: 2, keepEscapes: false })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.normalizedEscapes).toBe(true)
  })

  it('输出仍是合法 JSON', () => {
    const result = formatJson('{"a":"\\/","c":"中"}', {
      indent: 2,
      keepEscapes: false,
      unicode: 'escape',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(() => JSON.parse(result.value.output)).not.toThrow()
  })
})
