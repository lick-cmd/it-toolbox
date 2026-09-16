import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import JsonToYamlTool from './Tool'

const lines = () =>
  screen.getAllByRole('listitem').map((item) => item.lastElementChild?.textContent ?? '')

const setInput = (value: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'JSON 源码' }), { target: { value } })
}

beforeEach(() => {
  localStorage.clear()
})

describe('JSON 转 YAML 工具', () => {
  it('对象转换为映射 / 列表语法', () => {
    render(<JsonToYamlTool />)
    setInput('{"name":"toolbox","tags":["a","b"]}')

    const yaml = lines().join('\n')
    expect(yaml).toContain('name: toolbox')
    expect(yaml).toContain('- a')
    expect(yaml).not.toContain('{')
  })

  it('数组保持顺序', () => {
    render(<JsonToYamlTool />)
    setInput('["b","a","c"]')

    expect(lines().join('\n')).toContain('- b\n- a\n- c')
  })

  it('缺少闭合括号时提示位置', () => {
    render(<JsonToYamlTool />)
    setInput('{\n  "a": 1\n')

    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('输入在容器内意外结束')
    expect(alert).toMatch(/第 \d+ 行/)
  })

  it('空输入时展示空态', () => {
    render(<JsonToYamlTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})
