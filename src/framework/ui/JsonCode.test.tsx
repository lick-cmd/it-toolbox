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
    expect(container.textContent).toContain('2')
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
