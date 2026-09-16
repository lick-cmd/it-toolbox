import { describe, expect, it } from 'vitest'
import { markdownToHtml } from './markdown'

describe('基础语法', () => {
  it('标题与段落', () => {
    const html = markdownToHtml('# 标题\n\n一段正文')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<p>一段正文</p>')
  })

  it('表格与围栏代码块（语言标注为 class）', () => {
    const source = [
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```js',
      'const x = 1',
      '```',
      '',
    ].join('\n')
    const html = markdownToHtml(source)
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<pre><code class="language-js">')
    expect(html).toContain('const x = 1')
  })

  it('嵌套有序 / 无序列表保持层级', () => {
    const source = ['- 外层', '  1. 内层一', '  2. 内层二', '- 外层二', ''].join('\n')
    const html = markdownToHtml(source)
    expect(html).toContain('<ul>')
    expect(html).toContain('<ol>')
    // 内层列表必须在外层 <li> 之内
    expect(html).toMatch(/<li>外层\s*<ol>[\s\S]*<\/ol>\s*<\/li>/)
  })

  it('行内代码与引用', () => {
    const html = markdownToHtml('使用 `npm test` 运行测试\n\n> 引用一行\n')
    expect(html).toContain('<code>npm test</code>')
    expect(html).toContain('<blockquote>')
  })
})

describe('离线性与安全', () => {
  it('原始 HTML 标签被转义为实体', () => {
    const html = markdownToHtml('<div class="x">hi</div>')
    expect(html).toContain('&lt;div class=&quot;x&quot;&gt;hi&lt;/div&gt;')
    expect(html).not.toContain('<div')
  })

  it('script 标签不产生可执行内容', () => {
    const html = markdownToHtml('<script>alert(1)</script>')
    expect(html).not.toContain('<script')
    expect(html).toContain('&lt;script&gt;')
  })

  it('事件属性被转义为文本', () => {
    const html = markdownToHtml('<img src=x onerror="alert(1)">')
    expect(html).not.toContain('onerror="')
    expect(html).toContain('&lt;img')
  })

  it('远程图片渲染为占位块并保留原始地址，且不产出 <img>', () => {
    const html = markdownToHtml('![截图](https://example.com/a.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('远程图片未加载')
    expect(html).toContain('https://example.com/a.png')
    expect(html).toContain('截图')
  })

  it('协议相对地址（//host/path）同样按远程图片处理', () => {
    const html = markdownToHtml('![](//cdn.example.com/x.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('远程图片未加载')
  })

  it('本地相对路径图片同样不发起加载', () => {
    const html = markdownToHtml('![](./local.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('图片未加载')
  })

  it('外部链接不渲染为可导航的 <a>，而是只读展示地址', () => {
    const html = markdownToHtml('[官网](https://example.com/docs)')
    // 不产出任何 <a> 标签；地址只出现在 data-* 与展示文本里（` href=` 前有空格才意味着可导航）
    expect(html).not.toContain('<a')
    expect(html).not.toContain(' href=')
    expect(html).toContain('官网')
    expect(html).toContain('（https://example.com/docs）')
  })

  it('javascript: 伪协议的链接同样不产出 href', () => {
    const html = markdownToHtml('[点我](javascript:alert(1))')
    expect(html).not.toContain('<a')
    expect(html).not.toContain(' href=')
  })
})

describe('边界', () => {
  it('空输入输出空字符串', () => {
    expect(markdownToHtml('')).toBe('')
    expect(markdownToHtml('   \n')).toBe('')
  })
})
