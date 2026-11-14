import 'server-only'

import { serverFetch, serverFetchList } from '@/lib/api/server-client'
import {
  venueContract,
  venueListContract,
  tagRefListContract,
  typeRefListContract,
  featureRefListContract,
  favoriteListContract,
} from '@/lib/api/contracts'
import { parseVenue, type RawVenue, type Venue, type TagRef, type TypeRef, type FeatureRef, type VenueTaxonomy } from '@/types/venue'
import type { RawFavoriteVenue } from '@/types/favorite'
import type { RawVenueAnalytics } from '@/types/analytics'
import type { SessionTokens } from '@/lib/auth/session'

/**
 * Прості деталі закладу одним запитом (без збагачення) — для сайд-барів,
 * де потрібне лише ім'я/посилання; null, якщо заклад недоступний.
 */
export function getVenueById(id: string, revalidate = 60): Promise<RawVenue | null> {
  return serverFetch<RawVenue>(`/venues/${id}`, { revalidate, sanity: venueContract }).catch(() => null)
}

/**
 * Деталі закладу зі збагаченням: GET /venues/:id не повертає
 * photos/tags/types/features (лише owner) — добираємо через list-пошук за
 * назвою; деградація тиха, якщо не знайшли. Повертає null, якщо заклад
 * недоступний (не-approved → 404 на бекенді).
 */
export async function getVenueDetail(id: string, revalidate = 60): Promise<Venue | null> {
  // Авторитетне джерело з 404-семантикою (не-approved → 404 на бекенді)
  const detail = await serverFetch<RawVenue>(`/venues/${id}`, { revalidate, sanity: venueContract }).catch(() => null)
  if (!detail) return null

  let relations: RawVenue | null = null
  try {
    const list = await serverFetchList<RawVenue>(`/venues?q=${encodeURIComponent(detail.name)}&limit=100`, {
      revalidate,
      sanity: venueListContract,
    })
    relations = list.data.find((v) => v.id === detail.id) ?? null
  } catch {
    relations = null
  }

  return parseVenue(relations ?? detail)
}

/** Каталог закладів (головна сторінка); meta потрібна пагінації.
 *  revalidate=0: бейдж «✦ Рекомендовано» після toggle має оновлюватись
 *  одразу через router.refresh() — без 60-секундного кешу BFF
 *  (бекендовий свій 60-с кеш списку лишається — БД не «стукається» щоразу). */
export function getVenuesCatalog(query: string) {
  return serverFetchList<RawVenue>(`/venues?${query}`, { revalidate: 0, sanity: venueListContract })
}

/** Список закладів поточного власника (кабінет). */
/**
 * Довідники каталогу (теги/типи/фічі) — одним блоком для SSR-фільтрів.
 * revalidate 300: таксономія міняється рідко, Data Cache прикриває повторні
 * відкриття головної; клієнтські запити за довідниками зайві. Падіння
 * одного довідника не ламає сторінку — гілка з фолбек-інпутом у фільтрах.
 */
export async function getVenueTaxonomy(): Promise<VenueTaxonomy> {
  const revalidate = 300
  const [tags, types, features] = await Promise.all([
    serverFetch<TagRef[]>('/venues/tags', { revalidate, sanity: tagRefListContract }).catch(() => [] as TagRef[]),
    serverFetch<TypeRef[]>('/venues/types', { revalidate, sanity: typeRefListContract }).catch(() => [] as TypeRef[]),
    serverFetch<FeatureRef[]>('/venues/features', { revalidate, sanity: featureRefListContract }).catch(() => [] as FeatureRef[]),
  ])
  return { tags, types, features }
}

/** Список закладів поточного власника (кабінет). */
export function getMyVenues(tokens: SessionTokens | null): Promise<RawVenue[]> {
  return serverFetch<RawVenue[]>('/me/venues', { tokens, revalidate: 0, sanity: venueListContract })
}

/** Заклад поточного власника (вкладка керування). */
export function getOwnerVenue(id: string, tokens: SessionTokens | null): Promise<RawVenue> {
  return serverFetch<RawVenue>(`/me/venues/${id}`, { tokens, revalidate: 0, sanity: venueContract })
}

/** Аналітика закладу власника за період. */
export function getVenueAnalytics(venueId: string, from: string, to: string, tokens: SessionTokens | null): Promise<RawVenueAnalytics> {
  return serverFetch<RawVenueAnalytics>(`/me/venues/${venueId}/analytics?from=${from}&to=${to}`, {
    tokens,
    revalidate: 0,
  })
}

/** Сторінка обраного користувача (кабінет, пагінація). */
export function getFavoritesPage(tokens: SessionTokens | null, page: number, limit: number) {
  return serverFetchList<RawFavoriteVenue>(`/me/favorites?page=${page}&limit=${limit}`, {
    tokens,
    revalidate: 0,
    sanity: favoriteListContract,
  })
}

/** id закладів в обраному (ендпоінту «чи в обраному» немає — шукаємо проекцією списку). */
export async function getFavoriteIds(tokens: SessionTokens | null): Promise<Set<string>> {
  const favs = await serverFetchList<{ id: string }>('/me/favorites?limit=100', { tokens, revalidate: 0, sanity: favoriteListContract })
  return new Set(favs.data.map((f) => f.id))
}

/** Список закладів для адмінки (вкладки «модерація»/«схвалені», пагінація). */
export function getAdminVenuesPage(tab: 'moderation' | 'approved', page: number, tokens: SessionTokens | null) {
  // вкладка «модерація» — це бекендовий pending
  return serverFetchList<RawVenue>(`/admin/venues/${tab === 'moderation' ? 'pending' : tab}?page=${page}`, {
    tokens,
    revalidate: 0,
    sanity: venueListContract,
  })
}
/** Заклади, які поточний критик рекомендував (вкладка «Рекомендовані» кабінету). */
export function getMyRecommendations(tokens: SessionTokens | null): Promise<RawVenue[]> {
  return serverFetch<RawVenue[]>('/me/recommendations', { tokens, revalidate: 0, sanity: venueListContract })
}
