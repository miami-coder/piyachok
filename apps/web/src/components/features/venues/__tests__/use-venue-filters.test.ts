import { act, renderHook } from '@testing-library/react'
import type { FormEvent } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogQuery } from '@/lib/venues/query'
import { DEFAULT_CATALOG_QUERY } from '@/lib/venues/query'
import type { VenueTaxonomy } from '@/types/venue'
import { useVenueFilters } from '@/components/features/venues/use-venue-filters'

// vi.hoisted: фабрика vi.mock піднімається вище імпортів, звичайна const була б у TDZ
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

// Таксономія приходить пропсами з SSR — клієнтських запитів за довідниками немає
const taxonomy: VenueTaxonomy = {
  tags: [{ id: 't1', name: 'вино', slug: 'wine', venueCount: 3 }],
  types: [{ id: 'ty1', name: 'Бар', slug: 'bar' }],
  features: [{ id: 'f1', name: 'Літня тераса', code: 'terrace', icon: '☀' }],
}

function queryOf(patch: Partial<CatalogQuery>): CatalogQuery {
  return { ...DEFAULT_CATALOG_QUERY, ...patch }
}

const submitEvent = { preventDefault: vi.fn() } as unknown as FormEvent

// Мутації з хука — це колбеки подій: без act() ререндер не флешиться
// і result.current лишається несвіжим
function call(fn: () => void) {
  act(() => fn())
}

describe('useVenueFilters', () => {
  beforeEach(() => {
    push.mockClear()
  })

  it('драфт на монтуванні береться з initial', () => {
    const { result } = renderHook(() => useVenueFilters(queryOf({ q: 'бар' }), taxonomy))
    expect(result.current.draft.q).toBe('бар')
    expect(result.current.draft.sort).toBe('newest')
    expect(result.current.draft.geo).toBeNull()
  })

  it('новий initial (назад/вперед, «Скинути») перетворюється в драфт', () => {
    const { rerender, result } = renderHook(
      ({ initial }: { initial: CatalogQuery }) => useVenueFilters(initial, taxonomy),
      { initialProps: { initial: queryOf({ q: 'бар' }) } },
    )
    rerender({ initial: queryOf({ q: '', tag: ['wine'], minRating: 4 }) })
    expect(result.current.draft.q).toBe('')
    expect(result.current.draft.tag).toBe('wine')
    expect(result.current.draft.minRating).toBe('4')
  })

  it('зміна лише page (пагінація) драфт не затирає', () => {
    const { rerender, result } = renderHook(
      ({ initial }: { initial: CatalogQuery }) => useVenueFilters(initial, taxonomy),
      { initialProps: { initial: queryOf({ page: 1 }) } },
    )
    call(() => result.current.update({ q: 'набране користувачем', minCheck: '300' }))
    rerender({ initial: queryOf({ page: 2 }) })
    expect(result.current.draft.q).toBe('набране користувачем')
    expect(result.current.draft.minCheck).toBe('300')
  })

  it('таксономія віддається як є і не реагує на новий initial', () => {
    const { rerender, result } = renderHook(
      ({ initial }: { initial: CatalogQuery }) => useVenueFilters(initial, taxonomy),
      { initialProps: { initial: queryOf({}) } },
    )
    expect(result.current.tags).toEqual(taxonomy.tags)
    expect(result.current.types).toEqual(taxonomy.types)
    expect(result.current.features).toEqual(taxonomy.features)
    rerender({ initial: queryOf({ q: 'інше' }) })
    expect(result.current.tags).toBe(taxonomy.tags)
    expect(result.current.types).toBe(taxonomy.types)
    expect(result.current.features).toBe(taxonomy.features)
  })

  it('toggleTag додає і прибирає slug із CSV', () => {
    const { result } = renderHook(() => useVenueFilters(queryOf({}), taxonomy))
    call(() => result.current.toggleTag('wine'))
    expect(result.current.draft.tag).toBe('wine')
    call(() => result.current.toggleTag('sport'))
    expect(result.current.draft.tag).toBe('wine,sport')
    call(() => result.current.toggleTag('wine'))
    expect(result.current.draft.tag).toBe('sport')
  })

  it('toggleMinRating повторний клік скидає рейтинг', () => {
    const { result } = renderHook(() => useVenueFilters(queryOf({}), taxonomy))
    call(() => result.current.toggleMinRating(3))
    expect(result.current.draft.minRating).toBe('3')
    call(() => result.current.toggleMinRating(3))
    expect(result.current.draft.minRating).toBe('')
  })

  it('apply збирає URL із драфта (CSV уніфіковано, порожні не серіалізуються)', () => {
    const { result } = renderHook(() => useVenueFilters(queryOf({}), taxonomy))
    call(() => result.current.update({
      q: 'бар',
      sort: 'rating',
      tag: ' wine , sport ,,',
      minCheck: '100',
      minRating: '4',
    }))
    call(() => result.current.apply(submitEvent))
    expect(submitEvent.preventDefault).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith('/?q=%D0%B1%D0%B0%D1%80&tag=wine%2Csport&sort=rating&minCheck=100&minRating=4')
  })

  it('reset повертає на незфільтрований каталог', () => {
    const { result } = renderHook(() => useVenueFilters(queryOf({}), taxonomy))
    result.current.reset()
    expect(push).toHaveBeenCalledWith('/')
  })

  it('geo + радіус потрапляють в URL; порожній радіус — без radiusKm', () => {
    const { result } = renderHook(() => useVenueFilters(queryOf({}), taxonomy))
    call(() => result.current.update({ geo: { lat: 50.45, lng: 30.52 }, radiusKm: '' }))
    call(() => result.current.apply(submitEvent))
    expect(push).toHaveBeenCalledWith('/?lat=50.45&lng=30.52')
  })

  it('geo з URL приходить у драфт і відкриває варіант «Поблизу»', () => {
    const { result } = renderHook(() => useVenueFilters(queryOf({ lat: 50.45, lng: 30.52, radiusKm: 5 }), taxonomy))
    expect(result.current.draft.geo).toEqual({ lat: 50.45, lng: 30.52 })
    expect(result.current.draft.radiusKm).toBe('5')
  })
})
