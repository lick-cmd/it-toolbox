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

// 复制入参必须可观测（spec §9「BOM 只出现在下载入参里」）：mock 写法照
// `src/tools/crypto/rsa-key-generator/Tool.test.tsx:58-61` 的既有先例。
const clipboardMocks = vi.hoisted(() => ({
  copyText: vi.fn(async (_text: string) => ({ ok: true as const, value: undefined })),
}))
vi.mock('@/framework/clipboard', () => clipboardMocks)

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
  clipboardMocks.copyText.mockClear()
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

    // 复制按钮走的是同一份纯净输出（不含 BOM）—— 必须真的钉住复制入参，
    // 否则将来有人把 CopyButton 的 text 接到 downloadText（反之亦然）无人发现
    await userEvent.click(screen.getByRole('button', { name: '复制' }))
    await vi.waitFor(() => expect(clipboardMocks.copyText).toHaveBeenCalled())

    const copied = clipboardMocks.copyText.mock.calls[0]?.[0]
    expect(copied).toBe('a\n1')
    expect(copied).not.toContain('\ufeff')
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

describe('JSON 转换器 —— 转义与 Unicode 开关（仅 JS / PHP 可交互）', () => {
  it('JS 下默认勾选「保留转义」，两个控件都在，输出与从前一致', () => {
    render(<JsonConverterTool />)
    setInput('{"a":"\\u0041"}')

    // 仓库没装 @testing-library/jest-dom，没有 toBeChecked 这类匹配器
    const keepEscapes = screen.getByRole('checkbox', { name: '保留转义' }) as HTMLInputElement
    expect(keepEscapes.checked).toBe(true)
    expect(screen.getByRole('group', { name: 'Unicode 转码' })).toBeDefined()
    expect(lines().join('\n')).toContain('"a": "\\u0041"')
  })

  it('JS 下取消勾选后规范化最小转义', async () => {
    render(<JsonConverterTool />)
    setInput('{"a":"\\u0041","b":"x\\/y"}')

    await userEvent.click(screen.getByRole('checkbox', { name: '保留转义' }))

    const out = lines().join('\n')
    expect(out).toContain('"a": "A"')
    expect(out).toContain('"b": "x/y"')
  })

  it('JS 下 Unicode 转义把中文写成 \\uXXXX', async () => {
    render(<JsonConverterTool />)
    setInput('{"c":"中"}')

    await userEvent.click(screen.getByRole('button', { name: '转义' }))

    expect(lines().join('\n')).toContain('"c": "\\u4e2d"')
  })

  it('PHP 下 Unicode 转义写成 \\u{码点}', async () => {
    render(<JsonConverterTool />)
    setInput('{"c":"中"}')
    await pickFormat('php')

    await userEvent.click(screen.getByRole('button', { name: '转义' }))

    expect(lines().join('\n')).toContain('"c" => "\\u{4e2d}"')
  })

  it('CSV / YAML / XML 下两个开关不可交互', async () => {
    render(<JsonConverterTool />)
    setInput('[{"a":1}]')

    for (const value of ['csv', 'yaml', 'xml'] as const) {
      await pickFormat(value)
      expect(screen.queryByRole('checkbox', { name: '保留转义' })).toBeNull()
      expect(screen.queryByRole('group', { name: 'Unicode 转码' })).toBeNull()
    }
  })
})

describe('JSON 转换器 —— 非法 format 兜底', () => {
  it('持久化状态里的非法 format 落到默认格式，而不是抛进错误边界', () => {
    localStorage.setItem(
      'itt:v1:toolState',
      JSON.stringify({
        'json-converter': { input: '{"a":1}', options: { format: 'bogus' }, updatedAt: 1 },
      }),
    )

    render(<JsonConverterTool />)

    expect(screen.queryByRole('alert')).toBeNull()
    expect(lines().join('\n')).toContain('const data = {')
  })
})
