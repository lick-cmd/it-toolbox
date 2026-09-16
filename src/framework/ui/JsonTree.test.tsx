import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { buildJsonTree, type JsonTreeModel } from '@/core/json/tree'
import { JsonTree } from './JsonTree'

function treeOf(text: string): JsonTreeModel {
  const built = buildJsonTree(text)
  if (!built.ok) throw new Error(built.error)
  return built.value
}

function rowTexts(): string[] {
  return Array.from(document.querySelectorAll('[data-testid="json-tree-row"]')).map(
    (row) => row.textContent ?? '',
  )
}

describe('JsonTree', () => {
  it('默认展开全部节点并展示类型标签', () => {
    render(<JsonTree tree={treeOf('{"a":{"b":1}}')} />)
    expect(rowTexts()).toHaveLength(3) // $ 、$.a 、$.a.b
    expect(screen.getByText('数字')).toBeTruthy()
  })

  it('折叠某个子项后其子孙消失，并显示含元素个数的摘要', async () => {
    const user = userEvent.setup()
    render(<JsonTree tree={treeOf('{"a":{"b":1,"c":2},"d":3}')} />)

    await user.click(screen.getByRole('button', { name: '折叠 $.a' }))

    expect(rowTexts()).toHaveLength(3) // $ 、$.a（折叠态）、$.d（同级不受影响，仍在）
    expect(screen.getByText('{…} 2 键')).toBeTruthy()
    expect(screen.getByRole('button', { name: '展开 $.a' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('折叠状态按节点独立，互不影响', async () => {
    const user = userEvent.setup()
    render(<JsonTree tree={treeOf('{"a":{"b":1},"c":{"d":2}}')} />)

    await user.click(screen.getByRole('button', { name: '折叠 $.a' }))
    await user.click(screen.getByRole('button', { name: '折叠 $.c' }))
    await user.click(screen.getByRole('button', { name: '展开 $.a' }))

    expect(screen.getByRole('button', { name: '展开 $.c' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: '折叠 $.a' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('全部折叠后除根以外全部收起，全部展开后恢复', async () => {
    const user = userEvent.setup()
    render(<JsonTree tree={treeOf('{"a":{"b":1},"c":2}')} />)

    await user.click(screen.getByRole('button', { name: '全部折叠' }))
    expect(rowTexts()).toHaveLength(3) // $ 、$.a（折叠态）、$.c

    await user.click(screen.getByRole('button', { name: '全部展开' }))
    expect(rowTexts()).toHaveLength(4)
  })

  it('空对象不是可折叠节点，不给开关', () => {
    render(<JsonTree tree={treeOf('{"e":{}}')} />)
    expect(screen.queryByRole('button', { name: '折叠 $.e' })).toBeNull()
    expect(screen.getByText('{}')).toBeTruthy()
  })

  it('重复键如实渲染成两行，不因 path 相同而少画一行', () => {
    // 树层有意让重复键各自成节点（path 相同），界面必须照画两行：
    // 少画一行就等于替用户删了一个他源码里写着的数据。
    render(<JsonTree tree={treeOf('{"a":1,"a":2}')} />)
    expect(rowTexts()).toHaveLength(3) // $ 、两行 $.a
    expect(rowTexts().filter((text) => text.includes('a:'))).toHaveLength(2)
  })

  it('大输入默认只展开第一层，并如实提示渲染上限', () => {
    // 2010 个单元素数组：节点数越过自动折叠阈值，默认只展开根这一层
    const big = `[${Array.from({ length: 2010 }, (_, index) => `[${index}]`).join(',')}]`
    render(<JsonTree tree={treeOf(big)} maxRows={20} />)

    expect(screen.getByText(/仅渲染前 20 行/)).toBeTruthy()
    expect(rowTexts()).toHaveLength(20)
    // 默认折叠下，子数组只有一行摘要，没有展开的子孙
    expect(document.querySelectorAll('[data-testid="json-tree-row"]')[1]?.textContent).toContain(
      '[…] 1 项',
    )
  })
})
