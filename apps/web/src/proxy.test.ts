import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy } from '@/proxy'

const expiredJwt = () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 10 }))
    .toString('base64url')
  return `hdr.${payload}.sig`
}
const freshJwt = () => {
  const payload = Buffer.from(JSON.stringify({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 }))
    .toString('base64url')
  return `hdr.${payload}.sig`
}

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const makeRequest = (session?: string) => {
  const cookieValue = session === undefined ? '' : encodeURIComponent(session)
  return new NextRequest('http://l/account', {
    headers: new Headers(cookieValue ? { cookie: `piyachok_session=${cookieValue}` } : {}),
  })
}

describe('proxy: продовження сесії перед SSR', () => {
  it('куки немає → passthrough без викликів на бекенд', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await proxy(makeRequest())
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(res.headers.getSetCookie()).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('access-токен свіжий → passthrough без refresh', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await proxy(makeRequest(JSON.stringify({ accessToken: freshJwt(), refreshToken: 'RT' })))
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(res.headers.getSetCookie()).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('access прострочений → refresh, ротація куки в відповідь і в запит', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonRes({ accessToken: 'NEW_AT', refreshToken: 'NEW_RT' }, 201))
    vi.stubGlobal('fetch', fetchMock)

    const req = makeRequest(JSON.stringify({ accessToken: expiredJwt(), refreshToken: 'RT' }))
    const res = await proxy(req)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]![0]).toContain('/auth/refresh')

    // Ротація в браузер: Set-Cookie з новими токенами
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('piyachok_session='))
    expect(setCookie).toBeDefined()
    expect(setCookie).toContain('NEW_AT')
    // Ротація в поточний запит: рендер нижче побачить свіжі токени
    expect(req.cookies.get('piyachok_session')?.value).toContain('NEW_AT')
  })

  it('refresh помер → passthrough без ротації (layout сам покаже логін)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await proxy(makeRequest(JSON.stringify({ accessToken: expiredJwt(), refreshToken: 'RT' })))
    expect(res.headers.get('x-middleware-next')).toBe('1')
    expect(res.headers.getSetCookie()).toEqual([])
  })
})
