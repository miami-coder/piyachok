import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { parseData, parseEmpty, parseEnvelope, parseList } from '@/lib/api/parse'

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('parseData', () => {
  it('розгортає {data: T}', async () => {
    const res = jsonRes({ data: { id: '1' } })
    expect(await parseData<{ id: string }>(res)).toEqual({ id: '1' })
  })
  it('кидає ApiError з полів error бекенда', async () => {
    const res = jsonRes({ error: { code: 'NOT_FOUND', message: 'Заклад не знайдено', details: null } }, 404)
    await expect(parseData(res)).rejects.toMatchObject({
      status: 404, code: 'NOT_FOUND', message: 'Заклад не знайдено',
    })
  })
  it('кидає ApiError INTERNAL_ERROR при несподіваному тілі', async () => {
    const res = jsonRes({ smth: 'wrong' })
    // тіло 2xx-відповіді вже прочитане — помилка конструюється без повторного res.json()
    await expect(parseData(res)).rejects.toMatchObject({
      status: 200, code: 'INTERNAL_ERROR', message: 'Сервіс тимчасово недоступний', details: null,
    })
  })
  it('не-JSON error-тіло (HTML 502) → ApiError INTERNAL_ERROR', async () => {
    const res = new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } })
    await expect(parseData(res)).rejects.toMatchObject({
      status: 502, code: 'INTERNAL_ERROR', message: 'Сервіс тимчасово недоступний',
    })
  })
})

describe('parseList', () => {
  it('повертає data + meta', async () => {
    const res = jsonRes({ data: [{ a: 1 }], meta: { page: 1, limit: 20, total: 1, hasMore: false } })
    expect(await parseList<{ a: number }>(res)).toEqual({
      data: [{ a: 1 }],
      meta: { page: 1, limit: 20, total: 1, hasMore: false },
    })
  })
  it('meta з рядкових значень коерціюється в числа', async () => {
    const res = jsonRes({ data: [1], meta: { page: '2', limit: '20', total: '40', hasMore: 1 } })
    expect(await parseList<number>(res)).toEqual({
      data: [1],
      meta: { page: 2, limit: 20, total: 40, hasMore: true },
    })
  })
})

describe('parseEmpty', () => {
  it('порожнє тіло (DELETE → 200) → undefined, без кидка', async () => {
    const res = new Response('', { status: 200 })
    expect(await parseEmpty(res)).toBeUndefined()
  })
  it('JSON-конверт з data — розгортає, як parseData', async () => {
    const res = jsonRes({ data: { venueId: 'v1' } }, 201)
    expect(await parseEmpty<{ venueId: string }>(res)).toEqual({ venueId: 'v1' })
  })
  it('ok → void, !ok → ApiError', async () => {
    await expect(parseEmpty(new Response(null, { status: 200 }))).resolves.toBeUndefined()
    const res403 = new Response(
      JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Не ваш відгук', details: null } }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )
    await expect(parseEmpty(res403)).rejects.toMatchObject({ status: 403, message: 'Не ваш відгук' })
  })
})

describe('parseEnvelope — контракти та не-JSON 2xx', () => {
  afterEach(() => vi.restoreAllMocks())

  it('не-JSON 2xx-тіло (HTML від проксі) → ApiError, а не сирим SyntaxError', async () => {
    const res = new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } })
    await expect(parseData(res)).rejects.toMatchObject({
      status: 200, code: 'INTERNAL_ERROR', message: 'Сервіс тимчасово недоступний',
    })
  })

  it('порожнє тіло без allowEmpty → ApiError', async () => {
    const res = new Response('', { status: 200 })
    await expect(parseData(res)).rejects.toMatchObject({ status: 200, code: 'INTERNAL_ERROR' })
  })

  it('жорсткий schema: невідповідність → ApiError з підсумком issues', async () => {
    const res = jsonRes({ data: { count: 'не число' } })
    await expect(
      parseEnvelope<{ count: number }>(res, { schema: z.object({ count: z.number() }).loose() }),
    ).rejects.toMatchObject({
      status: 200,
      code: 'INTERNAL_ERROR',
      message: 'Відповідь сервісу не відповідає очікуваній формі',
      // details — однорядковий підсумок path: message
      details: expect.stringContaining('count: Invalid input'),
    })
  })

  it('жорсткий schema: влучання повертає спарсене значення', async () => {
    const res = jsonRes({ data: { id: ' 7 ' } })
    const { data } = await parseEnvelope<{ id: number }>(res, { schema: z.object({ id: z.coerce.number() }).loose() })
    expect(data).toEqual({ id: 7 })
  })

  it("м'який sanity: невідповідність — console.error, значення проходить далі як є", async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = jsonRes({ data: { id: 'v1', status: 'bogus' } })
    const { data } = await parseEnvelope(res, {
      sanity: z.object({ id: z.string(), status: z.enum(['pending', 'approved']) }).loose(),
    })
    expect(data).toEqual({ id: 'v1', status: 'bogus' })
    expect(err).toHaveBeenCalledTimes(1)
    expect(String(err.mock.calls[0][1])).toContain('status')
  })

  it('meta рядками коерціюється в ядрі; невалідна meta → undefined + console.error', async () => {
    const ok = jsonRes({ data: [1], meta: { page: '2', limit: '20', total: '40', hasMore: 1 } })
    expect((await parseEnvelope<number[]>(ok, { coerceMeta: true })).meta).toEqual({
      page: 2, limit: 20, total: 40, hasMore: true,
    })

    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = jsonRes({ data: [1], meta: { page: 'abc', limit: '20', total: '40', hasMore: true } })
    const { data, meta } = await parseEnvelope<number[]>(bad, { coerceMeta: true })
    expect(data).toEqual([1])
    expect(meta).toBeUndefined()
    expect(err).toHaveBeenCalledTimes(1)
    expect(String(err.mock.calls[0][1])).toContain('page')
  })

  it('list-пресет: відсутній data у конверті → порожній масив, meta без body.meta → undefined тихо', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = jsonRes({ data: null })
    expect(await parseList<number>(res)).toEqual({ data: [], meta: undefined })
    expect(err).not.toHaveBeenCalled()
  })
})
