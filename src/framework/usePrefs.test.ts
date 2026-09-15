import { beforeEach, describe, expect, it } from 'vitest'
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
})
