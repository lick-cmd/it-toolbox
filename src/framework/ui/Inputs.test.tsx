/**
 * T7 偏离说明：计划原文用 `toHaveValue`（jest-dom 匹配器），但仓库未安装
 * `@testing-library/jest-dom` ⇒ 实测报 `Invalid Chai property: toHaveValue`。
 * 沿用本仓库既有约定（见 ErrorNote.test.tsx 顶部），改用语义等价的 `.value` + `toBe`。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TextInput } from './Inputs'

describe('TextInput', () => {
  it('用 aria-label 暴露可访问名并显示当前值', () => {
    render(<TextInput label="前缀" value="sk_" onChange={() => {}} />)

    expect(screen.getByLabelText<HTMLInputElement>('前缀').value).toBe('sk_')
  })

  it('输入时逐字回调完整值', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<TextInput label="前缀" value="" onChange={onChange} />)

    await user.type(screen.getByLabelText('前缀'), 'ab')

    expect(onChange).toHaveBeenNthCalledWith(1, 'a')
    expect(onChange).toHaveBeenNthCalledWith(2, 'b')
  })
})
