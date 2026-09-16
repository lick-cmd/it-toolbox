import { err, ok } from '../result'
import type { Result } from '../result'

/**
 * 时间戳单位。
 *
 * `auto` 仅表示「由位数自动判定」这一模式本身，不会出现在解析结果里 ——
 * 结果中的 `unit` 一律是四个具体单位之一，便于界面直接标注。
 */
export type TimestampUnit = 'auto' | 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds'

export type ResolvedUnit = Exclude<TimestampUnit, 'auto'>

export interface TimestampUnitOption {
  value: TimestampUnit
  label: string
}

/** 界面下拉的唯一事实源（顺序即展示顺序）。 */
export const TIMESTAMP_UNITS: readonly TimestampUnitOption[] = [
  { value: 'auto', label: '自动' },
  { value: 'seconds', label: '秒' },
  { value: 'milliseconds', label: '毫秒' },
  { value: 'microseconds', label: '微秒' },
  { value: 'nanoseconds', label: '纳秒' },
]

export interface DateParse {
  /** 毫秒时间戳 */
  epochMs: number
  kind: 'timestamp' | 'date'
  /** 仅 kind === 'timestamp' 时存在 */
  unit?: ResolvedUnit
  /** 判定依据（中文），界面原样展示 */
  basis: string
  /** 识别出的输入格式（中文），界面原样展示 */
  inputFormat: string
  /** 位数不典型的纯数字输入：可能有多种解释 */
  ambiguous: boolean
}

export interface DateField {
  id: string
  label: string
  value: string
}

const UNIT_LABEL: Record<ResolvedUnit, string> = {
  seconds: '秒',
  milliseconds: '毫秒',
  microseconds: '微秒',
  nanoseconds: '纳秒',
}

/** 1 个该单位等于多少毫秒。微秒 / 纳秒是小数，故换算后再取整 */
const MS_PER_UNIT: Record<ResolvedUnit, number> = {
  seconds: 1000,
  milliseconds: 1,
  microseconds: 1 / 1000,
  nanoseconds: 1 / 1_000_000,
}

const NUMERIC = /^[+-]?\d+$/

/**
 * 日期时间字面量。
 *
 * 用显式正则 + 手工构造 Date，而不是 `Date.parse`：V8 与 JavaScriptCore 对
 * 非标准格式的容忍度不同（`2024/03/15` 在两家实现里都可能被当成 UTC），
 * 而 spec 要求 ISO UTC 与本地时间都能稳定复现。这与 `core/json/scanner.ts`
 * 放弃 `JSON.parse` 的报错是同一个理由。
 *
 * 分组：1=年 2=分隔符 3=月 4=日 5=时 6=分 7=秒 8=毫秒 9=Z 10=时区符号 11=时区小时 12=时区分钟
 */
const DATE_TIME =
  /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(?:([Zz])|([+-])(\d{2}):?(\d{2}))?$/

/**
 * 按位数推断时间戳单位。
 *
 * 常见长度：10 位（秒）、13 位（毫秒）、16 位（微秒）、19 位（纳秒）。
 * 8 位是唯一的典型歧义长度 —— 它既可能是很早的秒级时间戳，也可能是
 * 紧写的 `YYYYMMDD`，故单独标记出来让界面提示用户手动指定。
 */
function detectUnit(digits: number): { unit: ResolvedUnit; ambiguous: boolean } {
  if (digits <= 10) return { unit: 'seconds', ambiguous: digits === 8 }
  if (digits <= 13) return { unit: 'milliseconds', ambiguous: false }
  if (digits <= 16) return { unit: 'microseconds', ambiguous: false }
  return { unit: 'nanoseconds', ambiguous: false }
}

/** 某年某月的天数（月份为 1..12）。用 UTC 计算以避开本地时区与夏令时。 */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * 日历字段的合法性校验。
 *
 * 不能用「构造 Date 再回读字段」来校验：带时区偏移的输入（如
 * `2024-03-01T00:00:00+08:00`）换算成 UTC 后会落到上个月的最后一天，
 * 回读比对会把合法输入误判为「不存在的日期」。因此直接校验**书写出来的**
 * 那组年月日时分秒。
 */
function isValidDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  if (month < 1 || month > 12) return false
  if (day < 1 || day > daysInMonth(year, month)) return false
  if (hour > 23 || minute > 59 || second > 59) return false
  return true
}

function finish(epochMs: number, partial: Omit<DateParse, 'epochMs'>): Result<DateParse> {
  if (!Number.isFinite(epochMs)) {
    return err('时间戳超出可表示范围', { code: 'OUT_OF_RANGE' })
  }
  const probe = new Date(epochMs)
  if (Number.isNaN(probe.getTime())) {
    return err('时间戳超出可表示范围', {
      code: 'OUT_OF_RANGE',
      detail: `无法转换为日期：${epochMs}`,
    })
  }
  return ok({ epochMs, ...partial })
}

function parseNumeric(text: string, requested: TimestampUnit): Result<DateParse> {
  const raw = Number(text)
  if (!Number.isFinite(raw)) {
    return err('时间戳超出可表示范围', { code: 'OUT_OF_RANGE' })
  }

  const digits = text.replace(/^[+-]/, '').length
  const detected = detectUnit(digits)
  const unit = requested === 'auto' ? detected.unit : requested
  const ambiguous = requested === 'auto' && detected.ambiguous

  // 秒 / 毫秒的换算在安全整数范围内是精确的；微秒 / 纳秒会落到小数毫秒，
  // 而 spec 的「秒 × 1000 == 毫秒」断言要求毫秒侧是整数，故此处取整。
  const exact = unit === 'seconds' || unit === 'milliseconds'
  const epochMs = exact ? raw * MS_PER_UNIT[unit] : Math.round(raw * MS_PER_UNIT[unit])

  return finish(epochMs, {
    kind: 'timestamp',
    unit,
    ambiguous,
    inputFormat: `Unix 时间戳（${UNIT_LABEL[unit]}）`,
    basis:
      requested === 'auto'
        ? `${digits} 位数字，按${UNIT_LABEL[unit]}级时间戳解释`
        : `按用户指定的${UNIT_LABEL[unit]}级时间戳解释`,
  })
}

function parseDateTimeString(text: string): Result<DateParse> {
  const match = DATE_TIME.exec(text)
  if (!match) {
    return err('无法识别的日期格式', {
      code: 'UNRECOGNIZED_DATE',
      detail: `"${text}" 不在支持的格式内`,
      suggestion: '支持 Unix 时间戳、ISO 8601、YYYY-MM-DD、YYYY/MM/DD HH:mm:ss',
    })
  }

  const year = Number(match[1])
  const separator = match[2]
  const month = Number(match[3])
  const day = Number(match[4])
  const hasTime = match[5] !== undefined
  const hour = hasTime ? Number(match[5]) : 0
  const minute = hasTime ? Number(match[6]) : 0
  const second = match[7] === undefined ? 0 : Number(match[7])
  const millisecond = match[8] === undefined ? 0 : Number(match[8].padEnd(3, '0'))

  const utcMarker = match[9]
  const offsetSign = match[10]
  let offsetMinutes = 0
  let hasZone = false
  if (utcMarker !== undefined) {
    hasZone = true
  } else if (offsetSign !== undefined) {
    hasZone = true
    const magnitude = Number(match[11]) * 60 + Number(match[12])
    offsetMinutes = offsetSign === '-' ? -magnitude : magnitude
  }

  if (!isValidDateTime(year, month, day, hour, minute, second)) {
    return err('日期不存在', {
      code: 'INVALID_DATE',
      detail: `${text} 的年月日或时分秒组合越界`,
    })
  }

  const epochMs = hasZone
    ? Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - offsetMinutes * 60_000
    : new Date(year, month - 1, day, hour, minute, second, millisecond).getTime()

  const datePart = separator === '/' ? 'YYYY/MM/DD' : 'YYYY-MM-DD'
  return finish(epochMs, {
    kind: 'date',
    ambiguous: false,
    inputFormat: hasZone ? 'ISO 8601' : `${datePart}${hasTime ? ' HH:mm:ss' : ''}`,
    basis: hasZone ? '含时区信息，按带时区的绝对时刻解释' : '不含时区，按本地时间解释',
  })
}

/**
 * 解析日期 / 时间戳输入。
 *
 * 纯数字走时间戳分支（可被 `unit` 覆盖判定），其余走日期字面量分支。
 * 两条分支的错误都以 `Result` 返回 —— 解析类操作的非法输入是常规路径。
 */
export function parseDateInput(text: string, unit: TimestampUnit = 'auto'): Result<DateParse> {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return err('请输入日期或时间戳', { code: 'EMPTY_INPUT' })
  }
  return NUMERIC.test(trimmed) ? parseNumeric(trimmed, unit) : parseDateTimeString(trimmed)
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/** 本地时间的 ISO 8601 形式（带 `±HH:mm` 偏移，而不是 Z） */
function isoLocal(epochMs: number): string {
  const date = new Date(epochMs)
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const magnitude = Math.abs(offsetMinutes)
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(magnitude / 60))}:${pad(magnitude % 60)}`
  )
}

const RFC_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const RFC_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

/** RFC 2822 用数字时区（`+0000`），此处统一按 UTC 输出 */
function rfc2822(epochMs: number): string {
  const date = new Date(epochMs)
  return (
    `${RFC_DAYS[date.getUTCDay()]}, ${date.getUTCDate()} ${RFC_MONTHS[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} +0000`
  )
}

/**
 * 相对时间。
 *
 * `now` 可注入，使单测不依赖真实时钟（否则「刚刚」与「3 天前」无法稳定断言）。
 */
export function relativeTime(epochMs: number, now: number = Date.now()): string {
  const diff = epochMs - now
  const abs = Math.abs(diff)
  if (abs < 1000) return '刚刚'

  const suffix = diff > 0 ? '后' : '前'
  const seconds = Math.round(abs / 1000)
  if (seconds < 60) return `${seconds} 秒${suffix}`

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟${suffix}`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 小时${suffix}`

  const days = Math.round(hours / 24)
  if (days < 30) return `${days} 天${suffix}`

  const months = Math.round(days / 30)
  if (months < 12) return `${months} 个月${suffix}`

  return `${Math.round(months / 12)} 年${suffix}`
}

/** 同一个时刻的七种表示，顺序即界面顺序。 */
export function toDateFields(epochMs: number, now: number = Date.now()): DateField[] {
  const date = new Date(epochMs)
  return [
    { id: 'unix-seconds', label: 'Unix 时间戳（秒）', value: String(Math.floor(epochMs / 1000)) },
    { id: 'unix-milliseconds', label: 'Unix 时间戳（毫秒）', value: String(epochMs) },
    { id: 'iso-utc', label: 'ISO 8601（UTC）', value: date.toISOString() },
    { id: 'iso-local', label: 'ISO 8601（本地）', value: isoLocal(epochMs) },
    { id: 'rfc-2822', label: 'RFC 2822', value: rfc2822(epochMs) },
    {
      id: 'localized',
      label: '本地化日期时间',
      value: date.toLocaleString('zh-CN', { hour12: false }),
    },
    { id: 'relative', label: '相对时间', value: relativeTime(epochMs, now) },
  ]
}

/** 把毫秒时间戳格式化为可回填输入框的本地日期时间（`YYYY-MM-DDTHH:mm:ss`） */
export function toLocalInput(epochMs: number): string {
  const date = new Date(epochMs)
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

export interface DateShortcut {
  id: string
  label: string
  /** 语义说明，作为按钮的 title */
  hint: string
  /** 按给定时刻算出对应的**本地**毫秒时间戳 */
  at: (now: number) => number
}

/**
 * 常用时间快捷入口。
 *
 * 全部按本地时区取整点边界，且用 `new Date(y, m, d + delta)` 这类本地字段构造，
 * 而不是加减固定毫秒数 —— 后者跨夏令时切换会整体偏一小时。溢出（如 1 月减一个月）
 * 由 `Date` 自行归一化，无需手工借位。
 */
export const DATE_SHORTCUTS: readonly DateShortcut[] = [
  { id: 'now', label: '当前时间', hint: '此刻', at: (now) => now },
  { id: 'today', label: '今天', hint: '今天 00:00:00', at: (now) => startOfLocalDay(now) },
  { id: 'yesterday', label: '昨天', hint: '昨天 00:00:00', at: (now) => startOfLocalDay(now, -1) },
  { id: 'this-month', label: '本月', hint: '本月 1 日 00:00:00', at: (now) => startOfLocalMonth(now, 0) },
  { id: 'last-month', label: '上个月', hint: '上月 1 日 00:00:00', at: (now) => startOfLocalMonth(now, -1) },
  { id: 'this-year', label: '今年', hint: '本年 1 月 1 日 00:00:00', at: (now) => startOfLocalYear(now, 0) },
  { id: 'last-year', label: '上一年', hint: '上年 1 月 1 日 00:00:00', at: (now) => startOfLocalYear(now, -1) },
]

function startOfLocalDay(now: number, dayOffset = 0): number {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset).getTime()
}

function startOfLocalMonth(now: number, monthOffset: number): number {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth() + monthOffset, 1).getTime()
}

function startOfLocalYear(now: number, yearOffset: number): number {
  const date = new Date(now)
  return new Date(date.getFullYear() + yearOffset, 0, 1).getTime()
}
