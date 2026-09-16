import { err, ok } from '../result'
import type { Result } from '../result'

/** 一个字符串在 URL 里的两种形态 */
export interface AnalyzedText {
  /** URL 中的原始写法 */
  raw: string
  /** 解码后的可读形式；无法解码时与 raw 相同 */
  decoded: string
  /** 解码后是否与原始形式不同（界面据此决定要不要并列展示两种形式） */
  encoded: boolean
}

export interface AnalyzedParam {
  key: AnalyzedText
  value: AnalyzedText
}

export interface UrlAnalysis {
  href: string
  protocol: string
  username: string
  password: string
  hostname: string
  /** 输入中显式写出的端口；未写出为 null */
  explicitPort: string | null
  /** 生效端口（显式端口，或该协议的默认端口） */
  port: string
  isDefaultPort: boolean
  origin: string
  pathname: AnalyzedText
  pathSegments: AnalyzedText[]
  /** 原始查询串（含前导 ?）；无查询时为空串 */
  search: string
  params: AnalyzedParam[]
  hash: AnalyzedText
}

export const DEFAULT_PORTS: Record<string, string> = {
  'http:': '80',
  'https:': '443',
  'ws:': '80',
  'wss:': '443',
  'ftp:': '21',
}

/** 非绝对 URL 的补全建议前缀 */
export const NON_ABSOLUTE_PREFIX = 'https://'

/** 判断输入是否带协议（scheme 后紧跟冒号） */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

function tryParse(text: string): URL | null {
  try {
    return new URL(text)
  } catch {
    return null
  }
}

/**
 * 从原始输入里取出**用户写出来的**端口。
 *
 * 不能只看 `url.port`：URL 规范会把协议的默认端口归一化掉，
 * `new URL('https://a.com:443/').port` 返回空串，界面上就分不清
 * 「没写端口」和「写了 443」。显式端口只存在于原始字符串里，故在此解析 authority。
 */
function explicitPortOf(input: string, protocol: string): string | null {
  const rest = input.slice(protocol.length).replace(/^\/\//, '')
  const authority = rest.split(/[/?#]/)[0] ?? ''
  // 去掉 userinfo（其中也可能含冒号）
  const hostPart = authority.slice(authority.lastIndexOf('@') + 1)

  if (hostPart.startsWith('[')) {
    // IPv6 字面量：[::1]:8080
    const closing = hostPart.indexOf(']')
    if (closing === -1) return null
    const tail = hostPart.slice(closing + 1)
    if (!tail.startsWith(':')) return null
    const port = tail.slice(1)
    return /^\d+$/.test(port) ? port : null
  }

  const colon = hostPart.lastIndexOf(':')
  if (colon === -1) return null
  const port = hostPart.slice(colon + 1)
  return /^\d+$/.test(port) ? port : null
}

/**
 * 解码为可读形式。
 *
 * 解码失败不能抛：`https://a.com/%zz` 是 `new URL` 能接受的合法输入，
 * 但 `decodeURIComponent('%zz')` 会抛 URIError。此时退化为保留原始形式，
 * 由 `encoded: false` 告诉界面「这个没有可读形式可展示」。
 */
function analyzeText(raw: string, plusAsSpace: boolean): AnalyzedText {
  const hasPlus = plusAsSpace && raw.includes('+')
  const normalized = hasPlus ? raw.replaceAll('+', ' ') : raw
  if (!normalized.includes('%') && !hasPlus) {
    return { raw, decoded: raw, encoded: false }
  }
  try {
    const decoded = decodeURIComponent(normalized)
    return { raw, decoded, encoded: decoded !== raw }
  } catch {
    return { raw, decoded: raw, encoded: false }
  }
}

/**
 * 手工切分查询串。
 *
 * 不用 `url.searchParams`：它在构造时就把百分号转义与 `+` 一并解码，
 * 原始编码形式拿不回来，而 spec 要求两种形式并列展示。
 */
function parseParams(search: string): AnalyzedParam[] {
  const body = search.startsWith('?') ? search.slice(1) : search
  if (body.length === 0) return []

  return body.split('&').map((pair) => {
    const separator = pair.indexOf('=')
    const key = separator === -1 ? pair : pair.slice(0, separator)
    const value = separator === -1 ? '' : pair.slice(separator + 1)
    return { key: analyzeText(key, true), value: analyzeText(value, true) }
  })
}

/**
 * 拆解 URL。
 *
 * 失败分两种，靠 `code` 区分，界面据此给不同引导：
 * - `NOT_ABSOLUTE`：缺协议，`suggestion` 是补上 `https://` 后的完整 URL，
 *   界面提供一键套用。补全后仍解析不了的输入退化为 `INVALID_URL`，
 *   避免对 `:::` 这类输入给出毫无意义的「补全建议」。
 * - `INVALID_URL`：有协议但语法非法（主机名带空格、只有协议没有主机等）。
 */
export function analyzeUrl(input: string): Result<UrlAnalysis> {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return err('请输入 URL', { code: 'EMPTY_INPUT' })
  }

  if (!HAS_SCHEME.test(trimmed)) {
    const completed = `${NON_ABSOLUTE_PREFIX}${trimmed}`
    if (!tryParse(completed)) {
      return err('无法解析该地址', {
        code: 'INVALID_URL',
        detail: `"${trimmed}" 不是绝对 URL，补上协议后也无法解析`,
        suggestion: 'URL 需形如 https://example.com/path?x=1',
      })
    }
    return err('该输入不是绝对 URL', {
      code: 'NOT_ABSOLUTE',
      detail: '缺少协议部分，无法拆解协议 / 主机 / 端口与 Origin',
      suggestion: completed,
    })
  }

  const url = tryParse(trimmed)
  if (!url) {
    return err('URL 解析失败', {
      code: 'INVALID_URL',
      detail: '协议之后的部分不符合 URL 语法，例如主机名含空格或端口不是数字',
      suggestion: 'URL 需形如 https://example.com/path?x=1',
    })
  }

  const explicitPort = explicitPortOf(trimmed, url.protocol)
  const defaultPort = DEFAULT_PORTS[url.protocol] ?? ''
  const port = explicitPort ?? defaultPort

  const rawSegments = url.pathname.split('/').filter((segment) => segment !== '')

  return ok({
    href: url.href,
    protocol: url.protocol,
    username: url.username,
    password: url.password,
    hostname: url.hostname,
    explicitPort,
    port,
    isDefaultPort: port !== '' && port === defaultPort,
    origin: url.origin,
    pathname: analyzeText(url.pathname, false),
    pathSegments: rawSegments.map((segment) => analyzeText(segment, false)),
    search: url.search,
    params: parseParams(url.search),
    hash: analyzeText(url.hash.replace(/^#/, ''), false),
  })
}
