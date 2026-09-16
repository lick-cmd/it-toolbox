import { describe, expect, it } from 'vitest'
import { buildJsonTree, keyText, valueText, type JsonTreeNode } from './tree'

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
    // 上限那一层的内容分别是空容器与标量：都不以开括号开头，
    // 正是「跳过子树时按括号配对」最容易数错、把游标吃到流末尾的情形。
    for (const source of [
      '['.repeat(257) + '{}' + ']'.repeat(257),
      '['.repeat(257) + '1' + ']'.repeat(257),
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
