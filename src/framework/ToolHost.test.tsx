import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolEntry } from './registry'
import { ToolErrorBoundary } from './ToolErrorBoundary'
import { ToolHost } from './ToolHost'
import type { ToolHandoff, ToolProps } from './types'

/** 以 loader 构造 entry。id / name 可变，用于验证「切换工具时错误态重置」这一契约。 */
function entryWithLoader(
  load: () => Promise<{ default: ComponentType }>,
  meta: { id: string; name: string } = { id: 'probe', name: '探针工具' },
): ToolEntry {
  return {
    meta: {
      id: meta.id,
      name: meta.name,
      category: 'dev',
      description: '用于测试',
      keywords: ['probe'],
    },
    load,
  }
}

function entryWith(component: ComponentType): ToolEntry {
  return entryWithLoader(() => Promise.resolve({ default: component }))
}

afterEach(() => {
  // 用例中途断言失败时，手工的 spy.mockRestore() 不会执行 —— 统一在此兜底
  vi.restoreAllMocks()
})

describe('ToolHost', () => {
  it('加载完成后渲染工具组件', async () => {
    render(<ToolHost entry={entryWith(() => <p>工具已渲染</p>)} />)
    expect(await screen.findByText('工具已渲染')).toBeDefined()
    // 加载态必须真的消失，否则「常驻加载态」的实现也能蒙混通过本条
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('加载期间展示加载态', () => {
    // loader 永不 resolve：挂起态稳定可观测，也不会在 act 之外产生异步更新
    render(<ToolHost entry={entryWithLoader(() => new Promise<{ default: ComponentType }>(() => {}))} />)
    expect(screen.getByText('加载中…')).toBeDefined()
  })

  it('工具代码在加载阶段失败时展示原因，而非让整个应用崩溃', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ToolHost entry={entryWithLoader(() => Promise.reject(new Error('chunk 拉取失败')))} />)
    expect(await screen.findByText(/出现异常/)).toBeDefined()
    expect(screen.getByText(/chunk 拉取失败/)).toBeDefined()
    spy.mockRestore()
  })

  it('切换工具时重置错误态（边界 key 为工具 id）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = () => {
      throw new Error('探针工具崩溃')
    }

    const { rerender } = render(<ToolHost entry={entryWith(Boom)} />)
    expect(await screen.findByText(/出现异常/)).toBeDefined()

    rerender(
      <ToolHost
        entry={entryWithLoader(() => Promise.resolve({ default: () => <p>已恢复</p> }), {
          id: 'other',
          name: '另一个工具',
        })}
      />,
    )
    expect(await screen.findByText('已恢复')).toBeDefined()
    spy.mockRestore()
  })

  it('把 handoff 与 onNavigate 透传给工具组件', async () => {
    const seen: Array<{ handoff: ToolHandoff | undefined }> = []
    const onNavigate = vi.fn()

    const Probe = ({ handoff }: ToolProps) => {
      seen.push({ handoff })
      return <p>探针</p>
    }

    render(
      <ToolHost
        entry={entryWith(Probe)}
        handoff={{ input: '{"a":1}' }}
        onNavigate={onNavigate}
      />,
    )

    expect(await screen.findByText('探针')).toBeDefined()
    expect(seen[0]?.handoff).toEqual({ input: '{"a":1}' })
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
