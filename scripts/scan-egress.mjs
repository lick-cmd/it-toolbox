#!/usr/bin/env node
/**
 * 离线第 3 层：扫描构建产物，确认没有引入外发能力。
 *
 * 只把「网络 API 调用」作为致命条件。远程 URL 字面量仅作告警 ——
 * 依赖库中的注释、schema 地址、文档链接会产生大量噪声，若设为致命，
 * 该检查很快会被绕过或关闭，那比没有检查更糟。
 *
 * 曾出现的误报：压缩后代码中的 `obj.fetch(` 会被 `\bfetch\s*\(` 命中，
 * 故使用负向后顾断言排除 `.` 与标识符字符。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'dist')

const NETWORK_API =
  /(?<![\w$.])(?:fetch\s*\(|new\s+XMLHttpRequest|new\s+WebSocket|new\s+EventSource|navigator\.sendBeacon)/g
const REMOTE_URL = /["'`]https?:\/\/[^\s"'`)\\]{4,}/g

// 允许存在于产物中的远程 URL：不可达，仅为依赖内部的字符串常量
const URL_ALLOWLIST = [
  /^["'`]https?:\/\/(?:www\.)?w3\.org\//,
  /^["'`]https?:\/\/(?:www\.)?schema\.tauri\.app\//,
  /^["'`]https?:\/\/yaml\.org\//,
  /^["'`]https?:\/\/json-schema\.org\//,
  /^["'`]https?:\/\/(?:www\.)?github\.com\//,
]

// 守卫自身含有网络 API 字面量；它不应出现在生产包中，若出现则跳过以免自证其罪
const SKIP_PATH = /offline-guard/

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (['.js', '.mjs', '.cjs', '.html', '.css'].includes(extname(path))) out.push(path)
  }
  return out
}

if (!statSync(DIST, { throwIfNoEntry: false })) {
  console.error('[scan-egress] 未找到 dist/，请先执行 npm run build')
  process.exit(1)
}

let fatal = 0
let warned = 0

for (const file of walk(DIST)) {
  const rel = relative(ROOT, file).replaceAll('\\', '/')
  if (SKIP_PATH.test(rel)) continue
  const text = readFileSync(file, 'utf8')

  for (const match of text.matchAll(NETWORK_API)) {
    const line = text.slice(0, match.index).split('\n').length
    console.error(`[FATAL] ${rel}:${line} 出现网络 API 调用：${match[0]}`)
    fatal++
  }

  for (const match of text.matchAll(REMOTE_URL)) {
    if (URL_ALLOWLIST.some((re) => re.test(match[0]))) continue
    const line = text.slice(0, match.index).split('\n').length
    console.warn(`[warn ] ${rel}:${line} 远程 URL 字面量：${match[0].slice(0, 80)}`)
    warned++
  }
}

console.log(`\n[scan-egress] 网络 API 调用 ${fatal} 处；远程 URL 字面量 ${warned} 处`)
if (fatal > 0) {
  console.error('[scan-egress] 产物中存在外发能力，构建失败。')
  process.exit(1)
}
console.log('[scan-egress] 通过：产物中未发现外发能力。')
