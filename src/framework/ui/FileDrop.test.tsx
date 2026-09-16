import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FileDrop } from './FileDrop'

describe('FileDrop', () => {
  it('通过文件选择触发的选择会把 File 交给 onFile', async () => {
    const onFile = vi.fn()
    render(<FileDrop onFile={onFile} label="拖入文件" />)

    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' })
    await userEvent.upload(screen.getByLabelText('拖入文件'), file)

    expect(onFile).toHaveBeenCalledTimes(1)
    expect((onFile.mock.calls[0]?.[0] as File).name).toBe('hello.txt')
  })

  it('拖放文件同样会触发 onFile', () => {
    const onFile = vi.fn()
    render(<FileDrop onFile={onFile} label="拖入文件" />)

    const dropZone = screen.getByText('拖入文件').closest('div')
    expect(dropZone).not.toBeNull()

    fireEvent.drop(dropZone!, { dataTransfer: { files: [new File(['world'], 'world.bin')] } })

    expect(onFile).toHaveBeenCalledTimes(1)
    expect((onFile.mock.calls[0]?.[0] as File).name).toBe('world.bin')
  })

  it('disabled 时拖放与按钮都不触发 onFile', () => {
    const onFile = vi.fn()
    render(<FileDrop onFile={onFile} label="拖入文件" disabled />)

    fireEvent.drop(screen.getByText('拖入文件').closest('div')!, {
      dataTransfer: { files: [new File(['x'], 'x.bin')] },
    })

    expect(onFile).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: '选择文件' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('提示文案与自定义 label 都会渲染', () => {
    render(<FileDrop onFile={vi.fn()} label="拖入文件以编码" hint="文件不会离开本机" />)
    expect(screen.getByText('拖入文件以编码')).toBeDefined()
    expect(screen.getByText('文件不会离开本机')).toBeDefined()
    expect(screen.getByLabelText('拖入文件以编码')).toBeDefined()
  })
})
