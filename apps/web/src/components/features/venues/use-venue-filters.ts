'use client'

// Логіка фільтрів каталогу (розмітка — venue-filters.tsx): стан локальний,
// застосування — через URL (?q=…&tag=…), щоб SSR бачив усе. Довідники
// тегів/типів/фіч — публічні GET; чип-клік перемикає slug у CSV.
// Один AbortController на всі три довідники: cleanup (розмонтування)
// скасовує запити, guard не пропускає пізній setState, якщо відповідь
// встигла до abort.

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { CatalogQuery } from '@/lib/venues/query'
import { getVenueTags, getVenueTypes, getVenueFeatures, type TagRef, type TypeRef, type FeatureRef } from '@/services/venues'

// Рейтинг-фільтр зірками: цілі значення 1..5 (у URL досі можна 0.5-крок)
export const RATING_STARS = [1, 2, 3, 4, 5] as const

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
  const [q, setQ] = useState(initial.q ?? '')
  const [sort, setSort] = useState(initial.sort)
  const [type, setType] = useState(initial.type ?? '')
  const [tag, setTag] = useState(initial.tag.join(','))
  const [tags, setTags] = useState<TagRef[]>([])
  const [types, setTypes] = useState<TypeRef[]>([])
  const [features, setFeatures] = useState<FeatureRef[]>([])
  const [feature, setFeature] = useState(initial.feature.join(','))
  const [minCheck, setMinCheck] = useState(initial.minCheck?.toString() ?? '')
  const [maxCheck, setMaxCheck] = useState(initial.maxCheck?.toString() ?? '')
  const [minRating, setMinRating] = useState(initial.minRating?.toString() ?? '')
  const [radiusKm, setRadiusKm] = useState(initial.radiusKm?.toString() ?? '')
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(
    initial.lat !== undefined && initial.lng !== undefined ? { lat: initial.lat, lng: initial.lng } : null,
  )
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

  // Перемикання чипа тега: додає/забирає slug у CSV-стані тегів
  function toggleTag(slug: string) {
    setTag(toggleInCsv(tag, slug))
  }

  // Перемикання чипа фічі: керує CSV-станом feature
  function toggleFeature(code: string) {
    setFeature(toggleInCsv(feature, code))
  }

  // Повторний клік по активній зірці скидає рейтинг-фільтр
  function toggleMinRating(n: number) {
    setMinRating(minRating === String(n) ? '' : String(n))
  }

  function apply(e: FormEvent) {
    e.preventDefault()
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    // CSV уніфікуємо: трим + прибираємо порожні → URL без «%20», бекнд не втрачає слаги
    if (tag) {
      const clean = csvToActive(tag).join(',')
      if (clean) p.set('tag', clean)
    }
    if (sort !== 'newest') p.set('sort', sort)
    if (type) p.set('type', type)
    if (feature) {
      const clean = csvToActive(feature).join(',')
      if (clean) p.set('feature', clean)
    }
    if (minCheck) p.set('minCheck', minCheck)
    if (maxCheck) p.set('maxCheck', maxCheck)
    if (minRating) p.set('minRating', minRating)
    if (geo) {
      p.set('lat', String(geo.lat))
      p.set('lng', String(geo.lng))
      // Порожній радіус — без урізання діапазону: бекенд просто сортує за відстанню
      if (radiusKm) p.set('radiusKm', radiusKm)
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
        setGeo({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGeoError(null)
      },
      () => setGeoError('Не вдалося отримати геолокацію — перевірте дозвіл браузера'),
    )
  }

  return {
    q, setQ, sort, setSort, type, setType,
    tag, toggleTag, feature, setFeature, toggleFeature,
    tags, types, features,
    minCheck, setMinCheck, maxCheck, setMaxCheck,
    minRating, toggleMinRating, radiusKm, setRadiusKm,
    geo, geoError, apply, reset, nearMe,
  }
}