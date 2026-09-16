import { describe, expect, it } from 'vitest'
import { parseDateInput, relativeTime, TIMESTAMP_UNITS, toDateFields } from './date'

/** 断言解析成功并取出值；失败时把错误原样抛出，便于定位 */
function mustParse(text: string, unit?: Parameters<typeof parseDateInput>[1]) {
  const result = parseDateInput(text, unit)
  if (!result.ok) throw new Error(`期望解析成功，实际失败：${result.error}`)
  return result.value
}

const field = (fields: ReturnType<typeof toDateFields>, id: string) =>
  fields.find((item) => item.id === id)?.value

describe('parseDateInput —— 数字型输入', () => {
  it('秒级时间戳：1700000000 → ISO UTC 为 2023-11-14T22:13:20.000Z', () => {
    const parsed = mustParse('1700000000')
    expect(parsed.kind).toBe('timestamp')
    expect(parsed.unit).toBe('seconds')
    expect(parsed.inputFormat).toContain('Unix 时间戳')
    expect(new Date(parsed.epochMs).toISOString()).toBe('2023-11-14T22:13:20.000Z')
  })

  it('毫秒级时间戳：1700000000000 不被误判为秒级', () => {
    const parsed = mustParse('1700000000000')
    expect(parsed.unit).toBe('milliseconds')
    expect(new Date(parsed.epochMs).toISOString()).toBe('2023-11-14T22:13:20.000Z')
  })

  it('微秒 / 纳秒按位数识别并归一到毫秒', () => {
    expect(mustParse('1700000000000000').unit).toBe('microseconds')
    expect(mustParse('1700000000000000000').unit).toBe('nanoseconds')
    expect(mustParse('1700000000000000000').epochMs).toBe(1700000000000)
  })

  it('手动指定单位会覆盖自动判定，并在依据中标注单位', () => {
    const parsed = mustParse('1700000000', 'milliseconds')
    expect(parsed.unit).toBe('milliseconds')
    expect(parsed.epochMs).toBe(1700000000)
    expect(parsed.basis).toContain('用户指定')
    expect(parsed.basis).toContain('毫秒')
  })

  it('歧义数字输入（8 位，例如 20240315）给出判定依据并标记 ambiguous', () => {
    const parsed = mustParse('20240315')
    expect(parsed.ambiguous).toBe(true)
    expect(parsed.basis).toContain('8 位数字')
    expect(parsed.basis).toContain('秒')
  })

  it('常见长度之外的位数不标记为歧义', () => {
    expect(mustParse('1700000000').ambiguous).toBe(false)
    expect(mustParse('1700000000000').ambiguous).toBe(false)
  })

  it('超出可表示范围的时间戳返回错误', () => {
    const result = parseDateInput('999999999999999999999999')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('OUT_OF_RANGE')
  })
})

describe('parseDateInput —— 日期字符串', () => {
  it('ISO 8601（带 Z）按 UTC 解释并标注格式', () => {
    const parsed = mustParse('2024-03-15T08:30:00Z')
    expect(parsed.kind).toBe('date')
    expect(parsed.inputFormat).toBe('ISO 8601')
    expect(parsed.epochMs).toBe(Date.UTC(2024, 2, 15, 8, 30, 0))
    expect(parsed.basis).toContain('时区')
  })

  it('带时区偏移（+08:00）按偏移换算', () => {
    const parsed = mustParse('2024-03-15T08:30:00+08:00')
    expect(parsed.epochMs).toBe(Date.UTC(2024, 2, 15, 0, 30, 0))
  })

  it('偏移把本地日期推到前一天的输入仍然合法', () => {
    const parsed = mustParse('2024-03-01T00:00:00+08:00')
    expect(parsed.epochMs).toBe(Date.UTC(2024, 1, 29, 16, 0, 0))
  })

  it('YYYY-MM-DD 按本地零点解释并标注格式', () => {
    const parsed = mustParse('2024-03-15')
    expect(parsed.inputFormat).toBe('YYYY-MM-DD')
    expect(parsed.epochMs).toBe(new Date(2024, 2, 15).getTime())
  })

  it('YYYY/MM/DD HH:mm:ss 按本地时间解释并标注格式', () => {
    const parsed = mustParse('2024/03/15 08:30:00')
    expect(parsed.inputFormat).toBe('YYYY/MM/DD HH:mm:ss')
    expect(parsed.epochMs).toBe(new Date(2024, 2, 15, 8, 30, 0).getTime())
  })

  it('带毫秒的 ISO 8601 保留毫秒', () => {
    const parsed = mustParse('2024-03-15T08:30:00.250Z')
    expect(parsed.epochMs).toBe(Date.UTC(2024, 2, 15, 8, 30, 0, 250))
  })

  it('不存在的日期（2024-02-31）被拒绝', () => {
    const result = parseDateInput('2024-02-31')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_DATE')
  })

  it('越界的时分秒（25:00）被拒绝', () => {
    const result = parseDateInput('2024-03-15T25:00:00Z')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('INVALID_DATE')
  })

  it('无法识别的输入返回 UNRECOGNIZED_DATE', () => {
    const result = parseDateInput('not-a-date')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('无法识别')
      expect(result.code).toBe('UNRECOGNIZED_DATE')
    }
  })

  it('空输入返回 EMPTY_INPUT', () => {
    const result = parseDateInput('   ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('EMPTY_INPUT')
  })
})

describe('toDateFields —— 多表示之间的自洽', () => {
  it('秒级时间戳乘以 1000 与毫秒级一致，且 ISO UTC 描述同一时刻', () => {
    const parsed = mustParse('1700000000')
    const fields = toDateFields(parsed.epochMs)
    const seconds = Number(field(fields, 'unix-seconds'))
    const milliseconds = Number(field(fields, 'unix-milliseconds'))
    expect(seconds * 1000).toBe(milliseconds)

    const isoField = field(fields, 'iso-utc')
    expect(isoField).toBe('2023-11-14T22:13:20.000Z')
    expect(new Date(isoField ?? '').getTime()).toBe(milliseconds)
  })

  it('输出七项表示，且 RFC 2822 使用数字时区', () => {
    const fields = toDateFields(Date.UTC(2023, 10, 14, 22, 13, 20))
    expect(fields.map((item) => item.id)).toEqual([
      'unix-seconds',
      'unix-milliseconds',
      'iso-utc',
      'iso-local',
      'rfc-2822',
      'localized',
      'relative',
    ])
    expect(field(fields, 'rfc-2822')).toMatch(
      /^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} \+0000$/,
    )
  })

  it('本地 ISO 表示带 ±HH:mm 偏移而非 Z', () => {
    const isoLocal = field(toDateFields(1700000000000), 'iso-local') ?? ''
    expect(isoLocal).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
  })
})

describe('relativeTime —— 相对时间', () => {
  const now = Date.UTC(2024, 2, 15, 8, 30, 0)

  it('同一时刻为「刚刚」', () => {
    expect(relativeTime(now, now)).toBe('刚刚')
  })

  it('过去与未来分别带「前」「后」', () => {
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe('3 天前')
    expect(relativeTime(now + 2 * 3_600_000, now)).toBe('2 小时后')
  })

  it('分钟与年两级同样正确', () => {
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(relativeTime(now + 400 * 86_400_000, now)).toBe('1 年后')
  })
})

describe('TIMESTAMP_UNITS', () => {
  it('提供自动 / 秒 / 毫秒 / 微秒 / 纳秒五个选项', () => {
    expect(TIMESTAMP_UNITS.map((item) => item.value)).toEqual([
      'auto',
      'seconds',
      'milliseconds',
      'microseconds',
      'nanoseconds',
    ])
  })
})
