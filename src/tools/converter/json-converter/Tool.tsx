import { useMemo } from 'react'
import { utf8ByteLength } from '@/core/bytes'
import { jsonToCsv } from '@/core/converter/json-to-csv'
import { jsonToJs } from '@/core/converter/json-to-js'
import { jsonToPhp } from '@/core/converter/json-to-php'
import { jsonToXml } from '@/core/converter/json-to-xml'
import { jsonToYaml } from '@/core/converter/yaml'
import type { JsonIndent } from '@/core/json/format'
import { hasUnsafeInteger } from '@/core/json/nodes'
import type { Result } from '@/core/result'
import { ToolLayout } from '@/framework/ToolLayout'
import type { ToolProps } from '@/framework/types'
import type { SelectOption } from '@/framework/ui'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Checkbox, SegmentedControl, Select, ToolbarRow } from '@/framework/ui/Inputs'
import { useToolState } from '@/framework/useToolState'

// 若 lint 报 import 顺序，按仓库规则跑 `npx eslint --fix src/tools/converter/json-converter/Tool.tsx`

type FormatChoice = 'js' | 'php' | 'yaml' | 'csv' | 'xml'
type IndentChoice = '2' | '4' | 'tab'

const FORMAT_OPTIONS: readonly SelectOption<FormatChoice>[] = [
  { value: 'js', label: 'JS' },
  { value: 'php', label: 'PHP' },
  { value: 'yaml', label: 'YAML' },
  { value: 'csv', label: 'CSV' },
  { value: 'xml', label: 'XML' },
]

const INDENT_OPTIONS: readonly SelectOption<IndentChoice>[] = [
  { value: '2', label: '2 空格' },
  { value: '4', label: '4 空格' },
  { value: 'tab', label: '制表符' },
]

type UnicodeChoice = 'keep' | 'escape' | 'unescape'

/** 文案与 json-format 姊妹实现保持一致（同一份 spec §5.3 / §8.2） */
const UNICODE_OPTIONS: readonly SelectOption<UnicodeChoice>[] = [
  { value: 'keep', label: '原样' },
  { value: 'escape', label: '转义' },
  { value: 'unescape', label: '反转义' },
]

const FORMAT_META: Record<
  FormatChoice,
  { filename: string; mime: string; codeLabel: string; hint: string }
> = {
  js: {
    filename: 'data.js',
    mime: 'text/javascript;charset=utf-8',
    codeLabel: 'JS 结果',
    hint: '粘贴 JSON 即可得到 JS 对象字面量',
  },
  php: {
    filename: 'data.php',
    mime: 'text/plain;charset=utf-8',
    codeLabel: 'PHP 结果',
    hint: '粘贴 JSON 即可得到 PHP 数组字面量',
  },
  yaml: {
    filename: 'data.yaml',
    mime: 'application/yaml;charset=utf-8',
    codeLabel: 'YAML 结果',
    hint: '粘贴 JSON 即可得到 YAML',
  },
  csv: {
    filename: 'data.csv',
    mime: 'text/csv;charset=utf-8',
    codeLabel: 'CSV 结果',
    hint: '粘贴 JSON 数组即可得到表格',
  },
  xml: {
    filename: 'data.xml',
    mime: 'application/xml;charset=utf-8',
    codeLabel: 'XML 结果',
    hint: '粘贴 JSON 即可得到 XML',
  },
}

/** 缩进选项对 CSV 无意义，且 YAML 规范禁止制表符缩进 */
const NO_INDENT_FORMATS: ReadonlySet<FormatChoice> = new Set<FormatChoice>(['csv'])

/**
 * ① 「保留转义」/ ② 「Unicode 转码」只对 JS / PHP 生效。
 *
 * CSV（spec §8.2「CSV 时禁用」）、YAML、XML 下不渲染这两个控件：YAML 的 `jsonToYaml`
 * 签名没有这两个选项且由 js-yaml 重建输出、XML 的文本节点语义 spec 未规定 —— 渲染一个
 * 点了没反应的控件骗人，故与上方「缩进对 CSV」的既有做法一致，用不渲染表达不可交互。
 * （框架层 `Checkbox` / `SegmentedControl` 没有 `disabled` 属性，本轮不改 framework/。）
 */
const ESCAPE_AWARE_FORMATS: ReadonlySet<FormatChoice> = new Set<FormatChoice>(['js', 'php'])

const INITIAL_STATE = {
  input: '',
  options: {
    format: 'js' as FormatChoice,
    indent: '2' as IndentChoice,
    wrapArrayItems: false,
    keepEscapes: true,
    unicode: 'keep' as UnicodeChoice,
  },
}

const SAMPLE = '{"name":"it-toolbox","tags":["json","工具"],"meta":{"ok":true,"n":null}}'

const BUTTON = 'h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent'

function toJsonIndent(choice: IndentChoice): JsonIndent {
  if (choice === 'tab') return 'tab'
  return choice === '2' ? 2 : 4
}

export default function JsonConverterTool({ handoff, onNavigate }: ToolProps) {
  const { state, update, updateOptions } = useToolState('json-converter', INITIAL_STATE, handoff)
  const { input } = state
  const { format, indent, wrapArrayItems, keepEscapes, unicode } = state.options

  const inputBytes = utf8ByteLength(input)
  const isEmpty = input.trim().length === 0

  const converted = useMemo<Result<string> | null>(() => {
    if (isEmpty) return null
    const indentValue = toJsonIndent(indent)
    switch (format) {
      case 'js':
        return jsonToJs(input, { indent: indentValue, keepEscapes, unicode })
      case 'php':
        return jsonToPhp(input, { indent: indentValue, keepEscapes, unicode })
      // YAML 规范禁止制表符缩进，选 tab 时降级为 2 空格
      case 'yaml':
        return jsonToYaml(input, { indent: indent === '4' ? 4 : 2 })
      case 'csv':
        return jsonToCsv(input)
      case 'xml':
        return jsonToXml(input, { indent: indentValue, wrapArrayItems })
      default:
        // 持久化 / handoff 的 options 不校验 schema（useToolState 原样合入）：
        // 运行时的非法 format 落到与索引兜底同一套的默认格式，不把 undefined 抛进错误边界。
        return jsonToJs(input, { indent: indentValue, keepEscapes, unicode })
    }
  }, [isEmpty, input, format, indent, wrapArrayItems, keepEscapes, unicode])

  const output = converted !== null && converted.ok ? converted.value : null
  // 非法 format 时索引出 undefined，同样兜底到 JS，避免渲染路径抛错
  const meta = FORMAT_META[format] ?? FORMAT_META.js

  // YAML 经 js-yaml 重建，超大整数会丢精度 —— 如实提示，而不是假装没事
  const yamlPrecisionLoss = useMemo(
    () => format === 'yaml' && output !== null && hasUnsafeInteger(input),
    [format, output, input],
  )

  // CSV 的 BOM 只加在下载路径：复制要走纯净文本，否则粘到哪里都带一个不可见字符
  const downloadText = format === 'csv' && output !== null ? `\ufeff${output}` : (output ?? '')

  return (
    <ToolLayout
      options={
        // 控件变多，照 json-format/Tool.tsx（R32）定下的形状：列容器 + 两个 ToolbarRow
        <div className="flex w-full flex-col gap-y-2">
          <ToolbarRow>
            <Select
              label="目标格式"
              options={FORMAT_OPTIONS}
              value={format}
              onChange={(next) => updateOptions({ format: next })}
            />
            {!NO_INDENT_FORMATS.has(format) && (
              <SegmentedControl
                label="缩进"
                options={INDENT_OPTIONS}
                value={indent}
                onChange={(next) => updateOptions({ indent: next })}
              />
            )}
            {format === 'xml' && (
              <Checkbox
                label="数组用 item 包裹"
                checked={wrapArrayItems}
                onChange={(checked) => updateOptions({ wrapArrayItems: checked })}
              />
            )}
            {ESCAPE_AWARE_FORMATS.has(format) && (
              <>
                <Checkbox
                  label="保留转义"
                  checked={keepEscapes}
                  onChange={(checked) => updateOptions({ keepEscapes: checked })}
                />
                <SegmentedControl
                  label="Unicode 转码"
                  options={UNICODE_OPTIONS}
                  value={unicode}
                  onChange={(next) => updateOptions({ unicode: next })}
                />
              </>
            )}
          </ToolbarRow>
          <ToolbarRow>
            <button type="button" className={BUTTON} onClick={() => update({ input: SAMPLE })}>
              填入示例
            </button>
            <button type="button" className={BUTTON} onClick={() => update({ input: '' })}>
              清空
            </button>
            <button
              type="button"
              className={BUTTON}
              disabled={isEmpty}
              onClick={() => onNavigate?.('json-format', { input })}
            >
              去美化
            </button>
          </ToolbarRow>
        </div>
      }
      input={
        <CodeArea
          label="JSON 源码"
          value={input}
          rows={12}
          onChange={(value) => update({ input: value })}
          placeholder={'{"name":"toolbox"}'}
        />
      }
      output={
        converted === null ? (
          <EmptyState title="尚未输入" hint={meta.hint} />
        ) : !converted.ok ? (
          <ErrorNote info={converted} />
        ) : (
          <>
            {yamlPrecisionLoss && (
              <p className="border-b border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-warn">
                YAML 输出由 js-yaml 重新序列化，输入中的超大整数会丢精度（JS 只保证 2^53 以内的整数精确）。
                需要保真请改用 JS / PHP / XML。
              </p>
            )}
            <div className="flex items-center justify-between gap-2 border-b border-border px-1.5 py-1">
              <span className="text-[11px] text-muted">{meta.codeLabel}</span>
              <span className="flex items-center gap-1">
                <CopyButton text={output ?? ''} label="复制" />
                <DownloadButton
                  filename={meta.filename}
                  text={downloadText}
                  mime={meta.mime}
                  label="下载"
                />
              </span>
            </div>
            <CodeArea value={output ?? ''} readOnly label={meta.codeLabel} />
          </>
        )
      }
      status={
        converted === null ? (
          <span>等待输入</span>
        ) : !converted.ok ? (
          <span className="text-danger">{converted.error}</span>
        ) : (
          <span>
            {meta.codeLabel}
            {format === 'yaml' && indent === 'tab' ? ' · 制表符已降级为 2 空格' : ''}
            {format === 'csv' ? ' · 下载含 BOM' : ''} · {inputBytes} → {output?.length ?? 0} 字符
          </span>
        )
      }
    />
  )
}
