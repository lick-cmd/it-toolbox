import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import YamlToJsonTool from './Tool'

const lines = () =>
  screen.getAllByRole('listitem').map((item) => item.lastElementChild?.textContent ?? '')

const setInput = (value: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'YAML 源码' }), { target: { value } })
}

beforeEach(() => {
  localStorage.clear()
})

describe('YAML 转 JSON 工具', () => {
  it('嵌套映射与数组转换为 JSON', () => {
    render(<YamlToJsonTool />)
    setInput('name: toolbox\ntags:\n  - a\n  - b\n')

    const json = lines().join('\n')
    expect(json).toContain('"name": "toolbox"')
    expect(json).toContain('"tags": [')
    expect(json).toContain('"a"')
  })

  it('缩进切换为 4 空格后输出随之变化', async () => {
    render(<YamlToJsonTool />)
    setInput('a: 1\nb: 2\n')
    expect(lines().join('\n')).toContain('\n  "a": 1')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '输出缩进' }), '4')
    expect(lines().join('\n')).toContain('\n    "a": 1')
  })

  it('语法错误时给出行号', () => {
    render(<YamlToJsonTool />)
    setInput('a: 1\n  b: 2\n')

    expect(screen.getByRole('alert').textContent).toContain('YAML 语法错误')
    expect(screen.getByText('第 2 行')).toBeDefined()
  })

  it('空输入时展示空态', () => {
    render(<YamlToJsonTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})

describe('YAML 转 JSON 工具 —— 只读视图由框架层着色', () => {
  it('输出区由框架层着色视图呈现', () => {
    render(<YamlToJsonTool />)
    // 输出里必须真的有字符串值，否则 `.json-string` 不出现、这条钉子会假红
    setInput('name: toolbox\n')

    expect(document.querySelector('[data-testid="json-code"] .json-string')).toBeTruthy()
  })
})
