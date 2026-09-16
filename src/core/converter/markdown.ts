import MarkdownIt from 'markdown-it'
import type { Env } from 'markdown-it'

/**
 * Markdown → HTML。
 *
 * 三个「零外发」硬约束全部在这里落地，而不是交给工具层：
 *
 * 1. `html: false` —— 原始 HTML 一律转义，`<script>` / `onerror` 只会变成文本；
 * 2. 图片规则被覆写 —— 任何图片（含远程地址）都渲染为占位块，不产出 `<img>`，
 *    预览因此不会发起任何图片加载请求；
 * 3. 链接规则被覆写 —— 不产出 `<a href>`，只在行尾以只读文本展示地址，
 *    应用窗口因此不可能被导航走。
 *
 * 之所以放在 Core 而不是工具层：这三条是 spec 的 Scenario，必须在 Node 环境
 * 里可直接断言，不依赖 WebView 的加载行为。
 */

const REMOTE_URL = /^(?:https?:)?\/\//i

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
})

md.renderer.rules['image'] = (tokens, idx) => {
  const token = tokens[idx]
  // attrGet 的返回类型是 string | number | null（HTML 属性值可以是数字），统一转成字符串
  const src = String(token?.attrGet('src') ?? '')
  const alt = (token?.content ?? '').trim()
  const label = alt.length > 0 ? alt : src

  if (REMOTE_URL.test(src)) {
    return (
      `<span class="md-image-block" data-src="${escapeHtml(src)}">` +
      `[远程图片未加载] ${escapeHtml(label)}（${escapeHtml(src)}）</span>`
    )
  }
  return (
    `<span class="md-image-block" data-src="${escapeHtml(src)}">` +
    `[图片未加载] ${escapeHtml(label)}</span>`
  )
}

/**
 * 链接地址通过 `env` 在 open/close 之间传递。
 *
 * `env` 的类型是 `Env | undefined`，故所有读写都要判空；索引签名是
 * `unknown`，取出来必须 `as` 收窄。
 */
md.renderer.rules['link_open'] = (tokens, idx, _options, env) => {
  const href = String(tokens[idx]?.attrGet('href') ?? '')
  const stack = (env?.['mdLinkStack'] as string[] | undefined) ?? []
  stack.push(href)
  if (env) env['mdLinkStack'] = stack
  return `<span class="md-link" data-href="${escapeHtml(href)}">`
}

md.renderer.rules['link_close'] = (_tokens, _idx, _options, env) => {
  const stack = (env?.['mdLinkStack'] as string[] | undefined) ?? []
  const href = stack.pop() ?? ''
  return `</span><span class="md-link-url">（${escapeHtml(href)}）</span>`
}

export function markdownToHtml(source: string): string {
  if (source.trim().length === 0) return ''
  const env: Env = {}
  return md.render(source, env)
}
