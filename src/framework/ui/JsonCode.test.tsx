import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { buildJsonTree } from '@/core/json/tree'
import { JsonCode } from './JsonCode'
import { JsonCode as JsonCodeFromBarrel, JsonTree as JsonTreeFromBarrel } from './index'

/** 内容列按行取出 —— 行号列不能混进来，否则「与原文相等」无从验证 */
function linesOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid="json-code-line"]')).map(
    (node) => node.textContent ?? '',
  )
}

/** 当前可见的行号（取自行号列）—— 折叠后行号必须跳号，仍以原文为准 */
function visibleLineNumbers(container: HTMLElement): (string | undefined)[] {
  return Array.from(container.querySelectorAll('li')).map(
    (row) => row.firstElementChild?.textContent ?? undefined,
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

  // S2：`\u0041` 与 `1e2` 都有钉子，唯独 `\/` 只在 Core 的 raw 层被测过，
  // 两个视图的渲染断言都没覆盖 —— 而它同样是「可被等价改写」的写法之一
  it('`\\/` 保留原文，不显示为等价写法', () => {
    const value = '{"p":"a\\/b"}'
    const { container } = render(<JsonCode value={value} />)

    expect(container.textContent).toContain('a\\/b')
    expect(container.textContent).not.toContain('a/b')
    expect(linesOf(container).join('\n')).toBe(value)
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

describe('JsonCode 折叠', () => {
  // 行号（1 起算）与代码图的对应：1 `{` / 2 `  "a": {` / 3-4 `"a"` 的两项 / 5 `},` /
  // 6 `  "d": [` / 7-8 数组两项 / 9 `]` / 10 `}`
  const VALUE = '{\n  "a": {\n    "b": 1,\n    "c": 2\n  },\n  "d": [\n    1,\n    2\n  ]\n}'

  it('默认不渲染折叠开关（其它工具的代码视图不受影响）', () => {
    const { container } = render(<JsonCode value={VALUE} />)
    expect(screen.queryByTestId('json-code-fold-bar')).toBeNull()
    expect(container.querySelectorAll('.json-fold-toggle')).toHaveLength(0)
    expect(linesOf(container)).toHaveLength(10)
  })

  it('打开折叠后给出可折叠处计数、每行一格占位与整段展开折叠入口', () => {
    const { container } = render(<JsonCode value={VALUE} foldable />)

    expect(screen.getByText('3 处可折叠')).toBeTruthy()
    // 占位列逐行都有（否则行内容会左右错开），其中只有 3 行是可点的开关
    expect(container.querySelectorAll('.json-fold-toggle')).toHaveLength(10)
    expect(screen.getAllByRole('button', { name: /^(折叠|展开) 第 \d+ 行$/ })).toHaveLength(3)
    expect(screen.getByRole('button', { name: '全部展开' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '全部折叠' })).toBeTruthy()
  })

  it('折叠一行后其内容行消失、显示摘要，行号仍为原文行号', async () => {
    const user = userEvent.setup()
    const { container } = render(<JsonCode value={VALUE} foldable />)

    await user.click(screen.getByRole('button', { name: '折叠 第 2 行' }))

    // 第 2 行到第 5 行（闭括号行）被收起
    expect(linesOf(container)).toEqual(['{', '  "a": {', '  "d": [', '    1,', '    2', '  ]', '}'])
    expect(visibleLineNumbers(container)).toEqual(['1', '2', '6', '7', '8', '9', '10'])
    expect(screen.getByText('… 2 键')).toBeTruthy()
    // 摘要不进内容列 —— 否则「内容与原文逐字符相等」这条不变量就破了
    expect(linesOf(container).join('\n')).not.toContain('…')
    expect(screen.getByRole('button', { name: '展开 第 2 行' }).getAttribute('aria-expanded')).toBe(
      'false',
    )
  })

  it('各层折叠互不影响，展开后原样恢复', async () => {
    const user = userEvent.setup()
    const { container } = render(<JsonCode value={VALUE} foldable />)

    await user.click(screen.getByRole('button', { name: '折叠 第 2 行' }))
    await user.click(screen.getByRole('button', { name: '折叠 第 6 行' }))
    await user.click(screen.getByRole('button', { name: '展开 第 2 行' }))

    expect(linesOf(container)).toEqual(['{', '  "a": {', '    "b": 1,', '    "c": 2', '  },', '  "d": [', '}'])
    expect(screen.getByText('… 2 项')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '展开 第 6 行' }))
    expect(linesOf(container)).toHaveLength(10)
  })

  it('全部折叠只留各层开括号与摘要，全部展开恢复', async () => {
    const user = userEvent.setup()
    const { container } = render(<JsonCode value={VALUE} foldable />)

    await user.click(screen.getByRole('button', { name: '全部折叠' }))
    expect(linesOf(container)).toEqual(['{', '  "a": {', '  "d": [', '}'])
    expect(screen.getByText('… 2 键')).toBeTruthy()
    expect(screen.getByText('… 2 项')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '全部展开' }))
    expect(linesOf(container)).toHaveLength(10)
  })

  it('文档换了就回到默认全展开（折叠按行号记，旧行号不再指向同一批节点）', async () => {
    const user = userEvent.setup()
    const { container, rerender } = render(<JsonCode value={VALUE} foldable />)

    await user.click(screen.getByRole('button', { name: '折叠 第 2 行' }))
    expect(linesOf(container)).toHaveLength(7)

    rerender(<JsonCode value={'{\n  "x": {\n    "y": 1\n  }\n}'} foldable />)
    expect(linesOf(container)).toEqual(['{', '  "x": {', '    "y": 1', '  }', '}'])
  })

  it('空容器没有开关，单行 JSON 连折叠栏都不出现', () => {
    const nested = render(<JsonCode value={'{\n  "e": {},\n  "a": []\n}'} foldable />)
    // 只有根（第 1 行）是可折叠区间；两个空容器所在行收起与展开没有区别，不给开关
    expect(screen.getAllByRole('button', { name: /^(折叠|展开) 第 \d+ 行$/ })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '折叠 第 2 行' })).toBeNull()
    expect(screen.queryByRole('button', { name: '折叠 第 3 行' })).toBeNull()
    nested.unmount()

    render(<JsonCode value={'{"a":{"b":1}}'} foldable />)
    expect(screen.queryByTestId('json-code-fold-bar')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('文本无法解析（预览被截断）时不提供折叠，照常按纯文本显示', () => {
    const { container } = render(<JsonCode value={'{\n  "a": {\n    "b": 1'} foldable />)

    expect(screen.queryByTestId('json-code-fold-bar')).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    // 开关列只剩占位（换行拆出来的 3 行各一格），没有一个可点的开关
    expect(container.querySelectorAll('.json-fold-toggle')).toHaveLength(3)
    expect(container.querySelectorAll('button.json-fold-toggle')).toHaveLength(0)
    expect(linesOf(container).join('\n')).toBe('{\n  "a": {\n    "b": 1')
  })
})

describe('framework/ui 桶导出', () => {
  it('两个新原语都能从 index 导入并渲染', () => {
    const { container } = render(<JsonCodeFromBarrel value={'{"a":1}'} />)
    expect(container.querySelector('.json-number')).toBeTruthy()

    const built = buildJsonTree('{"a":1}')
    if (!built.ok) throw new Error(built.error)
    render(<JsonTreeFromBarrel tree={built.value} />)
    expect(document.querySelector('[data-testid="json-tree"]')).toBeTruthy()
  })
})
