/**
 * T13 偏离说明（唯一一处测试文本偏离）：
 * 计划原文用 `toHaveTextContent`（jest-dom 匹配器），但计划自身的依赖清单（第 181–182 行）
 * 只列了 `@testing-library/react` 与 `user-event`，未列 `@testing-library/jest-dom`，
 * 仓库亦未安装 ⇒ 实测报 `Invalid Chai property: toHaveTextContent`。
 * 该匹配器在计划**全文只出现在本文件**（T15/T16/T17/T19 的测试都不使用），
 * 故不为此新增依赖，改用语义等价的 `.textContent` + `toContain`。
 * 断言意图与计划逐条一致（含「不展示行列号」的否定断言）。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ErrorNote } from './ErrorNote'

describe('ErrorNote', () => {
  it('展示错误原因', () => {
    render(<ErrorNote info={{ error: '对象中出现尾随逗号' }} />)
    expect(screen.getByRole('alert').textContent).toContain('对象中出现尾随逗号')
  })

  it('同时展示行号、列号与偏移（spec P3 的三件套）', () => {
    render(<ErrorNote info={{ error: 'boom', line: 3, column: 8, offset: 21 }} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('第 3 行')
    expect(alert.textContent).toContain('第 8 列')
    expect(alert.textContent).toContain('偏移 21')
  })

  it('无法定位时不展示行列号（避免误导）', () => {
    render(<ErrorNote info={{ error: '无法定位的错误' }} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).not.toContain('行')
    expect(alert.textContent).not.toContain('列')
  })

  it('展示补充说明与修复建议', () => {
    render(
      <ErrorNote
        info={{ error: '不是绝对 URL', detail: '缺少协议', suggestion: 'https://example.com' }}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('缺少协议')
    expect(alert.textContent).toContain('https://example.com')
  })
})
