import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import type { ToolEntry } from './registry'
import { searchTools, tokenizeQuery } from './search'
import type { ToolMeta } from './types'

function makeEntry(meta: ToolMeta): ToolEntry {
  return { meta, load: () => Promise.resolve({ default: (() => null) as ComponentType }) }
}

const ENTRIES: ToolEntry[] = [
  makeEntry({
    id: 'base64-converter',
    name: 'Base64 编码/解码',
    category: 'converter',
    description: '文本与 Base64 互转',
    keywords: ['base64', 'b64', '编码', '解码'],
  }),
  makeEntry({
    id: 'uuid-generator',
    name: 'UUID 生成器',
    category: 'crypto',
    description: '生成 UUID v1 / v4 / v7',
    keywords: ['uuid', 'guid', '唯一标识', '唯一id', 'id生成', 'v4', 'v7'],
  }),
  makeEntry({
    id: 'json-diff',
    name: 'JSON 差异比较',
    category: 'web',
    description: '对比两段 JSON 的结构差异',
    keywords: ['json', 'diff', '差异', '比较', '对比'],
  }),
  makeEntry({
    id: 'qrcode-generator',
    name: '二维码生成器',
    category: 'image',
    description: '输入文本生成二维码',
    keywords: ['qrcode', 'qr', '二维码', '二维条码'],
  }),
]

const ids = (query: string): string[] =>
  searchTools(query, ENTRIES).map((hit) => hit.entry.meta.id)

describe('tokenizeQuery', () => {
  it.each([
    ['base64 解码', ['base64', '解码']],
    ['唯一标识', ['唯一标识']],
    ['uuid v7', ['uuid', 'v7']],
    ['uuid-generator', ['uuid', 'generator']],
    ['  JSON   DIFF  ', ['json', 'diff']],
    ['', []],
    ['   ', []],
  ])('%s → %j', (query, expected) => {
    expect(tokenizeQuery(query)).toEqual(expected)
  })

  it('在拉丁与汉字边界处切分', () => {
    expect(tokenizeQuery('base64解码')).toEqual(['base64', '解码'])
  })
})

describe('searchTools', () => {
  it('空查询返回全部，且保持传入顺序（注册表顺序）', () => {
    expect(ids('')).toEqual(ENTRIES.map((e) => e.meta.id))
    expect(ids('   ')).toEqual(ENTRIES.map((e) => e.meta.id))
  })

  it('按英文名命中', () => {
    expect(ids('uuid')).toContain('uuid-generator')
    expect(ids('qrcode')).toContain('qrcode-generator')
  })

  it('按中文关键词命中（纯中文查询）', () => {
    expect(ids('唯一标识')).toEqual(['uuid-generator'])
    expect(ids('二维码')).toEqual(['qrcode-generator'])
  })

  it('中英混合查询：所有词都必须命中', () => {
    // 这正是整串子串匹配会失手的场景
    expect(ids('base64 解码')).toEqual(['base64-converter'])
    expect(ids('json 差异')).toEqual(['json-diff'])
  })

  it('AND 语义：任一词未命中则整体不命中', () => {
    expect(ids('base64 二维码')).toEqual([])
  })

  it('子序列模糊匹配（字符按序出现即可）', () => {
    expect(ids('ud')).toContain('uuid-generator')
  })

  it('按类别名命中', () => {
    expect(ids('图片')).toEqual(['qrcode-generator'])
  })

  it('前缀匹配优先于子串匹配', () => {
    const hits = searchTools('jso', ENTRIES)
    expect(hits[0]?.entry.meta.id).toBe('json-diff')
  })

  it('名称匹配权重高于描述匹配', () => {
    const nameWin = searchTools('二维码', ENTRIES)
    expect(nameWin[0]?.entry.meta.id).toBe('qrcode-generator')
    expect(nameWin[0]?.matchedOn).toBe('name')
  })

  it('无结果时返回空数组', () => {
    expect(ids('zzzzz')).toEqual([])
  })

  it('排序稳定：同一查询两次结果一致', () => {
    expect(ids('json')).toEqual(ids('json'))
  })

  it('命中项携带判定依据字段', () => {
    const hit = searchTools('uuid', ENTRIES).find((h) => h.entry.meta.id === 'uuid-generator')
    expect(hit?.matchedOn).toBe('name')
    expect(hit?.score).toBeGreaterThan(0)
  })
})
