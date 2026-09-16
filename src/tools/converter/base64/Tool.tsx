import { useEffect, useMemo, useRef, useState } from 'react'
import { bytesToUtf8 } from '@/core/bytes'
import { decodeToBytes, encodeBytes, encodeText, type Base64Variant } from '@/core/converter/base64'
import type { ErrorInfo } from '@/core/result'
import { downloadBytes } from '@/framework/file'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { FileDrop } from '@/framework/ui/FileDrop'
import { Icon } from '@/framework/ui/Icon'
import { Checkbox, SegmentedControl } from '@/framework/ui/Inputs'

type Mode = 'encode' | 'decode'

const INITIAL_STATE = {
  input: '',
  options: {
    mode: 'encode' as Mode,
    variant: 'standard' as Base64Variant,
    padding: true,
  },
}

const MODE_OPTIONS = [
  { value: 'encode' as Mode, label: '编码' },
  { value: 'decode' as Mode, label: '解码' },
]

const VARIANT_OPTIONS = [
  { value: 'standard' as Base64Variant, label: '标准' },
  { value: 'urlsafe' as Base64Variant, label: 'URL-safe' },
]

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

/**
 * 字节下载按钮。
 *
 * 不能复用 `DownloadButton`：它接收的是字符串并对内容做 UTF-8 编码，
 * 而 Base64 解码后的产物必须逐字节落盘（否则二进制内容会被损坏）。
 */
function DownloadBytesButton({ filename, bytes }: { filename: string; bytes: Uint8Array }) {
  const [status, setStatus] = useState<'idle' | 'done' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (
    <button
      type="button"
      onClick={() => {
        void downloadBytes(filename, bytes).then((result) => {
          // 用户主动取消保存不算失败
          if (!result.ok && result.code === 'CANCELLED') return
          setStatus(result.ok ? 'done' : 'failed')
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => setStatus('idle'), 1500)
        })
      }}
      className="inline-flex h-6 items-center gap-1 rounded-sm px-2 text-[12px] text-muted hover:bg-surface-2 hover:text-fg"
    >
      <Icon name={status === 'done' ? 'check' : 'download'} size={13} />
      {status === 'done' ? '已下载' : status === 'failed' ? '下载失败' : '下载文件'}
    </button>
  )
}

type Outcome =
  | { kind: 'encode'; text: string; fromFile: boolean }
  | { kind: 'decode'; bytes: Uint8Array; text: string | null }
  | { kind: 'error'; info: ErrorInfo }

export default function Base64Tool() {
  const { state, update, updateOptions } = useToolState('base64', INITIAL_STATE)
  const { input } = state
  const { mode, variant, padding } = state.options
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null)

  // 依赖全部是原始值或稳定引用（计划① R16：对象依赖会造成无限渲染循环）
  const outcome: Outcome | null = useMemo(() => {
    if (mode === 'encode') {
      if (file) {
        return { kind: 'encode', text: encodeBytes(file.bytes, { variant, padding }), fromFile: true }
      }
      if (input.length === 0) return null
      return { kind: 'encode', text: encodeText(input, { variant, padding }), fromFile: false }
    }

    if (input.trim().length === 0) return null
    const bytes = decodeToBytes(input)
    if (!bytes.ok) return { kind: 'error', info: bytes }
    const text = bytesToUtf8(bytes.value)
    return { kind: 'decode', bytes: bytes.value, text: text.ok ? text.value : null }
  }, [input, mode, variant, padding, file])

  return (
    <ToolLayout
      options={
        <>
          <Field label="方向">
            <SegmentedControl
              label="转换方向"
              options={MODE_OPTIONS}
              value={mode}
              onChange={(next) => {
                updateOptions({ mode: next })
                setFile(null)
              }}
            />
          </Field>
          <Field label="变体">
            <SegmentedControl
              label="Base64 变体"
              options={VARIANT_OPTIONS}
              value={variant}
              onChange={(next) => updateOptions({ variant: next })}
            />
          </Field>
          <Checkbox
            label="包含填充符"
            checked={padding}
            onChange={(next) => updateOptions({ padding: next })}
          />
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              update({ input: '' })
              setFile(null)
            }}
          >
            清空
          </button>
        </>
      }
      input={
        <div className="flex flex-col gap-2 p-2.5">
          <CodeArea
            label={mode === 'encode' ? '待编码的文本' : '待解码的 Base64'}
            value={input}
            rows={8}
            onChange={(value) => {
              setFile(null)
              update({ input: value })
            }}
            placeholder={mode === 'encode' ? '输入任意文本' : '例如 aGVsbG8='}
          />
          {mode === 'encode' && (
            <FileDrop
              label="拖入文件以编码"
              hint="文件只在本地读取，不会离开本机"
              onFile={(dropped) => {
                void dropped.arrayBuffer().then((buffer) => {
                  setFile({ name: dropped.name, bytes: new Uint8Array(buffer) })
                  update({ input: '' })
                })
              }}
            />
          )}
          {file && (
            <p className="flex items-center gap-2 text-[12px] text-muted">
              已选择 {file.name}（{file.bytes.length} 字节）
              <button type="button" className={BUTTON} onClick={() => setFile(null)}>
                移除文件
              </button>
            </p>
          )}
        </div>
      }
      output={
        outcome === null ? (
          <EmptyState
            title="尚未输入"
            hint={mode === 'encode' ? '输入文本或拖入文件即可编码' : '粘贴 Base64 即可解码'}
          />
        ) : outcome.kind === 'error' ? (
          <ErrorNote info={outcome.info} />
        ) : outcome.kind === 'encode' ? (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={outcome.text} label="复制全部" />
              <DownloadButton filename="base64.txt" text={outcome.text} />
            </div>
            <CodeArea value={outcome.text} readOnly label="编码结果" />
          </>
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              {outcome.text !== null && <CopyButton text={outcome.text} label="复制文本" />}
              <DownloadBytesButton filename="decoded.bin" bytes={outcome.bytes} />
            </div>
            {outcome.text === null ? (
              <p className="p-2.5 text-[12px] text-muted">
                解码结果不是合法的 UTF-8 文本，请下载为文件查看。
              </p>
            ) : (
              <CodeArea value={outcome.text} readOnly label="解码结果" />
            )}
          </>
        )
      }
      status={
        outcome === null ? (
          <span>等待输入</span>
        ) : outcome.kind === 'error' ? (
          <span className="text-danger">{outcome.info.error}</span>
        ) : outcome.kind === 'encode' ? (
          <span>
            {outcome.fromFile ? '已对文件字节编码' : '已对文本编码'} · {outcome.text.length} 个字符
          </span>
        ) : (
          <span>已解码 {outcome.bytes.length} 字节</span>
        )
      }
    />
  )
}
