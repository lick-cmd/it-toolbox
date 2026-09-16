import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import JsonMinifyTool from './Tool'

/** 只读 CodeArea 渲染为行号列表，行内容在每行最后一个 span */
const lines = () =>
  screen.getAllByRole('listitem').map((item) => item.lastElementChild?.textContent ?? '')

const setInput = (value: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'JSON 源码' }), { target: { value } })
}

beforeEach(() => {
  localStorage.clear()
})

describe('JSON 压缩工具', () => {
  it('多行 JSON 压成一行且内容与键序不变', () => {
    render(<JsonMinifyTool />)
    setInput('{\n  "b": 1,\n  "a": [1, 2]\n}')

    expect(lines()).toEqual(['{"b":1,"a":[1,2]}'])
  })

  it('字符串内的转义字面量不被规范化', () => {
    render(<JsonMinifyTool />)
    setInput('{ "a": "\\u0041\\/" }')

    expect(lines()).toEqual(['{"a":"\\u0041\\/"}'])
  })

  it('字符串内的空白被保留', () => {
    render(<JsonMinifyTool />)
    setInput('{  "a" :  " x  y "  }')

    expect(lines()).toEqual(['{"a":" x  y "}'])
  })

  it('状态栏展示前后字节数与节省比例', () => {
    render(<JsonMinifyTool />)
    // 12 字节 → 7 字节，省 5/12 = 41.7%
    setInput('{\n  "a": 1\n}')

    expect(screen.getByText(/12 → 7 字节 · 节省 41\.7%/)).toBeDefined()
  })

  it('已经紧凑的输入显示 0.0%', () => {
    render(<JsonMinifyTool />)
    setInput('{"a":1}')

    expect(screen.getByText(/7 → 7 字节 · 节省 0\.0%/)).toBeDefined()
  })

  it('中文按 UTF-8 字节计', () => {
    render(<JsonMinifyTool />)
    setInput('{ "名称": "中文" }')

    // 输入 `{ "名称": "中文" }`：ASCII 部分 10 字节 + 两个汉字各 6 字节 = 22
    // 输出 `{"名称":"中文"}` = 19 字节 —— 若按 String.length 算会得到 8 与 7
    expect(screen.getByText(/^22 → 19 字节/)).toBeDefined()
  })

  it('非法 JSON 给出错误位置且不给输出', () => {
    render(<JsonMinifyTool />)
    setInput('{\n  "a": [1, 2,]\n}')

    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('第 2 行')
    // 列与偏移的精确算术由 core 的用例负责；这里只确认界面把位置透出来了
    expect(alert).toMatch(/第 \d+ 列/)
    expect(alert).toMatch(/偏移 \d+/)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('空输入与纯空白都只显示空态，不报错', () => {
    render(<JsonMinifyTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()

    setInput('   ')
    expect(screen.getByText('尚未输入')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('有结果时提供复制与下载', () => {
    render(<JsonMinifyTool />)
    setInput('{ "a": 1 }')

    expect(screen.getByRole('button', { name: '复制' })).toBeDefined()
    expect(screen.getByRole('button', { name: '下载' })).toBeDefined()
  })
})

describe('JSON 压缩工具 —— 只读视图由框架层着色', () => {
  it('输出区由框架层着色视图呈现', () => {
    render(<JsonMinifyTool />)
    // 输出里必须真的有字符串值：纯数字/布尔的 JSON 不含 `.json-string`，钉不住这件事
    setInput('{ "a": "\\u0041\\/" }')

    expect(document.querySelector('[data-testid="json-code"] .json-string')).toBeTruthy()
  })
})
