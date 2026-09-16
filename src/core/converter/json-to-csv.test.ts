import { describe, expect, it } from 'vitest'
import { jsonToCsv } from './json-to-csv'

function csvOf(text: string): string {
  const result = jsonToCsv(text)
  if (!result.ok) throw new Error(`期望成功，实际失败：${result.error}`)
  return result.value
}

describe('jsonToCsv', () => {
  it('对象数组：表头为键的并集（按首次出现顺序），缺失键留空', () => {
    expect(csvOf('[{"a":1,"b":"x"},{"a":2,"c":"y"}]')).toBe('a,b,c\n1,x,\n2,,y')
  })

  it('原始值数组：单列 value', () => {
    expect(csvOf('[1,2,3]')).toBe('value\n1\n2\n3')
  })

  it('顶层对象：单行表格，列 = 键', () => {
    expect(csvOf('{"a":1,"b":2}')).toBe('a,b\n1,2')
  })

  it('顶层标量：单列 value 一行', () => {
    expect(csvOf('"x"')).toBe('value\nx')
    expect(csvOf('1')).toBe('value\n1')
  })

  it('混合数组退化为单列 value（非原始值用紧凑 JSON，含引号故再加一层引号转义）', () => {
    expect(csvOf('[1,"a",{"b":2},[3]]')).toBe('value\n1\na\n"{""b"":2}"\n[3]')
  })

  it('RFC 4180 转义：逗号、引号、换行', () => {
    expect(csvOf('[{"a":"x,y"}]')).toBe('a\n"x,y"')
    expect(csvOf('[{"a":"他说\\"你好\\""}]')).toBe('a\n"他说""你好"""')
    expect(csvOf('[{"a":"x\\ny"}]')).toBe('a\n"x\ny"')
  })

  it('null 是空字段，空字符串也不加引号（两者在 CSV 里看起来一样，但 null 不写引号）', () => {
    expect(csvOf('[{"a":null,"b":""}]')).toBe('a,b\n,')
  })

  it('嵌套对象在单元格里用紧凑 JSON（保留原文）', () => {
    expect(csvOf('[{"a":{"b":1},"c":[1,2]}]')).toBe('a,c\n"{""b"":1}","[1,2]"')
  })

  it('嵌套容器单元格保真：大整数不被取整（紧凑 JSON 取自 token，不走 JSON.parse → 再序列化）', () => {
    expect(csvOf('[{"a":{"b":12345678912345678}}]')).toBe('a\n"{""b"":12345678912345678}"')
  })

  it('字符串值解码为真实字符（\\/ 与 \\uXXXX 都还原）', () => {
    expect(csvOf('[{"a":"a\\/b"}]')).toBe('a\na/b')
    expect(csvOf('[{"a":"\\u4e2d"}]')).toBe('a\n中')
  })

  it('数字保留原写法', () => {
    expect(csvOf('[{"a":1e2,"b":-0,"c":12345678912345678}]')).toBe('a,b,c\n1e2,-0,12345678912345678')
  })

  it('布尔写成 true / false', () => {
    expect(csvOf('[{"a":true,"b":false}]')).toBe('a,b\ntrue,false')
  })

  it('行分隔符是 \\n 而不是 CRLF', () => {
    expect(csvOf('[{"a":1},{"a":2}]')).not.toContain('\r')
  })

  it('空数组不产出内容', () => {
    expect(csvOf('[]')).toBe('')
  })

  it('空输入返回空串', () => {
    expect(csvOf('  ')).toBe('')
  })

  it('非法输入按 Result 报错并给出行列', () => {
    const result = jsonToCsv('[{"a":}]')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.line).toBeGreaterThan(0)
  })
})
