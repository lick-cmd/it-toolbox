import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// 用 import type 引入模块命名空间再取 typeof：`importOriginal<typeof import('@/framework/file')>()`
// 会触发 @typescript-eslint/consistent-type-imports 的「禁止 import() 类型注解」。
// 仓内既有写法见 src/core/crypto/ulid.test.ts。
import type * as FileModule from '@/framework/file'
import JsonConverterTool from './Tool'

const fileMocks = vi.hoisted(() => ({
  downloadText: vi.fn(
    async (
      _filename: string,
      _text: string,
      _mime?: string,
    ): Promise<{ ok: true; value: undefined }> => ({ ok: true, value: undefined }),
  ),
}))

// 只替换 downloadText，其余导出保持原样 —— 免得漏掉某个被间接用到的导出
vi.mock('@/framework/file', async (importOriginal) => {
  const actual = await importOriginal<typeof FileModule>()
  return { ...actual, downloadText: fileMocks.downloadText }
})

const lines = () =>
  screen.getAllByRole('listitem').map((item) => item.lastElementChild?.textContent ?? '')

const setInput = (value: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'JSON 源码' }), { target: { value } })
}

/** 按 <option value> 选，避免依赖 label 与 value 的差异 */
const pickFormat = async (value: 'js' | 'php' | 'yaml' | 'csv' | 'xml') => {
  await userEvent.selectOptions(screen.getByRole('combobox', { name: '目标格式' }), value)
}

beforeEach(() => {
  localStorage.clear()
  fileMocks.downloadText.mockClear()
})

describe('JSON 转换器', () => {
  it('默认输出 JS', () => {
    render(<JsonConverterTool />)
    setInput('{"a":1}')
    expect(lines().join('\n')).toContain('const data = {')
  })

  it('可以切到 PHP', async () => {
    render(<JsonConverterTool />)
    setInput('{"a":1}')
    await pickFormat('php')
    expect(lines().join('\n')).toContain('$data = [')
  })

  it('可以切到 YAML', async () => {
    render(<JsonConverterTool />)
    setInput('{"a":1}')
    await pickFormat('yaml')
    expect(lines().join('\n')).toContain('a: 1')
  })

  it('可以切到 CSV', async () => {
    render(<JsonConverterTool />)
    setInput('[{"a":1,"b":"x"}]')
    await pickFormat('csv')
    expect(lines().join('\n')).toContain('a,b\n1,x')
  })

  it('可以切到 XML', async () => {
    render(<JsonConverterTool />)
    setInput('{"a":1}')
    await pickFormat('xml')
    expect(lines().join('\n')).toContain('<a>1</a>')
  })

  it('CSV 时缩进与 XML 开关禁用', async () => {
    render(<JsonConverterTool />)
    setInput('[{"a":1}]')
    await pickFormat('csv')

    expect(screen.queryByRole('group', { name: '缩进' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /item/ })).toBeNull()
  })

  it('只有 XML 时显示数组包裹开关', async () => {
    render(<JsonConverterTool />)
    setInput('{"t":[1,2]}')
    expect(screen.queryByRole('checkbox', { name: /item/ })).toBeNull()

    await pickFormat('xml')
    expect(screen.getByRole('checkbox', { name: /item/ })).toBeDefined()
  })

  it('错误输入给出位置', () => {
    render(<JsonConverterTool />)
    setInput('{\n  "a": 1\n')
    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('输入在容器内意外结束')
    expect(alert).toMatch(/第 \d+ 行/)
  })

  it('空输入显示空态', () => {
    render(<JsonConverterTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })

  it('下载 CSV 时带 BOM，复制不带', async () => {
    render(<JsonConverterTool />)
    setInput('[{"a":1}]')
    await pickFormat('csv')

    await userEvent.click(screen.getByRole('button', { name: '下载' }))
    await vi.waitFor(() => expect(fileMocks.downloadText).toHaveBeenCalled())

    // 第一个参数是文件名，第二个才是被写出的文本
    const text = fileMocks.downloadText.mock.calls[0]?.[1]
    expect(text).toBe('\ufeffa\n1')

    // 复制按钮走的是同一份纯净输出（不含 BOM）
    expect(screen.getByRole('button', { name: '复制' })).toBeDefined()
  })

  it('YAML 且含超大整数时挂提示条', async () => {
    render(<JsonConverterTool />)
    setInput('{"id":12345678912345678}')
    await pickFormat('yaml')
    expect(screen.getByText(/精度/)).toBeDefined()
  })

  it('「去美化」把同一份输入交给外壳', async () => {
    const onNavigate = vi.fn()
    render(<JsonConverterTool onNavigate={onNavigate} />)
    setInput('{"a":1}')

    await userEvent.click(screen.getByRole('button', { name: '去美化' }))

    expect(onNavigate).toHaveBeenCalledWith('json-format', { input: '{"a":1}' })
  })

  it('handoff 载荷优先于已持久化的内容', () => {
    localStorage.setItem(
      'itt:v1:toolState',
      JSON.stringify({
        'json-converter': { input: '旧内容', options: { format: 'php' }, updatedAt: 1 },
      }),
    )

    render(<JsonConverterTool handoff={{ input: '{"a":1}' }} />)

    expect(lines().join('\n')).toContain('const data = {')
  })
})
