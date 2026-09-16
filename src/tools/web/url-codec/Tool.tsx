import { useMemo } from 'react'
import {
  decodeUrl,
  encodeUrl,
  URL_CODEC_MODES,
  URL_DIRECTIONS,
  type UrlCodecMode,
  type UrlDirection,
} from '@/core/web/url-codec'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { SegmentedControl } from '@/framework/ui/Inputs'

/** 必须定义在组件外部：初始值参与 useToolState 的惰性初始化，每次渲染新建会让依赖持续失效 */
const INITIAL_STATE = {
  input: '',
  options: { direction: 'encode' as UrlDirection, mode: 'component' as UrlCodecMode },
}

const SAMPLES: Record<UrlDirection, string> = {
  encode: 'a b&c=d/路径?x=1',
  decode: 'a%20b%26c%3Dd%2F%E8%B7%AF%E5%BE%84%3Fx%3D1',
}

const MODE_LABEL: Record<UrlCodecMode, string> = {
  component: '组件',
  uri: '整体 URI',
  form: '表单',
}

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

export default function UrlCodecTool() {
  const { state, update, updateOptions } = useToolState('url-codec', INITIAL_STATE)
  const { input } = state
  const { direction, mode } = state.options

  // 依赖全部是原始值（计划① R16：对象依赖会造成无限渲染循环）
  const result = useMemo(() => {
    if (input.length === 0) return null
    return direction === 'encode' ? encodeUrl(input, mode) : decodeUrl(input, mode)
  }, [input, direction, mode])

  return (
    <ToolLayout
      options={
        <>
          <Field label="方向">
            <SegmentedControl
              label="转换方向"
              options={URL_DIRECTIONS}
              value={direction}
              onChange={(next) => updateOptions({ direction: next })}
            />
          </Field>
          <Field label="模式">
            <SegmentedControl
              label="编码模式"
              options={URL_CODEC_MODES}
              value={mode}
              onChange={(next) => updateOptions({ mode: next })}
            />
          </Field>
          <button
            type="button"
            className={BUTTON}
            onClick={() => update({ input: SAMPLES[direction] })}
          >
            填入示例
          </button>
          <button type="button" className={BUTTON} onClick={() => update({ input: '' })}>
            清空
          </button>
        </>
      }
      input={
        <CodeArea
          label="待处理的文本"
          value={input}
          rows={10}
          onChange={(value) => update({ input: value })}
          placeholder={direction === 'encode' ? '输入任意文本或 URL' : '输入含 %XX 转义的内容'}
        />
      }
      output={
        result === null ? (
          <EmptyState
            title="尚未输入"
            hint={direction === 'encode' ? '输入文本即可编码' : '粘贴含 %XX 的内容即可解码'}
          />
        ) : !result.ok ? (
          <ErrorNote info={result} />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={result.value} label="复制" />
            </div>
            <CodeArea value={result.value} readOnly label="结果" />
          </>
        )
      }
      status={
        result === null ? (
          <span>等待输入</span>
        ) : !result.ok ? (
          <span className="text-danger">{result.error}</span>
        ) : (
          <span>
            {MODE_LABEL[mode]}模式{direction === 'encode' ? '编码' : '解码'} · 输出{' '}
            {result.value.length} 字符
          </span>
        )
      }
    />
  )
}
