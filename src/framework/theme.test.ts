import { beforeEach, describe, expect, it } from 'vitest'
import { applyTheme, DEFAULT_THEME_MODE, resolveTheme } from './theme'

describe('resolveTheme', () => {
  it('显式暗色不受系统影响', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('显式亮色不受系统影响', () => {
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('跟随系统时采用系统偏好', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('未显式选择时默认暗色（spec P1）', () => {
    expect(DEFAULT_THEME_MODE).toBe('dark')
    // 即使系统偏好亮色，默认模式仍解析为暗色
    expect(resolveTheme(DEFAULT_THEME_MODE, false)).toBe('dark')
  })
})

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.className = ''
  })

  it('暗色时挂 dark 类，不挂 light', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it('亮色时挂 light 类，不挂 dark', () => {
    applyTheme('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('重复应用同一主题不产生重复类名', () => {
    applyTheme('dark')
    applyTheme('dark')
    expect(document.documentElement.className.trim()).toBe('dark')
  })
})
