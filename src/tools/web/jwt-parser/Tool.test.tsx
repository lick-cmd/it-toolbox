import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import JwtParserTool from './Tool'

const b64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

/** exp = 1700000000（2023-11-14），相对当前时间必然过期 */
const EXPIRED = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
  sub: '1',
  exp: 1_700_000_000,
  iat: 1_690_000_000,
  nbf: 1_690_000_000,
})}.c2ln`

/** exp = 4102444800（2100-01-01），必然未过期 */
const VALID = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ exp: 4_102_444_800 })}.c2ln`

const setToken = (value: string) => {
  fireEvent.change(screen.getByRole('textbox', { name: 'JWT 令牌' }), { target: { value } })
}

beforeEach(() => {
  localStorage.clear()
})

describe('JWT 解析器工具', () => {
  it('展示解码后的头部与载荷 JSON', () => {
    render(<JwtParserTool />)
    setToken(EXPIRED)

    expect(screen.getByText(/"alg": "HS256"/)).toBeDefined()
    expect(screen.getByText(/"sub": "1"/)).toBeDefined()
  })

  it('展示原始签名片段', () => {
    render(<JwtParserTool />)
    setToken(EXPIRED)

    expect(screen.getByText('c2ln')).toBeDefined()
  })

  it('概览区展示算法与类型', () => {
    render(<JwtParserTool />)
    setToken(EXPIRED)

    expect(screen.getByText('HS256')).toBeDefined()
    expect(screen.getByText('JWT')).toBeDefined()
  })

  it('时间声明给出中文含义与可读时间', () => {
    render(<JwtParserTool />)
    setToken(EXPIRED)

    expect(screen.getByText('过期时间')).toBeDefined()
    expect(screen.getByText('签发时间')).toBeDefined()
    expect(screen.getByText('生效时间')).toBeDefined()
    expect(screen.getAllByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).length).toBe(3)
  })

  it('exp 已过时提示过期并给出已过期时长', () => {
    render(<JwtParserTool />)
    setToken(EXPIRED)

    const banner = screen.getByText(/已过期/)
    expect(banner.textContent).toContain('该令牌已过期')
    // 时长部分必须存在，只写「已过期」不算满足 spec
    expect(banner.textContent).toMatch(/已过期 [^）]+天|已过期 [^）]+小时|已过期 [^）]+秒/)
  })

  it('exp 未到时提示仍在有效期并给出剩余时间', () => {
    render(<JwtParserTool />)
    setToken(VALID)

    const banner = screen.getByText(/仍在有效期内/)
    expect(banner.textContent).toMatch(/剩余 [^）]+/)
  })

  it('不含 exp 时提示未声明过期时间', () => {
    render(<JwtParserTool />)
    setToken(`${b64url({ alg: 'none' })}.${b64url({ sub: '1' })}.sig`)

    expect(screen.getByText(/未声明过期时间/)).toBeDefined()
  })

  it('显式说明签名未被校验', () => {
    render(<JwtParserTool />)
    setToken(EXPIRED)

    expect(screen.getByText(/签名未被校验/)).toBeDefined()
  })

  it('段数不合法时指出实际段数', () => {
    render(<JwtParserTool />)
    setToken('eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ')

    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('JWT 格式不合法')
    expect(alert).toContain('2 段')
  })

  it('载荷非法 JSON 时提示载荷失败但仍展示头部', () => {
    render(<JwtParserTool />)
    setToken(
      `${b64url({ alg: 'none', kid: 'k1' })}.${Buffer.from('not json').toString('base64url')}.sig`,
    )

    expect(screen.getByText(/载荷不是合法的 JSON/)).toBeDefined()
    expect(screen.getByText(/"kid": "k1"/)).toBeDefined()
  })

  it('空输入时展示空态', () => {
    render(<JwtParserTool />)
    expect(screen.getByText('尚未输入')).toBeDefined()
  })
})
