import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Base64Tool from './Tool'

/**
 * 只替换落盘动作：jsdom 里真点会触发导航告警且无法断言。
 * 本文件原先没 mock 这个模块 —— 因为原用例只断言「下载文件按钮存在」。
 * spec「解码为文件」的 THEN 是「下载内容为解码后的原始字节」，故必须观测调用。
 * 参数类型照着 `@/framework/file` 的真实签名写（零参 mock 会让 `mock.calls[0]` 变成空元组，过不了 tsc）。
 */
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
  guessMime: vi.fn((_filename: string) => 'application/octet-stream'),
}))
vi.mock('@/framework/file', () => fileMocks)

/** 只读 CodeArea 渲染的是行号列表，内容在每行最后一个 span */
const lines = () =>
  screen.getAllByRole('listitem').map((item) => item.lastElementChild?.textContent ?? '')

const textbox = (name: string) => screen.getByRole('textbox', { name })
const setValue = (name: string, value: string) => {
  fireEvent.change(textbox(name), { target: { value } })
}

beforeEach(() => {
  localStorage.clear()
})

describe('Base64 工具', () => {
  it('默认编码模式：输入 hello 输出 aGVsbG8=', () => {
    render(<Base64Tool />)
    setValue('待编码的文本', 'hello')

    expect(lines()).toEqual(['aGVsbG8='])
    expect(screen.getByRole('button', { name: '复制全部' })).toBeDefined()
    expect(screen.getByRole('button', { name: '下载' })).toBeDefined()
  })

  it('中文编码后可被本工具解码还原', async () => {
    render(<Base64Tool />)
    setValue('待编码的文本', '你好')
    const encoded = lines()[0] ?? ''
    expect(encoded.length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setValue('待解码的 Base64', encoded)

    expect(lines()).toEqual(['你好'])
  })

  it('关闭填充符后输出不含 =，且仍可解码', async () => {
    render(<Base64Tool />)
    setValue('待编码的文本', 'hello')
    await userEvent.click(screen.getByRole('checkbox', { name: '包含填充符' }))

    expect(lines()).toEqual(['aGVsbG8'])

    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setValue('待解码的 Base64', 'aGVsbG8')
    expect(lines()).toEqual(['hello'])
  })

  it('非法 Base64 给出错误提示且不给结果', async () => {
    render(<Base64Tool />)
    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setValue('待解码的 Base64', 'abc!@#')

    expect(screen.getByRole('alert').textContent).toContain('非 Base64 字符')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('拖入文件时输出该文件字节的 Base64', async () => {
    render(<Base64Tool />)
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    await userEvent.upload(screen.getByLabelText('拖入文件以编码'), file)

    expect(await screen.findByText(/已选择 hello\.txt/)).toBeDefined()
    expect(lines()).toEqual(['aGVsbG8='])
  })

  it('解码结果不是 UTF-8 文本时提示改用文件下载', async () => {
    render(<Base64Tool />)
    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setValue('待解码的 Base64', '/w==')

    expect(screen.getByText(/不是合法的 UTF-8 文本/)).toBeDefined()
    expect(screen.getByRole('button', { name: '下载文件' })).toBeDefined()
  })

  it('空输入时展示空态', () => {
    render(<Base64Tool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })

  // spec「解码为文件」的 THEN 是「下载内容为解码后的原始字节」。原有用例只断言按钮存在，
  // 属「交付面零覆盖」（与 5.11 评审的 I-3 同类，见 9.2 审计）。
  it('下载文件交出解码后的原始字节（含非 UTF-8 的二进制）', async () => {
    render(<Base64Tool />)
    await userEvent.click(screen.getByRole('button', { name: '解码' }))
    setValue('待解码的 Base64', '/w==')

    fileMocks.downloadBytes.mockClear()
    await userEvent.click(screen.getByRole('button', { name: '下载文件' }))

    expect(fileMocks.downloadBytes).toHaveBeenCalledTimes(1)
    const [filename, bytes] = fileMocks.downloadBytes.mock.calls[0]!
    expect(filename).toBe('decoded.bin')
    // '/w==' → 0xFF。逐字节比较：走文本层会被 UTF-8 重新编码而损坏二进制
    expect([...bytes]).toEqual([0xff])
  })
})
