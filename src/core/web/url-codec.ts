import { err, ok } from '../result'
import type { Result } from '../result'

/** 组件（对应 encodeURIComponent）/ 整体 URI（对应 encodeURI）/ 表单（空格记为 +） */
export type UrlCodecMode = 'component' | 'uri' | 'form'
export type UrlDirection = 'encode' | 'decode'

export interface UrlCodecModeOption {
  value: UrlCodecMode
  label: string
}

export const URL_CODEC_MODES: readonly UrlCodecModeOption[] = [
  { value: 'component', label: '组件' },
  { value: 'uri', label: '整体 URI' },
  { value: 'form', label: '表单' },
]

export const URL_DIRECTIONS: readonly { value: UrlDirection; label: string }[] = [
  { value: 'encode', label: '编码' },
  { value: 'decode', label: '解码' },
]

const HEX_PAIR = /^[0-9a-fA-F]{2}$/

/**
 * 扫描第一个非法的百分号转义。
 *
 * 自己扫而不是只靠 `decodeURIComponent` 抛错，是因为异常里没有位置信息，
 * 而 spec 要求提示「存在非法的转义序列」并尽量定位。
 */
function findBadEscape(text: string): { offset: number; detail: string } | null {
  for (let i = 0; i < text.length; i++) {
    if (text.charAt(i) !== '%') continue
    const hex = text.slice(i + 1, i + 3)
    if (hex.length < 2) {
      return { offset: i, detail: `输入以不完整的转义序列 "%${hex}" 结尾` }
    }
    if (!HEX_PAIR.test(hex)) {
      return { offset: i, detail: `"%${hex}" 不是合法的百分号转义（应为 % 加两位十六进制）` }
    }
    i += 2
  }
  return null
}

function encodeFailure(): Result<never> {
  return err('文本包含无法编码的字符', {
    code: 'BAD_SURROGATE',
    detail: '存在落单的代理项（不完整的 emoji 或增补字符），URI 编码无法处理',
    suggestion: '请检查输入中是否有被截断的 emoji 或特殊字符',
  })
}

/**
 * URI 编码。
 *
 * `encodeURI` 对 `:/?&=#` 等保留字符不编码 —— 这正是「整体 URI」模式需要的语义；
 * 组件模式用 `encodeURIComponent`。表单模式在组件模式的基础上把 `%20` 换成 `+`。
 *
 * 返回 `Result` 而不是裸字符串：`encodeURIComponent` 遇到落单的代理项（半个 emoji）
 * 会抛 URIError，而输入来自用户粘贴，属于常规路径。
 */
export function encodeUrl(text: string, mode: UrlCodecMode): Result<string> {
  const encode = mode === 'uri' ? encodeURI : encodeURIComponent
  let encoded: string
  try {
    encoded = encode(text)
  } catch {
    return encodeFailure()
  }
  return ok(mode === 'form' ? encoded.replaceAll('%20', '+') : encoded)
}

/**
 * URI 解码。
 *
 * 表单模式先做 `+` → 空格（与 `x-www-form-urlencoded` 的语义一致），再解百分号转义。
 * 整体 URI 模式用 `decodeURI`：保留字符即使被编码也维持不解码，避免把路径里的
 * `%2F` 还原成 `/` 而改变 URL 结构。
 */
export function decodeUrl(text: string, mode: UrlCodecMode): Result<string> {
  const normalized = mode === 'form' ? text.replaceAll('+', ' ') : text

  const bad = findBadEscape(normalized)
  if (bad) {
    return err('存在非法的转义序列', {
      code: 'BAD_ESCAPE',
      offset: bad.offset,
      detail: bad.detail,
      suggestion: '请检查 % 后是否紧跟两位十六进制数字',
    })
  }

  try {
    return ok(mode === 'uri' ? decodeURI(normalized) : decodeURIComponent(normalized))
  } catch {
    // 转义语法合法但仍可能解不出字符：例如 %E4%BD 是被截断的 UTF-8 序列
    return err('存在非法的转义序列', {
      code: 'BAD_ESCAPE',
      detail: '转义序列可被识别，但解码后不是合法的 UTF-8 字符',
      suggestion: '该内容可能来自其他字符集（如 GBK）的百分号编码',
    })
  }
}
