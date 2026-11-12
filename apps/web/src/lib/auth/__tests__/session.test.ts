import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeTokens, encodeTokens, isAccessStale, refreshTokens, sessionCookieOptions } from '@/lib/auth/session'

afterEach(() => vi.unstubAllGlobals())

describe('сесійний cookie', () => {
  it('encode → decode дає ті самі токени', () => {
    const t = { accessToken: 'a.b.c', refreshToken: 'r.d.e' }
    expect(decodeTokens(encodeTokens(t))).toEqual(t)
  })
  it('decode null/сміття/порожній JSON → null', () => {
    expect(decodeTokens(undefined)).toBeNull()
    expect(decodeTokens('not-json')).toBeNull()
    expect(decodeTokens('{}')).toBeNull() // немає обох полів
  })
  it('опції cookie: httpOnly, lax, 30 днів', () => {
    const o = sessionCookieOptions()
    expect(o.httpOnly).toBe(true)
    expect(o.sameSite).toBe('lax')
    expect(o.path).toBe('/')
    expect(o.maxAge).toBe(30 * 24 * 3600)
  })
})

describe('refreshTokens', () => {
  it('201 з новими токенами → повертає їх', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ accessToken: 'NEW_AT', refreshToken: 'NEW_RT' }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    )))
    expect(await refreshTokens('RT')).toEqual({ accessToken: 'NEW_AT', refreshToken: 'NEW_RT' })
  })
  it('401 → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })))
    expect(await refreshTokens('DEAD')).toBeNull()
  })
  it('мережева помилка → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))
    expect(await refreshTokens('RT')).toBeNull()
  })
})

describe('isAccessStale', () => {
  const makeJwt = (exp: number) => {
    const payload = Buffer.from(JSON.stringify({ sub: 'u1', exp })).toString('base64url')
    return `hdr.${payload}.sig`
  }
  it('exp у майбутньому → не прострочений', () => {
    expect(isAccessStale(makeJwt(Math.floor(Date.now() / 1000) + 3600))).toBe(false)
  })
  it('exp у минулому → прострочений', () => {
    expect(isAccessStale(makeJwt(Math.floor(Date.now() / 1000) - 10))).toBe(true)
  })
  it('exp за хвилину → прострочений (буфер 60с)', () => {
    expect(isAccessStale(makeJwt(Math.floor(Date.now() / 1000) + 30))).toBe(true)
  })
  it('без exp / не-JWT / кривий payload → не прострочений (не чіпаємо)', () => {
    expect(isAccessStale(`hdr.${Buffer.from(JSON.stringify({ sub: 'u1' })).toString('base64url')}.sig`)).toBe(false)
    expect(isAccessStale('not-a-jwt')).toBe(false)
    expect(isAccessStale(`hdr.${Buffer.from('спроба').toString('base64url')}.sig`)).toBe(false)
  })
})
