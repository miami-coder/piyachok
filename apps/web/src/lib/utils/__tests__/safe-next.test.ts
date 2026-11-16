import { describe, expect, it } from 'vitest'
import { safeNextPath } from '@/lib/utils/safe-next'

describe('safeNextPath', () => {
  it.each([
    ['/', '/'],
    ['/venues/v1', '/venues/v1'],
    ['/account/hangouts?tab=1', '/account/hangouts?tab=1'],
  ])('внутрішній шлях %s лишається', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected)
  })

  it.each([
    ['null', null],
    ['порожній рядок', ''],
    ['protocol-relative', '//evil.com'],
    ['абсолютний https', 'https://evil.com'],
    ['абсолютний http', 'http://evil.com/x'],
    ['відносний без слеша', 'venues/v1'],
    ['javascript:', 'javascript:alert(1)'],
  ])('%s → «/»', (_name, input) => {
    expect(safeNextPath(input)).toBe('/')
  })
})
