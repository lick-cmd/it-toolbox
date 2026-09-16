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

describe('JSON 美化 —— 只读视图由框架层着色', () => {
  it('输出区由框架层着色视图呈现', () => {
    render(<JsonFormatTool />)
    // 输出里必须真的有字符串值，否则 `.json-string` 不出现、这条钉子会假红
    setInput('{"a":"x"}')

    expect(document.querySelector('[data-testid="json-code"] .json-string')).toBeTruthy()
  })
})
