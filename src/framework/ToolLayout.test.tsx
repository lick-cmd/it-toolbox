import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ToolLayout } from './ToolLayout'

/**
 * ToolLayout 是 720px 并排转堆叠断点的唯一载体，且 Task 19 会立即消费它。
 * 判别联合的两种形态必须各有断言兜住，否则「body 分支失效」只会表现为运行时空面板。
 */
describe('ToolLayout', () => {
  it('标准形态渲染输入与输出两个面板', () => {
    render(<ToolLayout input={<p>左侧输入</p>} output={<p>右侧输出</p>} />)
    expect(screen.getByText('输入')).toBeDefined()
    expect(screen.getByText('输出')).toBeDefined()
    expect(screen.getByText('左侧输入')).toBeDefined()
    expect(screen.getByText('右侧输出')).toBeDefined()
  })

  it('自由形态只渲染 body，不出现输入/输出面板', () => {
    render(<ToolLayout body={<p>自定义排布</p>} />)
    expect(screen.getByText('自定义排布')).toBeDefined()
    expect(screen.queryByText('输入')).toBeNull()
    expect(screen.queryByText('输出')).toBeNull()
  })

  it('body 显式为 undefined 时回落到标准形态', () => {
    render(<ToolLayout body={undefined} input={<p>左侧输入</p>} output={<p>右侧输出</p>} />)
    expect(screen.getByText('输入')).toBeDefined()
    expect(screen.getByText('输出')).toBeDefined()
  })

  // spec「无输入工具隐藏输入区：输入区不占据界面空间」的落点。
  // 旧实现无条件渲染输入面板、靠说明文案占位，本条即那处偏差的钉子。
  it('省略 input 时输入面板整个不渲染，输出占满整宽', () => {
    render(<ToolLayout output={<p>右侧输出</p>} />)

    expect(screen.queryByText('输入')).toBeNull()
    expect(screen.getByText('输出')).toBeDefined()
    expect(screen.getByText('右侧输出')).toBeDefined()
    // 连并排容器里的输入槽位都不存在（避免「渲染了空面板所以查不到文本」的假绿）
    expect(screen.queryByText('左侧输入')).toBeNull()
  })

  it('note 槽位渲染工具说明文案，且与 options / status 共存', () => {
    render(
      <ToolLayout
        note={<p>本工具全程离线</p>}
        options={<span>附加选项</span>}
        status={<span>状态行</span>}
        output={<p>右侧输出</p>}
      />,
    )

    expect(screen.getByText('本工具全程离线')).toBeDefined()
    expect(screen.getByText('附加选项')).toBeDefined()
    expect(screen.getByText('状态行')).toBeDefined()
    expect(screen.getByText('输出')).toBeDefined()
  })

  it('未传 options / status 时不渲染这两个可选区域', () => {
    render(<ToolLayout output={<p>右侧输出</p>} />)
    expect(screen.queryByText('附加选项')).toBeNull()
    expect(screen.queryByText('状态行')).toBeNull()
  })

  it('传入 options 与 status 时渲染在对应区域', () => {
    render(
      <ToolLayout
        options={<span>附加选项</span>}
        status={<span>状态行</span>}
        output={<p>右侧输出</p>}
      />,
    )
    expect(screen.getByText('附加选项')).toBeDefined()
    expect(screen.getByText('状态行')).toBeDefined()
  })

  it('标准形态的并排断点是 720px，而非 Tailwind 默认的 768px', () => {
    const { container } = render(<ToolLayout output={<p>右侧输出</p>} />)
    const row = container.querySelector('.min-\\[720px\\]\\:flex-row')
    expect(row).not.toBeNull()
    // 默认堆叠（flex-col），到 720px 才转为并排
    expect(row?.className).toContain('flex-col')
  })
})
