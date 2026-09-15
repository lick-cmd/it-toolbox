import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UuidGeneratorTool from './Tool'

/**
 * 计划里 T19 只有手工验收（Step 4），本文件把其中可在 jsdom 复现的条目自动化。
 * 核心是那条「关键交互」：格式选项只影响呈现，**不得**触发重新生成。
 *
 * 注：readOnly 的 CodeArea 渲染的是带行号的行列表（不是 textarea），故按 listitem 读取。
 */

const V4_LINE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** 只读视图每一行的内容（listitem 的最后一个 span 是内容，前一个是行号） */
const lines = () =>
  screen.getAllByRole('listitem').map((item) => item.lastElementChild?.textContent ?? '')
const versionGroup = () => screen.getByRole('group', { name: 'UUID 版本' })
/** 把 localStorage 里所有值拼起来：键名格式属实现细节，断言不依赖它 */
const savedValues = () =>
  Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.getItem(localStorage.key(index) ?? ''),
  ).join('')
const checkbox = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement

/**
 * 按下标取分段按钮：Field 用 <label> 包裹 SegmentedControl，使**首个**选项的可访问名
 * 被 label 文本覆盖（实测为「版本UUID 版本」而非 "v1"），故无法按名称查询。
 * 该 a11y 问题已记入账本 Deferred，此处不掩盖也不固化它。
 */
const pickVersion = (index: number) =>
  userEvent.click(within(versionGroup()).getAllByRole('button')[index]!)

beforeEach(() => {
  localStorage.clear()
})

describe('UUID 生成器工具', () => {
  it('默认生成 10 条 v4（小写、带连字符），并给出复制与导出入口', () => {
    render(<UuidGeneratorTool />)

    const value = lines()
    expect(value).toHaveLength(10)
    expect(value.every((line) => V4_LINE.test(line))).toBe(true)
    expect(checkbox('连字符').checked).toBe(true)
    expect(checkbox('大写').checked).toBe(false)
    expect(screen.getByText('共 10 条')).toBeDefined()
    expect(screen.getByRole('button', { name: '复制全部' })).toBeDefined()
    expect(screen.getByRole('button', { name: '下载' })).toBeDefined()
  })

  // 计划的关键交互：勾选「大写」只换大小写，UUID 本身不得变
  it('勾选大写只改变大小写，不重新生成', async () => {
    render(<UuidGeneratorTool />)
    const before = lines()

    await userEvent.click(checkbox('大写'))

    const after = lines()
    // 先排除「视图根本没更新」：否则若 before 恰好全小写，下面第一条会恒真
    expect(after).not.toEqual(before)
    expect(after).toEqual(before.map((line) => line.toUpperCase()))
    expect(after.map((line) => line.toLowerCase())).toEqual(before)
    expect(checkbox('大写').checked).toBe(true)
  })

  // 同理：连字符只影响呈现
  it('取消连字符只去掉分隔符，不重新生成', async () => {
    render(<UuidGeneratorTool />)
    const before = lines()

    await userEvent.click(checkbox('连字符'))

    const after = lines()
    expect(after).toHaveLength(before.length)
    expect(after.every((line) => !line.includes('-'))).toBe(true)
    expect(after).toEqual(before.map((line) => line.replaceAll('-', '')))
  })

  it('切换版本会重新生成，且版本位随之改变', async () => {
    render(<UuidGeneratorTool />)
    const before = lines()

    await pickVersion(2) // v7

    const after = lines()
    expect(after).not.toEqual(before)
    expect(after).toHaveLength(10)
    // 带连字符形式下版本位是第 15 个字符
    expect(after[0]![14]).toBe('7')
  })

  it('数量改变后条数与状态文案同步', async () => {
    render(<UuidGeneratorTool />)
    const input = screen.getByRole('spinbutton', { name: '生成数量' })

    await userEvent.clear(input)
    await userEvent.type(input, '3')

    expect(lines()).toHaveLength(3)
    expect(screen.getByText('共 3 条')).toBeDefined()
  })

  // 数量非法曾导致无限渲染循环（effect 依赖每次渲染都新建的对象），见账本 R85
  it('数量非法时经 ErrorNote 呈现、禁用重新生成且不给出结果区', async () => {
    render(<UuidGeneratorTool />)
    const input = screen.getByRole('spinbutton', { name: '生成数量' })

    await userEvent.clear(input)
    await userEvent.type(input, '2000')

    expect(screen.getByRole('alert').textContent).toContain('数量必须是 0 到 1000 之间的整数')
    expect(screen.getByText('当前值为 2000')).toBeDefined()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(
      (screen.getByRole('button', { name: '重新生成' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('「重新生成」会换一批新的 UUID', async () => {
    render(<UuidGeneratorTool />)
    const before = lines()

    await userEvent.click(screen.getByRole('button', { name: '重新生成' }))

    expect(lines()).not.toEqual(before)
  })

  it('选项跨重开保留（useToolState 持久化，写入去抖 200ms）', async () => {
    const first = render(<UuidGeneratorTool />)

    await userEvent.click(checkbox('大写'))
    const countInput = screen.getByRole('spinbutton', { name: '生成数量' })
    await userEvent.clear(countInput)
    await userEvent.type(countInput, '3')
    await pickVersion(2) // v7

    // 轮询到「去抖真的落盘」为止，而不是死等固定时长（死等只剩 100ms 余量，CI 迟发会假红）
    await vi.waitFor(() => expect(savedValues()).toContain('"uppercase":true'), { timeout: 3000 })

    first.unmount()
    render(<UuidGeneratorTool />)

    expect(checkbox('大写').checked).toBe(true)
    expect((screen.getByRole('spinbutton', { name: '生成数量' }) as HTMLInputElement).value).toBe(
      '3',
    )
    expect(lines()).toHaveLength(3)
    expect(lines()[0]![14]).toBe('7')
  })

  // 计划留下的文案缺陷：JSX 里写 Markdown 星号会被当字面量渲染出来
  it('v1 说明文案里不出现字面量星号', async () => {
    const { container } = render(<UuidGeneratorTool />)

    await pickVersion(0) // v1

    expect(container.textContent).toContain('会话级随机值')
    expect(container.textContent).not.toContain('**')
  })
})
