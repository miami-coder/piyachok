'use client'

// Логіка фільтрів каталогу (розмітка — venue-filters.tsx): драфт в одному
// стані-обʼєкті, застосування — через URL (?q=…&tag=…), щоб SSR бачив усе.
// Драфт синхронізується з новим initial під час рендеру (кнопки назад/вперед,
// «Скинути», переходи за посиланнями зі зміненими фільтрами); зміна page
// (пагінація) драфт не затирає. Довідники тегів/типів/фіч — публічні GET;
// чип-клік перемикає slug у CSV. Один AbortController на всі три довідники:
// cleanup (розмонтування) скасовує запити, guard не пропускає пізній setState,
// якщо відповідь встигла до abort.

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { CatalogQuery } from '@/lib/venues/query'
import { getVenueTags, getVenueTypes, getVenueFeatures, type TagRef, type TypeRef, type FeatureRef } from '@/services/venues'

// Рейтинг-фільтр зірками: цілі значення 1..5 (у URL досі можна 0.5-крок)
export const RATING_STARS = [1, 2, 3, 4, 5] as const

// Драфт форми фільтрів: значення в тому вигляді, як їх тримають інпути
// (рядки; CSV — по комах), geo — вибране «Поблизу» до застосування.
export interface FiltersDraft {
  q: string
  sort: CatalogQuery['sort']
  type: string
  tag: string
  feature: string
  minCheck: string
  maxCheck: string
  minRating: string
  radiusKm: string
  geo: { lat: number; lng: number } | null
}

function draftFromQuery(initial: CatalogQuery): FiltersDraft {
  return {
    q: initial.q ?? '',
    sort: initial.sort,
    type: initial.type ?? '',
    tag: initial.tag.join(','),
    feature: initial.feature.join(','),
    minCheck: initial.minCheck?.toString() ?? '',
    maxCheck: initial.maxCheck?.toString() ?? '',
    minRating: initial.minRating?.toString() ?? '',
    radiusKm: initial.radiusKm?.toString() ?? '',
    geo: initial.lat !== undefined && initial.lng !== undefined ? { lat: initial.lat, lng: initial.lng } : null,
  }
}

// Стійкий ключ фільтрів із пропсів (без page/limit — пагінація не синк).
// '\n' у URL неможливий (кодується), тому як роздільник безпечний.
function filterKeyOf(q: CatalogQuery): string {
  return [
    q.q ?? '', q.sort, q.type ?? '',
    q.tag.join(','), q.feature.join(','),
    q.minCheck ?? '', q.maxCheck ?? '',
    q.minRating ?? '', q.lat ?? '', q.lng ?? '', q.radiusKm ?? '',
  ].join('\n')
}

// CSV-фільтри (теги, фічі) тримаються рядком — так вони і в URL
function csvToActive(csv: string): string[] {
  return csv.split(',').map((s) => s.trim()).filter(Boolean)
}

// Активність чипа — slug входить у CSV
export function csvIncludes(csv: string, value: string): boolean {
  return csvToActive(csv).includes(value)
}

function toggleInCsv(csv: string, value: string): string {
  const active = csvToActive(csv)
  const next = active.includes(value)
    ? active.filter((s) => s !== value)
    : [...active, value]
  return next.join(',')
}

export function useVenueFilters(initial: CatalogQuery) {
  const router = useRouter()
  const [draft, setDraft] = useState<FiltersDraft>(() => draftFromQuery(initial))

  // Довідники — не фільтри, окремі стани: синхронізація драфта їх не чіпає.
  const [tags, setTags] = useState<TagRef[]>([])
  const [types, setTypes] = useState<TypeRef[]>([])
  const [features, setFeatures] = useState<FeatureRef[]>([])
  const [geoError, setGeoError] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    getVenueTags(ac.signal)
      .then((value) => { if (!ac.signal.aborted) setTags(value) })
      .catch(() => undefined)
    getVenueTypes(ac.signal)
      .then((value) => { if (!ac.signal.aborted) setTypes(value) })
      .catch(() => undefined)
    getVenueFeatures(ac.signal)
      .then((value) => { if (!ac.signal.aborted) setFeatures(value) })
      .catch(() => undefined)
    return () => ac.abort()
  }, [])

  // Синхронізація з URL: офіційний патерн «adjusting state when props
  // change» — setState одразу під час рендеру при зміні ключа фільтрів.
  // Це не ефект: лишкового рендера немає, довідники не перезапитуються.
  const [prevKey, setPrevKey] = useState(() => filterKeyOf(initial))
  const nextKey = filterKeyOf(initial)
  if (nextKey !== prevKey) {
    setPrevKey(nextKey)
    setDraft(draftFromQuery(initial))
  }

  function update(patch: Partial<FiltersDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  // Перемикання чипа тега: додає/забирає slug у CSV-стані тегів
  function toggleTag(slug: string) {
    setDraft((prev) => ({ ...prev, tag: toggleInCsv(prev.tag, slug) }))
  }

  // Перемикання чипа фічі: керує CSV-станом feature
  function toggleFeature(code: string) {
    setDraft((prev) => ({ ...prev, feature: toggleInCsv(prev.feature, code) }))
  }

  // Повторний клік по активній зірці скидає рейтинг-фільтр
  function toggleMinRating(n: number) {
    setDraft((prev) => ({ ...prev, minRating: prev.minRating === String(n) ? '' : String(n) }))
  }

  function apply(e: FormEvent) {
    e.preventDefault()
    const p = new URLSearchParams()
    if (draft.q) p.set('q', draft.q)
    // CSV уніфікуємо: трим + прибираємо порожні → URL без «%20», бекнд не втрачає слаги
    if (draft.tag) {
      const clean = csvToActive(draft.tag).join(',')
      if (clean) p.set('tag', clean)
    }
    if (draft.sort !== 'newest') p.set('sort', draft.sort)
    if (draft.type) p.set('type', draft.type)
    if (draft.feature) {
      const clean = csvToActive(draft.feature).join(',')
      if (clean) p.set('feature', clean)
    }
    if (draft.minCheck) p.set('minCheck', draft.minCheck)
    if (draft.maxCheck) p.set('maxCheck', draft.maxCheck)
    if (draft.minRating) p.set('minRating', draft.minRating)
    if (draft.geo) {
      p.set('lat', String(draft.geo.lat))
      p.set('lng', String(draft.geo.lng))
      // Порожній радіус — без урізання діапазону: бекенд просто сортує за відстанню
      if (draft.radiusKm) p.set('radiusKm', draft.radiusKm)
    }
    router.push(`/?${p.toString()}`)
  }

  function reset() {
    router.push('/')
  }

  function nearMe() {
    if (!navigator.geolocation) return setGeoError('Геолокація недоступна у вашому браузері')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDraft((prev) => ({ ...prev, geo: { lat: pos.coords.latitude, lng: pos.coords.longitude } }))
        setGeoError(null)
      },
      () => setGeoError('Не вдалося отримати геолокацію — перевірте дозвіл браузера'),
    )
  }

  return {
    draft, update,
    tags, types, features,
    toggleTag, toggleFeature, toggleMinRating,
    apply, reset, nearMe, geoError,
  }
}
