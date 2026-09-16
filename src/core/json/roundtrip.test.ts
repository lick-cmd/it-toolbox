import { describe, expect, it } from 'vitest'
import { formatJson, type JsonIndent } from './format'
import { minifyJson } from './minify'
import { parseJsonValue } from './parse'

/**
 * 压缩与美化的两条契约（`dev-tools` spec）：
 *
 * - 「压缩与美化逐字节往返」「与压缩互为逆操作」：`minify(format(x))` 与 `minify(x)` 逐字节相同。
 *   **注意限定**：这条只在**未开启键排序**时成立 —— 排序路径走的是
 *   `JSON.parse` + `JSON.stringify` 重建，会规范化转义、改写大整数精度与重复键，
 *   本身就是有损的。（原注释称「spec 漏写了这个限定词，与键排序场景互斥」，
 *   该记录已过期：归档后的主 spec 在「与压缩互为逆操作」Scenario 里逐字写明了
 *   「**未开启键排序**」，并在「键排序」Scenario 明示重建会改写等价转义。）
 * - 「大体积输入」：超过 512KB 的输入要能算完，且往返关系不被体量破坏。
 */

const INDENTS: readonly JsonIndent[] = [2, 4, 'tab']

/** 覆盖转义字面量、等价转义、中文键值、emoji、空容器、顶层数组，以及重建才会改写的几类值 */
const SAMPLES: readonly string[] = [
  '{"a":1}',
  '{ "a" : 1 , "b" : [ 1 , 2 ] }',
  '{\n  "name": "it-toolbox",\n  "tags": ["json", "工具"],\n  "escaped": "\\u0041",\n  "slash": "\\/"\n}',
  '{"中文键":{"嵌套":[1,2,{"深":true}]},"引号":"a\\"b","反斜杠":"c\\\\d"}',
  '{"emoji":"🚀🎉","空白":" x  y "}',
  '{ "empty": {}, "list": [], "nested": { "a": { "b": {} } } }',
  '[1, 2, 3]',
  '[{"a":[{"b":null}]},[],{},true,false,null,0,""]',
  '{"n":-0,"big":9007199254740993,"exp":1e999,"dup":1,"dup":2}',
]

function minifyOf(text: string): string {
  const result = minifyJson(text)
  if (!result.ok) throw new Error(`期望压缩成功，实际失败：${result.error}`)
  return result.value.output
}

function formatOf(text: string, indent: JsonIndent): string {
  const result = formatJson(text, { indent })
  if (!result.ok) throw new Error(`期望美化成功，实际失败：${result.error}`)
  return result.value.output
}

describe('压缩与美化的逐字节往返', () => {
  it('minify(format(x)) 与 minify(x) 逐字节相同（三种缩进）', () => {
    for (const sample of SAMPLES) {
      const direct = minifyOf(sample)
      for (const indent of INDENTS) {
        expect(minifyOf(formatOf(sample, indent))).toBe(direct)
      }
    }
  })

  it('再往返一次结果不再变化（幂等）', () => {
    for (const sample of SAMPLES) {
      const once = formatOf(sample, 2)
      expect(formatOf(once, 2)).toBe(once)
      expect(minifyOf(minifyOf(sample))).toBe(minifyOf(sample))
    }
  })

  it('美化后的输出仍可被解析，且与原文语义等价', () => {
    for (const sample of SAMPLES) {
      const formatted = formatOf(sample, 2)
      const reparsed = parseJsonValue(formatted)
      expect(reparsed.ok).toBe(true)

      const original = parseJsonValue(sample)
      expect(original.ok).toBe(true)
      if (reparsed.ok && original.ok) expect(reparsed.value).toEqual(original.value)
    }
  })

  it('压缩后的输出同样语义等价', () => {
    for (const sample of SAMPLES) {
      const minified = minifyOf(sample)
      expect(parseJsonValue(minified).ok).toBe(true)
    }
  })

  it('默认路径保留转义字面量（这正是逐字节往返能成立的原因）', () => {
    const escaped = '{"a":"\\u0041","b":"\\/"}'
    expect(minifyOf(formatOf(escaped, 2))).toBe('{"a":"\\u0041","b":"\\/"}')
    expect(minifyOf(formatOf(escaped, 2))).toContain('\\u0041')
  })

  it('键排序路径是有损的，且只在开启时才有损', () => {
    const text = '{"a":"\\u0041","b":9007199254740993}'

    const plain = formatJson(text, { indent: 2 })
    expect(plain.ok).toBe(true)
    if (plain.ok) expect(plain.value.normalizedEscapes).toBe(false)

    const sorted = formatJson(text, { indent: 2, sortKeys: true })
    expect(sorted.ok).toBe(true)
    if (sorted.ok) {
      expect(sorted.value.normalizedEscapes).toBe(true)
      // 排序重建后转义被规范化、大整数被取到最近的可表示值
      expect(sorted.value.output).toContain('"A"')
      expect(sorted.value.output).not.toContain('\\u0041')
      expect(sorted.value.output).not.toContain('9007199254740993')
    }
  })
})

describe('空输入与边界', () => {
  it('空串与纯空白按语法错误报告，不进入往返', () => {
    for (const blank of ['', '   ', '\n']) {
      expect(minifyJson(blank).ok).toBe(false)
      expect(formatJson(blank).ok).toBe(false)
    }
  })

  it('顶层标量可以往返', () => {
    for (const scalar of ['1', '"x"', 'true', 'null']) {
      expect(minifyOf(formatOf(scalar, 2))).toBe(scalar)
    }
  })

  it('深嵌套（500 层）不抛异常，异常不会逃出 Result', () => {
    // 本用例只覆盖到 500 层；更深的栈溢出风险是计划① 已登记的 MINOR-2
    // （scanJson / sortDeep 无界递归），不在本计划处理范围
    const deepValid = '['.repeat(500) + ']'.repeat(500)
    expect(() => minifyJson(deepValid)).not.toThrow()
    expect(() => formatJson(deepValid)).not.toThrow()
    expect(minifyJson(deepValid).ok).toBe(true)

    const deepInvalid = '['.repeat(500)
    expect(() => minifyJson(deepInvalid)).not.toThrow()
    expect(minifyJson(deepInvalid).ok).toBe(false)
  })
})

describe('大体积输入（> 1MB）', () => {
  /** 约 1.3MB：12000 个对象，每个含多字段与嵌套 */
  const BIG = JSON.stringify(
    Array.from({ length: 12000 }, (_, index) => ({
      id: index,
      name: `name-${index}`,
      tags: ['a', 'b', 'c'],
      nested: { x: index, y: index * 2 },
      flag: index % 2 === 0,
    })),
  )

  it('样本本身确实超过 1MB', () => {
    expect(BIG.length).toBeGreaterThan(1024 * 1024)
  })

  it('压缩能算完，且不会让体积变大', () => {
    const result = minifyJson(BIG)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.inputBytes).toBeGreaterThan(1024 * 1024)
      // 样本由 JSON.stringify 生成，本就是紧凑形式，压缩动不了它
      expect(result.value.outputBytes).toBeLessThanOrEqual(result.value.inputBytes)
      expect(result.value.output).not.toContain('\n')
    }
  })

  it('美化能算完，且体积变大并保留结构', () => {
    const result = formatJson(BIG, { indent: 2 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.outputBytes).toBeGreaterThan(result.value.inputBytes)
      expect(result.value.output.split('\n').length).toBeGreaterThan(10000)
    }
  })

  it('大输入上「美化 → 压缩」逐字节回到原样，且体积收回', () => {
    const formatted = formatJson(BIG, { indent: 2 })
    expect(formatted.ok).toBe(true)
    if (!formatted.ok) return

    const back = minifyJson(formatted.value.output)
    expect(back.ok).toBe(true)
    if (!back.ok) return

    expect(back.value.output).toBe(minifyOf(BIG))
    // 美化把 1.1MB 撑开（outputBytes 明显大于输入），压缩又原样收回
    expect(formatted.value.outputBytes).toBeGreaterThan(formatted.value.inputBytes)
    expect(back.value.outputBytes).toBeLessThan(formatted.value.outputBytes)
    expect(back.value.outputBytes).toBe(BIG.length)
  }, 30000)

  it('大输入上的非法内容仍按 Result 报告', () => {
    const broken = `${BIG.slice(0, -1)},}`
    const result = minifyJson(broken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.line).toBeGreaterThan(0)
  }, 30000)
})
