// Контракти відповідей (lib/api/contracts): перевіряємо, що реальні форми
// бекенда (числові transformed → числа, ratingAvg рядком у legacy) проходять,
// а сміття (невідомий статус, числове поле рядком там, де число обовʼязкове)
// падає safeParse → стало б console.error у sanity-шарі parse.ts.

import { describe, expect, it } from 'vitest'
import {
  analyticsOverviewContract,
  favoriteListContract,
  featureRefListContract,
  tagRefListContract,
  timeseriesContract,
  typeRefListContract,
  venueContract,
  venueListContract,
  venueStatsContract,
} from '@/lib/api/contracts'

// Мінімальний структурний тип для ассертів: важлива лише safeParse
type ContractLike = { safeParse: (v: unknown) => { success: boolean } }
const ok = (schema: ContractLike, value: unknown) => expect(schema.safeParse(value).success)
const fail = (schema: ContractLike, value: unknown) => expect(!schema.safeParse(value).success)

describe('venueContract', () => {
  const rawVenue = {
    id: 'v1',
    ownerId: 'u1',
    status: 'approved',
    latitude: '50.4501',
    longitude: '30.5234',
    ratingAvg: '4.5',
    ratingCount: 3,
    viewCount: 10,
  }

  it('проходить реальний raw-заклад (числові рядками — legacy-страховка)', () => ok(venueContract, rawVenue))
  it('проходить числові transformed-поля (п.21 transformer → числа)', () =>
    ok(venueContract, { ...rawVenue, latitude: 50.4501, ratingAvg: 4.5 }))
  it('невідомий статус падає', () => fail(venueContract, { ...rawVenue, status: 'bogus' }))
  it("ratingCount-рядок (число, не union) падає", () => fail(venueContract, { ...rawVenue, ratingCount: '3' }))
  it('список закладів проходить списковим контрактом', () => ok(venueListContract, [rawVenue]))
})

describe('довідники таксономії', () => {
  const tag = { id: 't1', name: 'Кава', slug: 'kava', venueCount: 5 }
  const ref = { id: 't2', name: 'Бар', slug: 'bar' }
  const feature = { id: 'f1', name: 'Wi-Fi', code: 'wifi', icon: null }

  it('tagRef', () => ok(tagRefListContract, [tag]))
  it('venueCount рядком падає', () => fail(tagRefListContract, [{ ...tag, venueCount: '5' }]))
  it('typeRef', () => ok(typeRefListContract, [ref]))
  it('featureRef (icon null / рядок)', () =>
    ok(featureRefListContract, [feature, { ...feature, id: 'f2', icon: 'cup.png' }]))
})

describe('аналітика', () => {
  it('таймсерія: date рядком + count число/рядком', () =>
    ok(timeseriesContract, [
      { date: '2026-11-01', count: 12 },
      { date: '2026-11-02', count: '9' },
    ]))
  it('таймсерія без date падає', () => fail(timeseriesContract, [{ count: 5 }]))
  it('топ закладів', () => ok(venueStatsContract, [{ venueId: 'v1', venueName: 'Кава', views: 3 }]))
  it('overview (tiles)', () =>
    ok(analyticsOverviewContract, { totalViews: '40', totalEvents: 7, eventsByType: [{ eventType: 'review_created', count: '3' }] }))
})

describe('обране', () => {
  const fav = { id: 'v1', name: 'Кава', address: 'Вул. 1', ratingAvg: '4.1', mainPhotoUrl: null }
  it('список обраного проходить', () => ok(favoriteListContract, [fav]))
  it('id-числом падає', () => fail(favoriteListContract, [{ ...fav, id: 1 }]))
})
