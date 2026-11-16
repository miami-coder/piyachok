import { describe, expect, it } from 'vitest'
import { safeNextPath } from '@/lib/utils/safe-next'

// Рядки, після яких router.push (new URL(href, location.href)) веде на чужий origin
const HOSTILE: [string, string][] = [
  ['protocol-relative', '//evil.com'],
  ['три слеші', '///evil.com'],
  ['слеш+зворотний слеш', '/\\evil.com'],
  ['слеш+два зворотні слеші', '/\\\\evil.com'],
  ['слеш, зворотний слеш, слеш', '/\\/evil.com'],
  ['TAB усередині', '/\t/evil.com'],
  ['LF усередині', '/\n/evil.com'],
  ['CR усередині', '/\r/evil.com'],
  ['TAB + зворотний слеш', '/\t\\evil.com'],
  ['абсолютний https', 'https://evil.com'],
  ['абсолютний http', 'http://evil.com/x'],
  ['без початкового слеша', 'venues/v1'],
  ['javascript:', 'javascript:alert(1)'],
  ['null-байт', '/\u0000/evil.com'],
]

// Лишаються шляхом на нашому origin (відсотково закодовані слеші парсер не розкодовує)
const SAFE = [
  '/',
  '/venues/v1',
  '/account/hangouts?tab=1',
  '/venues/v1?tab=reviews&sort=new',
  '/venues/v1#reviews',
  '/venues/v1?tab=reviews#top',
  '/a?x=%20#hash',
  '/%2F%2Fevil.com',
  '/%2Fevil.com',
  '/%5Cevil.com',
  '/%09/evil.com',
  '/＼evil.com',
]

describe('safeNextPath', () => {
  it.each(HOSTILE)('%s → «/»', (_name, input) => {
    expect(safeNextPath(input)).toBe('/')
  })

  it.each([[null], ['']])('порожнє значення %j → «/»', (input) => {
    expect(safeNextPath(input)).toBe('/')
  })

  it.each(SAFE.map((s) => [s]))('безпечний маршрут %s повертається без змін', (input) => {
    expect(safeNextPath(input)).toBe(input)
  })

  // Перевірка тим самим парсером, що й router.push: результат ніколи не виходить за origin
  it.each([...HOSTILE.map(([, v]) => v), ...SAFE])('результат для %j лишається на нашому origin', (input) => {
    const resolved = new URL(safeNextPath(input), 'http://localhost:3001')
    expect(resolved.origin).toBe('http://localhost:3001')
  })
})
