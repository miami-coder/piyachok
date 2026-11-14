import { describe, expect, it } from 'vitest'
import {
  DATE_RE,
  dateParam,
  defaultAnalyticsRange,
} from '@/lib/utils/date-range'

describe('dateParam', () => {
  it('валідний YYYY-MM-DD — значення', () => {
    expect(dateParam('2026-11-14')).toBe('2026-11-14')
    expect(dateParam('2026-02-29')).toBe('2026-02-29') // формат перевіряємо, не календар
  })
  it('невалідне — fallback', () => {
    expect(dateParam('14.11.2026')).toBeUndefined()
    expect(dateParam('2026-11')).toBeUndefined()
    expect(dateParam('2026-11-14T10:00')).toBeUndefined()
    expect(dateParam('')).toBeUndefined()
    expect(dateParam(undefined, '2026-11-01')).toBe('2026-11-01')
  })
  it('fallback заданий — повертається на невалідному', () => {
    expect(dateParam('bogus', '2026-11-01')).toBe('2026-11-01')
  })
})

describe('defaultAnalyticsRange', () => {
  it('from — 30 днів до to, обидва у форматі YYYY-MM-DD', () => {
    const { from, to } = defaultAnalyticsRange()
    expect(to).toMatch(DATE_RE)
    expect(from).toMatch(DATE_RE)
    const days =
      (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86400000
    expect(Math.round(days)).toBe(30)
  })
})
