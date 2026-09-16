import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { buildJsonTree } from '@/core/json/tree'
import { JsonCode } from '@/framework/ui/JsonCode'
import { JsonTree } from '@/framework/ui/JsonTree'

// 相对本文件定位 theme.css。不要写成 `new URL('./theme.css', import.meta.url)`：该字面量
// 形态会被 Vite 的 asset-import-meta-url 转换静态改写为 dev server 的 http 地址（jsdom 工程
// 实测得到 http://localhost:3000/src/app/theme.css），readFileSync 会报 scheme file 错误。
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'theme.css'), 'utf8')
const lines = css.split('\n')

/** 取 `:root {` / `:root.light {` 块内文本，收到该块自己的 `}` 为止 */
function blockOf(selector: string): string {
  const start = lines.findIndex((line) => line.trim() === `${selector} {`)
  expect(start, `theme.css 缺少 ${selector} {`).toBeGreaterThanOrEqual(0)
  const end = lines.findIndex((line, index) => index > start && line.trim() === '}')
  return lines.slice(start + 1, end).join('\n')
}

/** 全部「出现在 `{` 之前」的类选择器名 —— 分组选择器（`.a,\n.b {`）也能取到 */
function declaredClasses(): Set<string> {
  // `!`：分组一定存在（`([^{}]*)` 允许空串），故 `noUncheckedIndexedAccess` 下的 undefined 不可达；
  // 与 `src/tools/crypto/ulid-generator/Tool.test.tsx` 的 `match[1]!` 同法。
  const names = [...css.matchAll(/([^{}]*)\{/g)].flatMap((rule) =>
    [...rule[1]!.matchAll(/\.(json-[a-z-]+)/g)].map((match) => match[1]!),
  )
  return new Set(names)
}

const JSON_VARS = ['--json-key', '--json-string', '--json-number', '--json-literal', '--json-punct']

describe('theme.css 的 JSON 配色', () => {
  it.each([':root', ':root.light'])('%s 里 5 个 --json-* 变量齐备', (selector) => {
    const body = blockOf(selector)
    for (const name of JSON_VARS) expect(body, `${selector} 缺少 ${name}`).toContain(`${name}:`)
  })

  it('每个 var(--json-*) 引用都有对应的变量定义', () => {
    const defined = new Set([...css.matchAll(/(--json-[a-z-]+)\s*:/g)].map((match) => match[1]))
    const referenced = [...css.matchAll(/var\((--json-[a-z-]+)\)/g)].map((match) => match[1])
    expect(referenced.length).toBeGreaterThan(0) // 防止改名后正则失配、断言空转
    for (const name of referenced) expect(defined, `引用了未定义的 ${name}`).toContain(name)
  })

  it('JsonCode 实际渲染出的每个着色类都有规则', () => {
    // 从渲染产物反查，而不是手抄一份类名清单：改组件时这条会自己跟上
    const { container } = render(<JsonCode value={'{"a":"b","c":1,"d":true,"e":null}'} />)
    const used = new Set(
      Array.from(container.querySelectorAll('[data-testid="json-code-line"] span'))
        .map((node) => node.className)
        .filter((name) => name.startsWith('json-')),
    )
    expect(used.size).toBeGreaterThan(0) // 一个类都没渲染时不许静默通过
    for (const name of used) expect(declaredClasses(), `theme.css 缺少 .${name} 的规则`).toContain(name)
  })

  it('JsonTree 实际渲染出的每个着色类都有规则', () => {
    // 树的值类型（boolean/null）比 token 类别（literal）更细，若组件直接把 node.type 拼进
    // 类名，就会渲染出 theme.css 里没有的 .json-boolean / .json-null —— 那两个值静默不着色。
    const built = buildJsonTree('{"s":"x","n":1,"b":true,"z":null,"o":{},"a":[]}')
    if (!built.ok) throw new Error(built.error)
    // 这份输入一次覆盖树会用到的全部 9 个类：根 object、空数组 array、四类标量、
    // 类型标签、行与折叠开关（空容器不给开关，故开关类由根提供）
    const { container } = render(<JsonTree tree={built.value} />)
    const used = new Set(
      Array.from(
        container.querySelectorAll('[data-testid="json-tree-row"], [data-testid="json-tree-row"] *'),
      )
        .map((node) => node.className)
        .filter((name) => name.startsWith('json-')),
    )
    // 写死 9：把「组件实际用到的类清单」与 Task 4 的 Produces 钉在一起。
    // 少了就说明组件拼错了类名（漏类不会让这条退化成只检查「渲染出的类都有规则」）
    expect(used).toHaveLength(9)
    for (const name of used) expect(declaredClasses(), `theme.css 缺少 .${name} 的规则`).toContain(name)
  })
})
