import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import JsonFormatTool from './Tool'

// 参数类型照着 `@/framework/file` 的真实签名写：`vi.fn(async () => …)` 会推成零参函数，
// 于是 `mock.calls[0]` 是长度 0 的元组，取第 0/1/2 项过不了 tsc。
const fileMocks = vi.hoisted(() => ({
  downloadText: vi.fn(async (_filename: string, _text: string, _mime?: string) => ({
    ok: true as const,
    value: undefined,
  })),
  downloadBlob: vi.fn(async (_filename: string, _blob: Blob) => ({
    ok: true as const,
    value: undefined,
  })),
  downloadBytes: vi.fn(async (_filename: string, _bytes: Uint8Array, _mime?: string) => ({
    ok: true as const,
    value: undefined,
  })),
  guessMime: vi.fn((_filename: string) => 'application/json;charset=utf-8'),
  isTauri: () => false,
}))

vi.mock('@/framework/file', () => fileMocks)

/** 只读 CodeArea 渲染为行号列表，行内容在每行最后一个 span */
const lines = () =>
  screen.getAllByRole('listitem').map((item) => item.lastElementChild?.textContent ?? '')

const setInput = (value: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'JSON 源码' }), { target: { value } })
}

const HINT = '键排序会按值对象重建输出'

beforeEach(() => {
  localStorage.clear()
  fileMocks.downloadText.mockClear()
})

describe('JSON 美化 —— 缩进', () => {
  it('默认按 2 空格缩进', () => {
    render(<JsonFormatTool />)
    setInput('{"a":{"b":1}}')

    expect(lines()).toEqual(['{', '  "a": {', '    "b": 1', '  }', '}'])
    expect(screen.getByText(/缩进 2 空格/)).toBeDefined()
  })

  it('可切到 4 空格', async () => {
    render(<JsonFormatTool />)
    setInput('{"a":1}')
    await userEvent.click(screen.getByRole('button', { name: '4 空格' }))

    expect(lines()).toEqual(['{', '    "a": 1', '}'])
    expect(screen.getByText(/缩进 4 空格/)).toBeDefined()
  })

  it('可切到制表符', async () => {
    render(<JsonFormatTool />)
    setInput('{"a":{"b":1}}')
    await userEvent.click(screen.getByRole('button', { name: '制表符' }))

    expect(lines()[1]).toBe('\t"a": {')
    expect(lines()[2]).toBe('\t\t"b": 1')
  })

  it('空输入不报错也不给输出', () => {
    render(<JsonFormatTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()

    setInput('  ')
    expect(screen.getByText('尚未输入')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('JSON 美化 —— 键排序', () => {
  it('开启后键按字典序排列，数组保持原序', async () => {
    render(<JsonFormatTool />)
    setInput('{"b":1,"a":[3,1,2]}')
    await userEvent.click(screen.getByRole('checkbox', { name: '键排序' }))

    expect(lines()).toEqual(['{', '  "a": [', '    3,', '    1,', '    2', '  ],', '  "b": 1', '}'])
    expect(screen.getByText(/缩进 2 空格 · 键排序/)).toBeDefined()
  })

  it('不开启时保持原键序', () => {
    render(<JsonFormatTool />)
    setInput('{"b":1,"a":[3,1,2]}')

    expect(lines()).toEqual(['{', '  "b": 1,', '  "a": [', '    3,', '    1,', '    2', '  ]', '}'])
    expect(screen.queryByText(new RegExp(HINT))).toBeNull()
  })

  it('默认模式保留转义字面量', () => {
    render(<JsonFormatTool />)
    setInput('{"a":"\\u0041"}')

    expect(lines()[1]).toBe('  "a": "\\u0041"')
  })

  it('开启键排序后同一输入被规范化为字符本身，并给出行为提示', async () => {
    render(<JsonFormatTool />)
    setInput('{"a":"\\u0041"}')
    await userEvent.click(screen.getByRole('checkbox', { name: '键排序' }))

    expect(lines()[1]).toBe('  "a": "A"')
    expect(screen.getByText(new RegExp(HINT))).toBeDefined()
  })

  it('行为提示如实覆盖转义之外的改写面（大整数、超范围指数、重复键）', async () => {
    render(<JsonFormatTool />)
    setInput('{"a":1}')
    await userEvent.click(screen.getByRole('checkbox', { name: '键排序' }))

    const hint = screen.getByText(new RegExp(HINT)).textContent ?? ''
    expect(hint).toContain('大整数精度')
    expect(hint).toContain('超范围指数')
    expect(hint).toContain('重复键')
  })

  it('排序路径确实会改写大整数精度（提示不是空话）', async () => {
    render(<JsonFormatTool />)
    setInput('{"a":9007199254740993}')
    expect(lines()[1]).toBe('  "a": 9007199254740993')

    await userEvent.click(screen.getByRole('checkbox', { name: '键排序' }))
    expect(lines()[1]).toBe('  "a": 9007199254740992')
  })
})

describe('JSON 美化 —— 类型提示视图', () => {
  it('逐值给出路径、类型与概要', async () => {
    render(<JsonFormatTool />)
    setInput('{"a":1,"b":{"c":"xy"}}')
    await userEvent.click(screen.getByRole('button', { name: '类型提示' }))

    const list = screen.getByTestId('json-type-hints')
    expect(list.textContent).toContain('$.b.c')
    expect(list.textContent).toContain('字符串')
    expect(list.textContent).toContain('长度 2')
    expect(list.textContent).toContain('数字')
  })

  it('类型提示不会污染 JSON 输出，切回去仍是纯 JSON', async () => {
    render(<JsonFormatTool />)
    setInput('{"a":1}')

    await userEvent.click(screen.getByRole('button', { name: '类型提示' }))
    expect(screen.queryAllByRole('listitem')).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'JSON' }))
    expect(screen.queryByTestId('json-type-hints')).toBeNull()
    expect(lines()).toEqual(['{', '  "a": 1', '}'])
    expect(lines().join('')).not.toContain('数字')
  })

  it('下载的永远是纯 JSON，提示视图里不提供下载', async () => {
    render(<JsonFormatTool />)
    setInput('{"a":1}')

    await userEvent.click(screen.getByRole('button', { name: '类型提示' }))
    expect(screen.queryByRole('button', { name: '下载' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'JSON' }))
    await userEvent.click(screen.getByRole('button', { name: '下载' }))

    expect(fileMocks.downloadText).toHaveBeenCalledTimes(1)
    const [filename, text, mime] = fileMocks.downloadText.mock.calls[0] ?? []
    expect(filename).toBe('formatted.json')
    expect(String(text)).toBe('{\n  "a": 1\n}')
    expect(mime).toBe('application/json;charset=utf-8')
  })
})

describe('JSON 美化 —— 非法输入与错误定位', () => {
  it('非法 JSON 给出行号列号与偏移', () => {
    render(<JsonFormatTool />)
    setInput('{\n  "a": [1, 2,]\n}')

    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('第 2 行')
    expect(alert).toMatch(/第 \d+ 列/)
    expect(alert).toMatch(/偏移 \d+/)
  })
})

describe('JSON 美化 —— 大体积输入', () => {
  it('先显示处理中，再给出结果', async () => {
    render(<JsonFormatTool />)

    const big = JSON.stringify(
      Array.from({ length: 9000 }, (_, index) => ({
        id: index,
        name: `name-${index}`,
        tags: ['a', 'b'],
        nested: { x: index, y: index * 2 },
      })),
    )
    expect(big.length).toBeGreaterThan(512 * 1024)

    setInput(big)

    // 首帧是「处理中」，而不是卡住
    expect(screen.getByRole('status').textContent).toContain('正在处理')
    expect(screen.getByText(/正在处理大输入/)).toBeDefined()

    await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull(), { timeout: 15000 })

    expect(screen.getByText(/缩进 2 空格 · \d+ → \d+ 字节/)).toBeDefined()
    // 预览被截断，但复制/下载拿完整内容
    expect(screen.getByText(/预览仅显示前 2000 行/)).toBeDefined()
  }, 30000)

  it('大输入下切到类型提示视图仍可用，且同样是截断预览', async () => {
    render(<JsonFormatTool />)
    setInput(JSON.stringify(Array.from({ length: 3000 }, (_, index) => ({ id: index }))))

    await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull(), { timeout: 15000 })
    await userEvent.click(screen.getByRole('button', { name: '类型提示' }))

    // 顶层数组的元素用索引路径（$[0]），不是 $.0
    expect(screen.getByTestId('json-type-hints').textContent).toContain('$[0].id')
    expect(screen.getByText(/仅显示前 2000 个/)).toBeDefined()
  }, 30000)
})

describe('JSON 美化 —— 格式化结果折叠', () => {
  /** 折叠后行号会跳号，故这里只按内容列取行，不照搬只读视图的 `lines()` */
  const lineTexts = () =>
    Array.from(document.querySelectorAll('[data-testid="json-code-line"]')).map(
      (node) => node.textContent ?? '',
    )

  it('折叠某行后其内容行消失并给出摘要，行号仍按原文', async () => {
    const user = userEvent.setup()
    render(<JsonFormatTool />)
    setInput('{"a":{"b":1,"c":2},"d":3}')

    expect(lineTexts()).toEqual(['{', '  "a": {', '    "b": 1,', '    "c": 2', '  },', '  "d": 3', '}'])

    await user.click(screen.getByRole('button', { name: '折叠 第 2 行' }))

    expect(lineTexts()).toEqual(['{', '  "a": {', '  "d": 3', '}'])
    expect(screen.getByText('… 2 键')).toBeTruthy()
    expect(
      Array.from(document.querySelectorAll('li')).map((row) => row.firstElementChild?.textContent),
    ).toEqual(['1', '2', '6', '7'])
  })

  it('全部折叠后只剩各层开括号，全部展开恢复', async () => {
    const user = userEvent.setup()
    render(<JsonFormatTool />)
    setInput('{"a":{"b":1,"c":2},"d":3}')

    await user.click(screen.getByRole('button', { name: '全部折叠' }))
    expect(lineTexts()).toEqual(['{', '  "a": {', '  "d": 3', '}'])

    await user.click(screen.getByRole('button', { name: '全部展开' }))
    expect(lineTexts()).toHaveLength(7)
  })

  it('折叠只影响展示：复制与下载拿到的仍是完整格式化原文', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    render(<JsonFormatTool />)
    setInput('{"a":{"b":1,"c":2}}')
    await user.click(screen.getByRole('button', { name: '全部折叠' }))
    await user.click(screen.getByRole('button', { name: '复制' }))
    await user.click(screen.getByRole('button', { name: '下载' }))

    const complete = '{\n  "a": {\n    "b": 1,\n    "c": 2\n  }\n}'
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(complete))
    const [, text] = fileMocks.downloadText.mock.calls[0] ?? []
    expect(String(text)).toBe(complete)
  })

  it('预览被截断时不提供折叠，并在提示里说明', () => {
    // 800 个元素按 2 空格美化后是 2402 行（每项 3 行、外加首尾两行），越过 2000 行预览上限；
    // 输入仅约 8KB，不触发大输入延迟路径，用例不必等
    render(<JsonFormatTool />)
    setInput(JSON.stringify(Array.from({ length: 800 }, (_, index) => ({ id: index }))))

    expect(screen.getByText(/预览仅显示前 2000 行/)).toBeDefined()
    expect(screen.getByText(/也不提供折叠/)).toBeDefined()
    expect(screen.queryByTestId('json-code-fold-bar')).toBeNull()
  })
})

describe('JSON 美化 —— 只读视图由框架层着色', () => {
  it('输出区由框架层着色视图呈现', () => {
    render(<JsonFormatTool />)
    // 输出里必须真的有字符串值，否则 `.json-string` 不出现、这条钉子会假红
    setInput('{"a":"x"}')

    expect(document.querySelector('[data-testid="json-code"] .json-string')).toBeTruthy()
  })
})

describe('树形视图', () => {
  it('切到树形后展示可折叠节点，折叠后显示摘要', async () => {
    const user = userEvent.setup()
    render(<JsonFormatTool />)

    setInput('{"a":{"b":1,"c":2}}')
    await user.click(screen.getByRole('button', { name: '树形' }))

    expect(document.querySelector('[data-testid="json-tree"]')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '折叠 $.a' }))
    expect(screen.getByText('{…} 2 键')).toBeTruthy()
  })

  it('树形视图同样给出复制与下载入口', async () => {
    const user = userEvent.setup()
    render(<JsonFormatTool />)

    setInput('{"a":1}')
    await user.click(screen.getByRole('button', { name: '树形' }))

    expect(screen.getByRole('button', { name: '复制' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '下载' })).toBeTruthy()
  })

  it('非法输入时树形视图显示错误而非节点', async () => {
    const user = userEvent.setup()
    render(<JsonFormatTool />)

    setInput('{"a":}')
    await user.click(screen.getByRole('button', { name: '树形' }))

    // 先钉住「确实切到了树形视图」：否则「没有节点」可能只是因为还停在格式化视图，
    // 删掉整个树分支也照样绿（W6 —— 这是原用例真正的咬合力缺口）。
    expect(screen.getByRole('button', { name: '树形' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[data-testid="json-tree"]')).toBeNull()
    expect(screen.getByRole('alert')).toBeTruthy() // ErrorNote
  })

  it('空输入时树形视图显示空态', async () => {
    const user = userEvent.setup()
    render(<JsonFormatTool />)

    await user.click(screen.getByRole('button', { name: '树形' }))

    expect(screen.getByRole('button', { name: '树形' }).getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[data-testid="json-tree"]')).toBeNull()
    expect(screen.getByText('尚未输入')).toBeTruthy()
  })

  it('树形视图下改缩进不会把手动折叠抹掉', async () => {
    const user = userEvent.setup()
    render(<JsonFormatTool />)

    setInput('{"a":{"b":1,"c":2}}')
    await user.click(screen.getByRole('button', { name: '树形' }))
    await user.click(screen.getByRole('button', { name: '折叠 $.a' }))

    // 改缩进会让 output 变、进而重建 tree：手动折叠必须活下来
    await user.click(screen.getByRole('button', { name: '4 空格' }))

    expect(screen.getByRole('button', { name: '展开 $.a' })).toBeTruthy()
  })
})

describe('树形与源码的一致性', () => {
  it('树形显示的标量与源码原文逐字符一致（转义不被规范化）', async () => {
    const user = userEvent.setup()
    render(<JsonFormatTool />)

    const input = '{"escaped":"\\u0041","expo":1e2}'
    setInput(input)

    // 源码视图
    await user.click(screen.getByRole('button', { name: 'JSON' }))
    const sourceText = Array.from(document.querySelectorAll('[data-testid="json-code-line"]'))
      .map((line) => line.textContent ?? '')
      .join('\n')
    expect(sourceText).toContain('"\\u0041"')
    expect(sourceText).toContain('1e2')

    // 树形视图：同一个值必须还是原文，不能变成 "A" 或 100
    await user.click(screen.getByRole('button', { name: '树形' }))
    expect(screen.getByText('"\\u0041"')).toBeTruthy()
    expect(screen.getByText('1e2')).toBeTruthy()
    expect(screen.queryByText('"A"')).toBeNull()
  })

  it('复制与下载给的是完整原文，不含树形的装饰标记', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    // 本仓先例 `src/framework/clipboard.test.ts:17-19`：jsdom 的 `navigator.clipboard`
    // 是 getter-only，`Object.assign(navigator, …)` 会抛 TypeError，故用 `vi.stubGlobal`。
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    render(<JsonFormatTool />)
    setInput('{"a":{"b":1}}')
    await user.click(screen.getByRole('button', { name: '树形' }))
    await user.click(screen.getByRole('button', { name: '复制' }))

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('{\n  "a": {\n    "b": 1\n  }\n}')
    })
  })
})

describe('JSON 美化 —— 搜索键与值', () => {
  const search = () => screen.getByRole('textbox', { name: '搜索键和值' })

  it('搜到键与值并高亮命中、给出计数', () => {
    render(<JsonFormatTool />)
    setInput('{"name":"alice","city":"beijing"}')

    fireEvent.change(search(), { target: { value: 'alice' } })
    expect(document.querySelectorAll('mark.json-search-hit')).toHaveLength(1)
    expect(screen.getByTestId('json-search-count').textContent).toBe('第 1 / 1 处')

    fireEvent.change(search(), { target: { value: 'name' } })
    expect(document.querySelectorAll('mark.json-search-hit')).toHaveLength(1)
  })

  it('搜索框只属于格式化视图，切到树形视图后不再出现', async () => {
    const user = userEvent.setup()
    render(<JsonFormatTool />)
    setInput('{"a":1}')

    expect(search()).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '树形' }))
    expect(screen.queryByRole('textbox', { name: '搜索键和值' })).toBeNull()
  })
})
