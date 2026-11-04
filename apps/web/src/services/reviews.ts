// Клієнтський сервіс відгуків: створення (multipart із фото чеку), правка, видалення,
// виділення/зняття виділення критиком.

import { api, apiVoid } from '@/lib/api/client'

/**
 * POST /venues/:venueId/reviews — новий відгук. Тіло multipart (rating, text,
 * checkPhoto): браузер сам ставить boundary, тому content-type не ставимо.
 * Помилка → ApiError з message тіла (errorFromResponse у parse).
 */
export function createVenueReview(venueId: string, fd: FormData): Promise<unknown> {
  return api(`/venues/${venueId}/reviews`, { method: 'POST', body: fd })
}

/** PATCH /reviews/:id — правка власного відгуку (rating + text, JSON). */
export function updateReview(
  reviewId: string,
  data: { rating: number; text: string; billAmount?: number | null },
): Promise<unknown> {
  return api(`/reviews/${reviewId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  })
}

/** DELETE /reviews/:id → 200 з порожнім тілом (parseEmpty через apiVoid). */
export function deleteReview(reviewId: string): Promise<void> {
  return apiVoid(`/reviews/${reviewId}`, { method: 'DELETE' })
}

/** POST /reviews/:id/feature — виділити відгук (право review:feature: критик або супер-адмін). */
export function featureReview(reviewId: string): Promise<unknown> {
  return api(`/reviews/${reviewId}/feature`, { method: 'POST' })
}

/** DELETE /reviews/:id/feature — зняти виділення (200 з data — звичайний api). */
export function unfeatureReview(reviewId: string): Promise<unknown> {
  return api(`/reviews/${reviewId}/feature`, { method: 'DELETE' })
}