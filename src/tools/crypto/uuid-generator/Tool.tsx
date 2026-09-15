import { useEffect, useMemo, useState } from 'react'
import { generateUuids, type UuidVersion } from '@/core/crypto/uuid'
import type { ErrorInfo } from '@/core/result'
import { ToolLayout } from '@/framework/ToolLayout'
import { useToolState } from '@/framework/useToolState'
import { CodeArea } from '@/framework/ui/CodeArea'
import { CopyButton } from '@/framework/ui/CopyButton'
import { DownloadButton } from '@/framework/ui/DownloadButton'
import { EmptyState } from '@/framework/ui/EmptyState'
import { ErrorNote } from '@/framework/ui/ErrorNote'
import { Field } from '@/framework/ui/Field'
import { Checkbox, NumberInput, SegmentedControl } from '@/framework/ui/Inputs'

const MAX_COUNT = 1_000

/**
 * 必须定义在组件外部：useToolState 的 reset 依赖它，
 * 每次渲染新建字面量对象会导致该依赖持续变化。
 */
const INITIAL_STATE = {
  input: '',
  options: {
    version: 4 as UuidVersion,
    count: 10,
    hyphens: true,
    uppercase: false,
  },
}

const VERSION_OPTIONS = [
  { value: 'v1', label: 'v1' },
  { value: 'v4', label: 'v4' },
  { value: 'v7', label: 'v7' },
] as const

const VERSION_BY_LABEL: Record<string, UuidVersion> = { v1: 1, v4: 4, v7: 7 }
const LABEL_BY_VERSION: Record<UuidVersion, string> = { 1: 'v1', 4: 'v4', 7: 'v7' }

/** 把规范形式（无连字符、小写）套用为展示形式。 */
function formatCanonical(canonical: string, hyphens: boolean, uppercase: boolean): string {
  const hex = uppercase ? canonical.toUpperCase() : canonical
  if (!hyphens) return hex
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export default function UuidGeneratorTool() {
  const { state, updateOptions } = useToolState('uuid-generator', INITIAL_STATE)
  const { version, count, hyphens, uppercase } = state.options

  // 规范形式：仅 version 与 count 变化时重新生成
  const [canonical, setCanonical] = useState<string[]>([])

  const countError: ErrorInfo | null =
    Number.isInteger(count) && count >= 0 && count <= MAX_COUNT
      ? null
      : {
          error: `数量必须是 0 到 ${MAX_COUNT} 之间的整数`,
          detail: `当前值为 ${count}`,
        }

  // 依赖必须是原始值：countError 在非法时每次渲染都是新对象，直接进 deps 会造成
  //「effect → setCanonical([]) → 重渲染 → 新对象 → effect」死循环
  // （实测：数量非法时界面卡死，测试进程挂起 15 分钟以上）
  const countInvalid = countError !== null

  useEffect(() => {
    if (countInvalid) {
      setCanonical([])
      return
    }
    // 用 try/catch 兜住生成层可能抛出的参数异常
    try {
      setCanonical(generateUuids({ version, count, hyphens: false, uppercase: false }))
    } catch {
      setCanonical([])
    }
  }, [version, count, countInvalid])

  // 格式变更只影响渲染，不触发重新生成
  const rendered = useMemo(
    () => canonical.map((item) => formatCanonical(item, hyphens, uppercase)),
    [canonical, hyphens, uppercase],
  )

  const joined = rendered.join('\n')

  return (
    <ToolLayout
      options={
        <>
          <Field label="版本">
            <SegmentedControl
              label="UUID 版本"
              options={VERSION_OPTIONS}
              value={LABEL_BY_VERSION[version]}
              onChange={(label) => {
                const next = VERSION_BY_LABEL[label]
                if (next !== undefined) updateOptions({ version: next })
              }}
            />
          </Field>

          <Field label="数量">
            <NumberInput
              label="生成数量"
              value={count}
              min={1}
              max={MAX_COUNT}
              onChange={(value) => updateOptions({ count: value })}
            />
          </Field>

          <Checkbox
            label="连字符"
            checked={hyphens}
            onChange={(checked) => updateOptions({ hyphens: checked })}
          />
          <Checkbox
            label="大写"
            checked={uppercase}
            onChange={(checked) => updateOptions({ uppercase: checked })}
          />

          <button
            type="button"
            onClick={() => {
              try {
                setCanonical(
                  generateUuids({ version, count, hyphens: false, uppercase: false }),
                )
              } catch {
                setCanonical([])
              }
            }}
            disabled={countError !== null}
            className="h-6 rounded-sm border border-border bg-surface-2 px-2 text-[12px] hover:border-accent disabled:opacity-40"
          >
            重新生成
          </button>
        </>
      }
      input={
        <div className="p-2.5 text-[12px] text-muted">
          {version === 1 ? (
            <p>
              v1 基于时间戳与节点 ID 生成。本应用的节点 ID 为<strong className="text-fg">会话级随机值</strong>（已按
              RFC 4122 置 multicast 标志），并非本机网卡地址 —— 运行环境无法获取该信息。
            </p>
          ) : version === 4 ? (
            <p>v4 完全随机生成，不含时间或位置信息。</p>
          ) : (
            <p>v7 以毫秒时间戳开头，因而按字典序排列即为时间顺序；同一毫秒内保持单调递增。</p>
          )}
        </div>
      }
      output={
        countError ? (
          <ErrorNote info={countError} />
        ) : rendered.length === 0 ? (
          <EmptyState title="尚未生成" hint="调整上方参数即可生成" />
        ) : (
          <>
            <div className="flex items-center justify-end gap-1 border-b border-border px-1.5 py-1">
              <CopyButton text={joined} label="复制全部" />
              <DownloadButton filename="uuids.txt" text={joined} />
            </div>
            <CodeArea value={joined} readOnly label="生成的 UUID" />
          </>
        )
      }
      status={
        countError ? (
          <span className="text-danger">{countError.error}</span>
        ) : (
          <span>共 {rendered.length} 条</span>
        )
      }
    />
  )
}
