/**
 * T13 追加（计划 Files **原本就声明**过本文件，R13 将其删去；T13 评审 I-2 判定应在
 * 本任务内补测）：`CodeArea` 有两条真实分支 —— 只读行号视图（含 `errorLine` 高亮）
 * 与可编辑 textarea —— 且是 spec P3「解析错误统一定位」在输入区的落点，
 * 符合 R66/R68 的「零覆盖的生产代码 + 即将被消费」判据。
 * 断言按实现意图独立推导；不依赖 jest-dom（理由见 ErrorNote.test.tsx 顶部）。
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodeArea, lineOfOffset } from './CodeArea'

describe('CodeArea（只读视图）', () => {
  it('按行渲染并带行号', () => {
    render(<CodeArea value={'a\nbb'} readOnly />)

    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toContain('1')
    expect(items[0]?.textContent).toContain('a')
    expect(items[1]?.textContent).toContain('2')
    expect(items[1]?.textContent).toContain('bb')
  })

  it('errorLine 命中的行被标记（spec P3 的出错行高亮）', () => {
    render(<CodeArea value={'a\nb\nc'} readOnly errorLine={2} />)

    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(items[0]?.hasAttribute('data-error')).toBe(false)
    expect(items[1]?.hasAttribute('data-error')).toBe(true)
    expect(items[2]?.hasAttribute('data-error')).toBe(false)
  })

  it('只给 errorOffset 时换算出行号并标记（否则该对外参数静默无效）', () => {
    render(<CodeArea value={'aaaa\nbbbb'} readOnly errorOffset={6} />)

    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(items[1]?.hasAttribute('data-error')).toBe(true)
  })

  it('errorLine 优先于 errorOffset（显式行号已由调用方换算）', () => {
    render(<CodeArea value={'aaaa\nbbbb'} readOnly errorLine={1} errorOffset={6} />)

    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(items[0]?.hasAttribute('data-error')).toBe(true)
    expect(items[1]?.hasAttribute('data-error')).toBe(false)
  })

  it('空值时展示占位文案而不是空列表', () => {
    render(<CodeArea value="" readOnly placeholder="（空）" />)

    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.getByText('（空）')).toBeTruthy()
  })
})

describe('CodeArea（可编辑视图）', () => {
  it('输入触发 onChange', () => {
    const onChange = vi.fn()
    render(<CodeArea value="x" onChange={onChange} label="输入" />)

    fireEvent.change(screen.getByLabelText('输入'), { target: { value: 'xy' } })

    expect(onChange).toHaveBeenCalledWith('xy')
  })

  it('可编辑状态不渲染行号列表（定位只在只读视图生效）', () => {
    render(<CodeArea value={'a\nb'} />)

    expect(screen.queryByRole('list')).toBeNull()
  })
})

describe('lineOfOffset', () => {
  it('由字符偏移推出行号（1 基）', () => {
    expect(lineOfOffset('aaaa\nbbbb', 0)).toBe(1)
    expect(lineOfOffset('aaaa\nbbbb', 6)).toBe(2)
  })
})
