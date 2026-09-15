import { categoryById } from './categories'
import { listTools, type ToolEntry } from './registry'

export type SearchField = 'name' | 'keyword' | 'category' | 'description'

export interface SearchHit {
  entry: ToolEntry
  score: number
  matchedOn: SearchField
}

/** 字段权重：名称 > 关键词 > 类别 > 描述。 */
const FIELD_WEIGHT: Record<SearchField, number> = {
  name: 3,
  keyword: 2,
  category: 1.5,
  description: 1,
}

/** 词与词之间除空格外还接受的显式分隔符。 */
const SEPARATOR = /[\s_/-]/
const HAN = /\p{Script=Han}/u
const LATIN = /[0-9a-zA-Z]/

function isHan(ch: string): boolean {
  return HAN.test(ch)
}

function isLatin(ch: string): boolean {
  return LATIN.test(ch)
}

/** 去掉词首尾的非字母数字汉字字符，避免分隔符残留成噪声。 */
function trimPunctuation(term: string): string {
  return term.replace(/^[^\p{Script=Han}0-9a-zA-Z]+|[^\p{Script=Han}0-9a-zA-Z]+$/gu, '')
}

/**
 * 把查询切分为检索词。
 *
 * 先按空白与 -_/ 切分，再在「拉丁 ↔ 汉字」边界处二次切分。
 * 后一步是关键：否则查询 "base64解码" 会被当作一个整体而无法命中
 * "Base64 编码/解码"。
 */
export function tokenizeQuery(query: string): string[] {
  const terms: string[] = []

  for (const chunk of query.split(SEPARATOR)) {
    if (chunk.length === 0) continue

    let current = ''
    let lastClass: 'han' | 'latin' | null = null

    for (const ch of chunk) {
      const cls = isHan(ch) ? 'han' : isLatin(ch) ? 'latin' : null
      if (cls !== null && lastClass !== null && cls !== lastClass) {
        const trimmed = trimPunctuation(current)
        if (trimmed) terms.push(trimmed)
        current = ''
      }
      current += ch
      if (cls !== null) lastClass = cls
    }

    const trimmed = trimPunctuation(current)
    if (trimmed) terms.push(trimmed)
  }

  return terms.map((term) => term.toLowerCase()).filter((term) => term.length > 0)
}

/** 子序列匹配：字符按序出现即可，连续命中额外加分。 */
function scoreSubsequence(term: string, haystack: string): number {
  let cursor = 0
  let streak = 0
  let bestStreak = 0

  for (const ch of term) {
    const found = haystack.indexOf(ch, cursor)
    if (found === -1) return 0
    streak = found === cursor ? streak + 1 : 1
    bestStreak = Math.max(bestStreak, streak)
    cursor = found + 1
  }

  return 200 + bestStreak * 10
}

/** 单字段匹配打分：精确 > 前缀 > 子串 > 子序列。 */
function scoreTerm(term: string, value: string): number {
  const haystack = value.toLowerCase()

  if (haystack === term) return 1000
  if (haystack.startsWith(term)) return 800 - Math.min(haystack.length - term.length, 100)

  const index = haystack.indexOf(term)
  if (index >= 0) return 600 - Math.min(index, 100)

  return scoreSubsequence(term, haystack)
}

export function searchTools(
  query: string,
  entries: readonly ToolEntry[] = listTools(),
): SearchHit[] {
  const terms = tokenizeQuery(query)

  // 空查询视为「列出全部」，保持注册表既有顺序
  if (terms.length === 0) {
    return entries.map((entry) => ({ entry, score: 0, matchedOn: 'name' as const }))
  }

  const hits: SearchHit[] = []

  for (const entry of entries) {
    const fields: ReadonlyArray<readonly [SearchField, readonly string[]]> = [
      ['name', [entry.meta.name]],
      ['keyword', entry.meta.keywords],
      ['category', [categoryById(entry.meta.category)?.name ?? entry.meta.category]],
      ['description', [entry.meta.description]],
    ]

    let total = 0
    let bestField: SearchField = 'description'
    let bestFieldScore = -1
    let everyTermMatched = true

    for (const term of terms) {
      let termScore = 0
      let termField: SearchField = 'description'

      for (const [field, values] of fields) {
        for (const value of values) {
          const raw = scoreTerm(term, value)
          if (raw <= 0) continue
          const weighted = raw * FIELD_WEIGHT[field]
          if (weighted > termScore) {
            termScore = weighted
            termField = field
          }
        }
      }

      if (termScore <= 0) {
        everyTermMatched = false
        break
      }

      total += termScore
      if (termScore > bestFieldScore) {
        bestFieldScore = termScore
        bestField = termField
      }
    }

    if (everyTermMatched) hits.push({ entry, score: total, matchedOn: bestField })
  }

  // Array.prototype.sort 在 ES2019 起保证稳定，
  // 故同分项保持注册表顺序，满足「排序稳定」要求
  hits.sort((a, b) => b.score - a.score)
  return hits
}
