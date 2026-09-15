import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type * as RegistryModule from '@/framework/registry'
import { CommandPalette } from './CommandPalette'

/**
 * 用固定样本集替换注册表：**搜索逻辑本身不 mock**（真实的 searchTools 在这 3 条上运行），
 * 原因是真实注册表当前只有 1 个工具，无法验证方向键在高亮项之间的移动（账本 R15 要求
 * 「据此断言高亮项变化」）。其中 uuid-generator 的字段与 T19 的 meta.ts 保持一致。
 */
vi.mock('@/framework/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof RegistryModule>()
  const load = async () => ({ default: () => null })
  const entries = [
    {
      meta: {
        id: 'uuid-generator',
        name: 'UUID 生成器',
        category: 'crypto' as const,
        description: '生成 UUID v1 / v4 / v7，支持批量与格式选项',
        keywords: ['uuid', 'guid', '唯一标识', '唯一id', 'id生成'],
      },
      load,
    },
    {
      meta: {
        id: 'json-minify',
        name: 'JSON 压缩',
        category: 'dev' as const,
        description: '把 JSON 压成单行',
        keywords: ['json', 'minify'],
      },
      load,
    },
    {
      meta: {
        id: 'base64',
        name: 'Base64 编解码',
        category: 'converter' as const,
        description: '文本与 Base64 互转',
        keywords: ['base64', '编码'],
      },
      load,
    },
  ]
  return { ...actual, listTools: () => entries }
})

describe('CommandPalette', () => {
  it('关闭时不渲染任何内容', () => {
    render(<CommandPalette open={false} onClose={() => {}} onSelect={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('打开后自动聚焦输入框', () => {
    render(<CommandPalette open onClose={() => {}} onSelect={() => {}} />)
    expect(document.activeElement).toBe(screen.getByRole('textbox'))
  })

  it('空查询列出全部工具并展示来源类别', () => {
    render(<CommandPalette open onClose={() => {}} onSelect={() => {}} />)
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByText('UUID 生成器')).toBeDefined()
    expect(screen.getByText('加密')).toBeDefined()
  })

  it('按名称搜索', async () => {
    render(<CommandPalette open onClose={() => {}} onSelect={() => {}} />)
    await userEvent.type(screen.getByRole('textbox'), 'uuid')
    expect(screen.getByText('UUID 生成器')).toBeDefined()
    expect(screen.queryByText('JSON 压缩')).toBeNull()
  })

  it('中文关键词可命中', async () => {
    render(<CommandPalette open onClose={() => {}} onSelect={() => {}} />)
    await userEvent.type(screen.getByRole('textbox'), '唯一标识')
    expect(screen.getByText('UUID 生成器')).toBeDefined()
  })

  it('回车选中高亮项并回调', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette open onClose={onClose} onSelect={onSelect} />)

    await userEvent.type(screen.getByRole('textbox'), 'uuid{Enter}')
    expect(onSelect).toHaveBeenCalledWith('uuid-generator')
    expect(onClose).toHaveBeenCalled()
  })

  it('点击选项即选中并回调', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette open onClose={onClose} onSelect={onSelect} />)

    await userEvent.click(screen.getByText('JSON 压缩'))
    expect(onSelect).toHaveBeenCalledWith('json-minify')
    expect(onClose).toHaveBeenCalled()
  })

  // R15：原计划的用例只断言 `buttons.length > 0`，近乎无断言
  it('方向键移动高亮项，且不在边界越界', async () => {
    render(<CommandPalette open onClose={() => {}} onSelect={() => {}} />)
    const textbox = screen.getByRole('textbox')
    const selected = () =>
      screen
        .getAllByRole('option')
        .findIndex((option) => option.getAttribute('aria-selected') === 'true')

    expect(selected()).toBe(0)

    await userEvent.type(textbox, '{ArrowDown}')
    expect(selected()).toBe(1)

    await userEvent.type(textbox, '{ArrowDown}{ArrowDown}')
    expect(selected()).toBe(2)

    // 末项再按下不越界
    await userEvent.type(textbox, '{ArrowDown}')
    expect(selected()).toBe(2)

    await userEvent.type(textbox, '{ArrowUp}')
    expect(selected()).toBe(1)

    await userEvent.type(textbox, '{ArrowUp}{ArrowUp}{ArrowUp}')
    expect(selected()).toBe(0)
  })

  it('查询变化后高亮回到首项', async () => {
    render(<CommandPalette open onClose={() => {}} onSelect={() => {}} />)
    const textbox = screen.getByRole('textbox')
    await userEvent.type(textbox, '{ArrowDown}')
    await userEvent.type(textbox, 'j')
    expect(
      screen.getAllByRole('option')[0]!.getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('Escape 触发关闭', async () => {
    const onClose = vi.fn()
    render(<CommandPalette open onClose={onClose} onSelect={() => {}} />)
    await userEvent.type(screen.getByRole('textbox'), '{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('点击遮罩关闭，点击面板本身不关闭', async () => {
    const onClose = vi.fn()
    render(<CommandPalette open onClose={onClose} onSelect={() => {}} />)

    fireEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('无匹配时展示空态', async () => {
    render(<CommandPalette open onClose={() => {}} onSelect={() => {}} />)
    await userEvent.type(screen.getByRole('textbox'), 'zzzzzz')
    expect(screen.getByText('没有匹配的工具')).toBeDefined()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
  })
})
