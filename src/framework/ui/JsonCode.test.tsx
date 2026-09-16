import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { JsonCode } from './JsonCode'

/** 内容列按行取出 —— 行号列不能混进来，否则「与原文相等」无从验证 */
function linesOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid="json-code-line"]')).map(
    (node) => node.textContent ?? '',
  )
}

describe('JsonCode', () => {
  it('按 token 类别着色，且渲染文本与原文逐字符相等', () => {
    const value = '{"a":"\\u0041","n":1e2,"b":true,"z":null}'
    const { container } = render(<JsonCode value={value} />)

    // 键也是 string token：扫描器不区分键与值，两者都是引号开头的 string。
    // 故 4 个键（a/n/b/z）+ 1 个字符串值（"\u0041"）= 5。
    expect(container.querySelectorAll('.json-string')).toHaveLength(5)
    expect(container.querySelectorAll('.json-number')).toHaveLength(1)
    expect(container.querySelectorAll('.json-literal')).toHaveLength(2) // true 与 null
    expect(linesOf(container).join('\n')).toBe(value)
  })

  it('保留转义原文，不规范化', () => {
    const { container } = render(<JsonCode value={'{"e":"\\u0041"}'} />)
    expect(container.textContent).toContain('\\u0041')
    expect(container.textContent).not.toContain('"A"')
  })

  it('多行输入按行渲染且带行号', () => {
    const value = '{\n  "a": 1\n}'
    const { container } = render(<JsonCode value={value} />)
    expect(linesOf(container)).toHaveLength(3)
    expect(linesOf(container).join('\n')).toBe(value)
    // 行号列是每行 `li` 的第一个子元素；`2` 只能来自那里，不是被内容里的数字碰巧满足
    expect(
      Array.from(container.querySelectorAll('li')).map((row) => row.firstElementChild?.textContent),
    ).toEqual(['1', '2', '3'])
  })

  it('空行渲染为空串，不补填充字符', () => {
    const value = '{\n\n  "a": 1\n\n}'
    const { container } = render(<JsonCode value={value} />)

    // 5 行：`{` / 空 / `  "a": 1` / 空 / `}`
    expect(linesOf(container)).toHaveLength(5)
    // 直接钉住失效形态：给空行补 `' '` 就会让这两条立刻变红
    expect(linesOf(container)[1]).toBe('')
    expect(linesOf(container)[3]).toBe('')
    // 且整体仍与原文逐字符相等（原文里那两个空行就是什么都没有）
    expect(linesOf(container).join('\n')).toBe(value)
  })

  it('无法解析时降级为纯文本，不抛异常也不上色', () => {
    const { container } = render(<JsonCode value={'{"a":}'} />)
    expect(container.querySelector('.json-string')).toBeNull()
    expect(linesOf(container).join('\n')).toBe('{"a":}')
  })

  it('空内容显示空态', () => {
    const { container } = render(<JsonCode value="" />)
    expect(container.textContent).toContain('（空）')
  })
})
