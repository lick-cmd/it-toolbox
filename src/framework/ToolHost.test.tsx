import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ToolEntry } from './registry'
import { ToolErrorBoundary } from './ToolErrorBoundary'
import { ToolHost } from './ToolHost'

function entryWith(component: ComponentType): ToolEntry {
  return {
    meta: {
      id: 'probe',
      name: '探针工具',
      category: 'dev',
      description: '用于测试',
      keywords: ['probe'],
    },
    load: () => Promise.resolve({ default: component }),
  }
}

describe('ToolHost', () => {
  it('加载完成后渲染工具组件', async () => {
    render(<ToolHost entry={entryWith(() => <p>工具已渲染</p>)} />)
    expect(await screen.findByText('工具已渲染')).toBeDefined()
  })

  it('加载期间展示加载态', () => {
    render(<ToolHost entry={entryWith(() => <p>晚点出现</p>)} />)
    expect(screen.getByRole('status')).toBeDefined()
  })
})

describe('ToolErrorBoundary', () => {
  const Boom = () => {
    throw new Error('故意抛出的异常')
  }

  it('捕获异常并展示原因，而非让整个应用崩溃', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ToolErrorBoundary toolName="探针工具">
        <Boom />
      </ToolErrorBoundary>,
    )
    expect(screen.getByText(/出现异常/)).toBeDefined()
    expect(screen.getByText(/故意抛出的异常/)).toBeDefined()
    spy.mockRestore()
  })

  it('提供重试入口', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let shouldThrow = true
    const Flaky = () => {
      if (shouldThrow) throw new Error('首次失败')
      return <p>恢复成功</p>
    }

    render(
      <ToolErrorBoundary toolName="探针工具">
        <Flaky />
      </ToolErrorBoundary>,
    )

    shouldThrow = false
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.getByText('恢复成功')).toBeDefined()
    spy.mockRestore()
  })

  it('正常子组件不受影响', () => {
    render(
      <ToolErrorBoundary toolName="探针工具">
        <p>一切正常</p>
      </ToolErrorBoundary>,
    )
    expect(screen.getByText('一切正常')).toBeDefined()
  })
})
