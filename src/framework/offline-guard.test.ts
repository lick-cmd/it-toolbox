import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  __resetEgressViolationsForTests,
  getEgressViolations,
  installOfflineGuard,
  isLocalTarget,
} from './offline-guard'

describe('isLocalTarget', () => {
  it.each([
    ['localhost', 'http://localhost:1420/x'],
    ['回环 IPv4', 'http://127.0.0.1:9999/'],
    ['回环 IPv6', 'http://[::1]:1420/'],
    ['相对路径', '/api/thing'],
    ['空字符串', ''],
    ['Tauri IPC 协议', 'ipc://localhost'],
    ['Tauri asset 协议', 'asset://localhost/a.png'],
    ['blob 对象 URL', 'blob:http://localhost/uuid'],
    ['data URL', 'data:image/png;base64,AAAA'],
    ['Tauri 在 Windows 上的 IPC 主机', 'http://ipc.localhost/invoke'],
  ])('%s 视为本地', (_label, target) => {
    expect(isLocalTarget(target)).toBe(true)
  })

  it.each([
    ['https 外站', 'https://example.com/a.png'],
    ['http 外站', 'http://example.com/'],
    ['协议相对外站', '//evil.com/x'],
    ['带端口的 IP 外站', 'http://8.8.8.8:53/'],
    ['主机名以 .localhost 结尾的外站', 'http://localhost.evil.com/'],
  ])('%s 不视为本地', (_label, target) => {
    expect(isLocalTarget(target)).toBe(false)
  })
})

describe('installOfflineGuard', () => {
  const passthrough = vi.fn(async () => new Response('ok'))

  beforeAll(() => {
    // 先清空违规记录，使后续「条数 ≥ 2」只统计本套件产生的记录；
    // 再替换原始 fetch，最后安装守卫，以观察守卫是否放行本地请求。
    __resetEgressViolationsForTests()
    vi.stubGlobal('fetch', passthrough)
    installOfflineGuard()
  })

  it('放行本地请求，交给原始 fetch', async () => {
    await fetch('/api/things')
    expect(passthrough).toHaveBeenCalledTimes(1)
  })

  it('拦截外部请求并抛出错误', () => {
    expect(() => fetch('https://example.com/telemetry')).toThrowError(/已拦截外发请求/)
  })

  it('拦截外部 WebSocket 连接', () => {
    expect(() => new WebSocket('wss://example.com/socket')).toThrowError(/已拦截外发连接/)
  })

  it('记录违规明细供断言与展示', () => {
    const violations = getEgressViolations()
    expect(violations.length).toBeGreaterThanOrEqual(2)
    expect(violations.some((v) => v.kind === 'fetch' && v.target.includes('example.com'))).toBe(true)
    expect(violations.some((v) => v.kind === 'WebSocket')).toBe(true)
  })

  // XHR 是 fetch 之外最常见的出网通道，此前只被 isLocalTarget 的纯函数用例间接覆盖
  it('拦截外部 XMLHttpRequest 并记录违规', () => {
    __resetEgressViolationsForTests()
    const xhr = new XMLHttpRequest()

    expect(() => xhr.open('GET', 'https://example.com/exfil')).toThrowError(/已拦截外发请求/)

    const violations = getEgressViolations()
    expect(violations).toHaveLength(1)
    expect(violations[0]?.kind).toBe('XMLHttpRequest')
    expect(violations[0]?.target).toBe('https://example.com/exfil')
  })

  it('放行本机 XMLHttpRequest（否则开发期自身的 IPC 会被拦掉）', () => {
    const xhr = new XMLHttpRequest()

    expect(() => xhr.open('GET', 'http://localhost:1420/api')).not.toThrow()
  })

  // 拦下来却只在控制台里「悄悄」抛错，用户与开发者都无从下手 —— 提示本身是能力的一部分
  it('拦截时除抛错外还给出控制台提示', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => fetch('https://example.com/telemetry-2')).toThrowError()

      const call = spy.mock.calls.at(-1)
      expect(String(call?.[0])).toContain('[offline-guard] 检测到外发请求')
      expect(call).toContain('https://example.com/telemetry-2')
    } finally {
      spy.mockRestore()
    }
  })
})
