import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetPrefsForTests,
  clearRecents,
  getPrefs,
  pushRecent,
  setTheme,
  toggleFavorite,
} from './usePrefs'

describe('偏好 store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    __resetPrefsForTests()
  })

  it('默认主题为暗色（spec P1）', () => {
    expect(getPrefs().theme).toBe('dark')
  })

  it('设置主题并持久化', () => {
    setTheme('light')
    expect(getPrefs().theme).toBe('light')
    expect(window.localStorage.getItem('itt:v1:prefs')).toContain('"light"')
  })

  it('收藏可切换', () => {
    toggleFavorite('uuid-generator')
    expect(getPrefs().favorites).toEqual(['uuid-generator'])
    toggleFavorite('uuid-generator')
    expect(getPrefs().favorites).toEqual([])
  })

  it('最近使用去重并累计次数', () => {
    pushRecent('a')
    pushRecent('b')
    pushRecent('a')
    const recents = getPrefs().recents
    expect(recents.map((r) => r.id)).toEqual(['a', 'b'])
    expect(recents[0]?.count).toBe(2)
  })

  it('最近使用有容量上限', () => {
    for (let i = 0; i < 20; i++) pushRecent(`tool-${i}`)
    expect(getPrefs().recents.length).toBeLessThanOrEqual(12)
  })

  it('清空最近使用', () => {
    pushRecent('a')
    clearRecents()
    expect(getPrefs().recents).toEqual([])
  })

  // 「收藏重启后仍在收藏区」的持久化那一半：模块级 current 只在 import 时读一次 storage，
  // 所以只有**重置模块缓存后重新 import** 才算「重启」—— 仅 unmount 再 render 会由内存
  // 状态替持久化扛住断言（App.test.tsx 顶部注释记过这个坑：那个 ghost 偏好用例是空转的）。
  it('重启（模块重新加载）后收藏与最近使用从 storage 回读', async () => {
    toggleFavorite('uuid-generator')
    pushRecent('uuid-generator')
    expect(getPrefs().favorites).toEqual(['uuid-generator'])

    vi.resetModules()
    const fresh = await import('./usePrefs')

    expect(fresh.getPrefs()).not.toBe(getPrefs()) // 确实是新模块实例，而非同一份内存状态
    expect(fresh.getPrefs().favorites).toEqual(['uuid-generator'])
    expect(fresh.getPrefs().recents.map((entry) => entry.id)).toEqual(['uuid-generator'])
  })
})
