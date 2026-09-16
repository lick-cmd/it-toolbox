import { describe, expect, it } from 'vitest'
import { buildJsonTree, keyText, valueText, type JsonTreeNode } from './tree'
import { parseJson } from './parse'
import { collectTypeHints, jsonChildPath } from './type-hints'

/** 用例里反复要「按 path 找节点」，单独抽出来避免每处都写一遍递归 */
function nodeAt(root: JsonTreeNode, path: string): JsonTreeNode | null {
  if (root.path === path) return root
  for (const child of root.children) {
    const found = nodeAt(child, path)
    if (found !== null) return found
  }
  return null
}

describe('buildJsonTree', () => {
  it('标量取原文切片，不做规范化', () => {
    const built = buildJsonTree('{"escaped":"\\u0041","expo":1e2,"slash":"a\\/b"}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(nodeAt(built.value.root, '$.escaped')?.raw).toBe('"\\u0041"')
    expect(nodeAt(built.value.root, '$.expo')?.raw).toBe('1e2')
    expect(nodeAt(built.value.root, '$.slash')?.raw).toBe('"a\\/b"')
  })

  it('容器原文是整段源码（含内部空白）', () => {
    const text = '{\n  "a": [1,\n2]\n}'
    const built = buildJsonTree(text)
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(built.value.root.raw).toBe(text)
    expect(nodeAt(built.value.root, '$.a')?.raw).toBe('[1,\n2]')
  })

  it('推导 JSONPath 与深度', () => {
    const built = buildJsonTree('{"a":[{"b":1}]}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const leaf = nodeAt(built.value.root, '$.a[0].b')
    expect(leaf?.depth).toBe(3)
    expect(leaf?.type).toBe('number')
    expect(leaf?.label).toBe('数字')
  })

  it('折叠摘要给出元素个数，空容器如实显示', () => {
    const built = buildJsonTree('{"o":{"x":1,"y":2},"a":[1,2,3],"eo":{},"ea":[]}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(nodeAt(built.value.root, '$.o')?.summary).toBe('{…} 2 键')
    expect(nodeAt(built.value.root, '$.a')?.summary).toBe('[…] 3 项')
    expect(nodeAt(built.value.root, '$.eo')?.summary).toBe('{}')
    expect(nodeAt(built.value.root, '$.ea')?.summary).toBe('[]')
  })

  it('每个值一个节点，键不单独成节点', () => {
    const built = buildJsonTree('{"a":1,"b":{"c":2}}')
    expect(built.ok).toBe(true)
    if (!built.ok) return
    // {"a":1,"b":{"c":2}} → $ 、$.a 、$.b 、$.b.c
    expect(built.value.nodeCount).toBe(4)
  })

  it('非法输入返回带定位的错误，不抛异常', () => {
    const built = buildJsonTree('{"a":}')
    expect(built.ok).toBe(false)
    if (built.ok) return
    // scanner 的错误文案不含固定的「值」字（「值」只出现在 UNCLOSED 分支的 detail 里），
    // 这里只钉「有错误文案 + 有行号」，不绑具体文案。
    expect(built.error).not.toBe('')
    expect(typeof built.line).toBe('number')
  })

  it('超深嵌套不下钻也不抛异常', () => {
    const deep = '['.repeat(300) + ']'.repeat(300)
    const built = buildJsonTree(deep)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    // 下钻到上限即止，但节点本身仍在
    expect(nodeAt(built.value.root, '$[0]') !== null).toBe(true)
  })

  it('深度超限时，被跳过的子树不会让祖先原文串位', () => {
    // 上限那一层的内容分别是空容器、标量与「含内层容器 + 尾随标量」：
    // 都不以单个开括号一路配平，正是「跳过子树时按括号配对」最容易数错的情形。
    for (const source of [
      '['.repeat(257) + '{}' + ']'.repeat(257),
      '['.repeat(257) + '1' + ']'.repeat(257),
      '['.repeat(257) + '[1],2' + ']'.repeat(257),
    ]) {
      const built = buildJsonTree(source)
      expect(built.ok).toBe(true)
      if (!built.ok) return

      // 根节点的原文必须还是整段源码，不能被下游串位污染
      expect(built.value.root.raw).toBe(source)

      // 到达上限的那一层仍然建了节点；它的下一层被跳过，不建节点
      const capped = `$${'[0]'.repeat(256)}`
      expect(nodeAt(built.value.root, capped)?.raw).toBe(`[${source.slice(257, -257)}]`)
      // nodeAt 的签名是 JsonTreeNode | null，取不到时返回 null（不是 undefined）
      expect(nodeAt(built.value.root, `${capped}[0]`)).toBeNull()
    }
  })

  it('键序跟源码走，不跟 Object.keys 的整数键重排', () => {
    const built = buildJsonTree('{"1":"x","0":"y"}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(built.value.root.raw).toBe('{"1":"x","0":"y"}')
    // 子节点顺序 = 源码顺序
    expect(built.value.root.children.map((child) => child.key)).toEqual(['1', '0'])
    // 每个键配到的原文是它自己那一对
    expect(nodeAt(built.value.root, jsonChildPath('$', '1'))?.raw).toBe('"x"')
    expect(nodeAt(built.value.root, jsonChildPath('$', '0'))?.raw).toBe('"y"')
  })

  it('重复键不吞掉后面的 token', () => {
    const built = buildJsonTree('{"a":1,"a":2}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(built.value.root.raw).toBe('{"a":1,"a":2}')
    expect(built.value.root.childCount).toBe(2)
  })

  it('重复键形态不同时不抛异常，各配自己那一对的原文与类型', () => {
    // 每一对各自成节点：raw 与 type 都取自**它自己那一对**的 token。
    // 若按「键 → 解析值」下钻，重复键只剩最后一个值，下钻就会按错误形状消费 token。
    for (const [source, raws, types] of [
      ['{"a":1,"a":[2]}', ['1', '[2]'], ['number', 'array']],
      ['{"a":[2],"a":1}', ['[2]', '1'], ['array', 'number']],
    ] as const) {
      const built = buildJsonTree(source)
      expect(built.ok).toBe(true)
      if (!built.ok) return

      expect(built.value.root.raw).toBe(source)
      expect(built.value.root.childCount).toBe(2)
      expect(built.value.root.children.map((child) => child.raw)).toEqual([...raws])
      expect(built.value.root.children.map((child) => child.type)).toEqual([...types])
    }
  })

  it('重复键形态不同时，祖先原文不串位', () => {
    const source = '{"a":1,"a":[]}'
    const built = buildJsonTree(source)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.value.root.raw).toBe(source)
    // 第一对是数字 1，不能被第二对的数组形状带偏（按解析值下钻时这里会拿到 '1,'）
    expect(nodeAt(built.value.root, '$.a')?.raw).toBe('1')
  })

  it('上限层的 childCount 与可下钻层同口径', () => {
    // 同一个「含重复键的对象」形状：低于上限时按源码里的实际键对数算，
    // 达到上限时也必须一样 —— 不能因为不下钻就退回 Object.keys（重复键会被折叠成 1）。
    const plain = buildJsonTree('{"a":1,"a":2}')
    expect(plain.ok).toBe(true)
    if (!plain.ok) return
    expect(plain.value.root.childCount).toBe(2)

    const cappedObject = '['.repeat(256) + '{"a":1,"a":2}' + ']'.repeat(256)
    const built = buildJsonTree(cappedObject)
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const capped = `$${'[0]'.repeat(256)}`
    const node = nodeAt(built.value.root, capped)
    expect(node?.type).toBe('object')
    expect(node?.childCount).toBe(2)
    expect(node?.summary).toBe('{…} 2 键')
    // 它的子层不再建节点（已到上限）
    expect(nodeAt(built.value.root, `${capped}[0]`)).toBeNull()
  })

  it('类型口径与 collectTypeHints 逐节点一致', () => {
    // 无重复键的文档：本树与类型提示必须给出同一套「路径 → 类型 / 标签」，一一对应。
    const source = '{"a":1,"b":"x","c":[true,null],"d":{},"e":false}'
    const parsed = parseJson(source)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const built = buildJsonTree(source)
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const hints = new Map(collectTypeHints(parsed.value.value).map((hint) => [hint.path, hint]))
    const nodes: JsonTreeNode[] = []
    const collect = (node: JsonTreeNode): void => {
      nodes.push(node)
      for (const child of node.children) collect(child)
    }
    collect(built.value.root)

    expect(nodes.length).toBe(hints.size)
    for (const node of nodes) {
      expect(hints.get(node.path)?.type).toBe(node.type)
      expect(hints.get(node.path)?.label).toBe(node.label)
    }
  })
})

describe('keyText / valueText', () => {
  it('根用 $，对象键带冒号，数组下标用方括号', () => {
    const built = buildJsonTree('{"a":[1]}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    expect(keyText(built.value.root)).toBe('$')
    const arrayNode = nodeAt(built.value.root, '$.a')
    const element = nodeAt(built.value.root, '$.a[0]')
    expect(arrayNode === null ? '' : keyText(arrayNode)).toBe('a:')
    expect(element === null ? '' : keyText(element)).toBe('[0]')
  })

  it('容器展开显示起始括号，折叠显示摘要', () => {
    const built = buildJsonTree('{"a":{"x":1}}')
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const inner = nodeAt(built.value.root, '$.a')
    expect(inner === null ? '' : valueText(inner, true)).toBe('{')
    expect(inner === null ? '' : valueText(inner, false)).toBe('{…} 1 键')
  })
})
