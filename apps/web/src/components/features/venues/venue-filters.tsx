'use client'

// Розмітка фільтрів каталогу; стан і логіка — в useVenueFilters
// (use-venue-filters.ts): стан локальний, застосування — через URL (щоб SSR
// бачив усе). Компонування — «панель фільтрів»: вузька колонка ліворуч
// від результатів (розкладку робить page.tsx); на мобільних (<sm) панель стає
// горизонтальною стрічкою фільтрів над сіткою. Пошук — у хедері (sm+); тут він
// лишений тільки для мобільних, бо хедерний інпут схований до sm.

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import type { CatalogQuery } from '@/lib/venues/query'
import { RATING_STARS, csvIncludes, useVenueFilters } from './use-venue-filters'

// Чип-фільтр: теги і фічі рендеряться однаково (rounded-full, aria-pressed,
// активний — бурштиновий), відрізняються лише значеннями у CSV-стані
function FilterChips({ ariaLabel, chips, isActive, onToggle }: {
  ariaLabel: string
  chips: { key: string; value: string; text: string }[]
  isActive: (value: string) => boolean
  onToggle: (value: string) => void
}) {
  return (
    <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label={ariaLabel}>
      {chips.map((c) => {
        const active = isActive(c.value)
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(c.value)}
            className={`rounded-full border px-2 py-0.5 text-xs leading-none transition-colors focus:outline-none focus-visible:border-amber-500 ${
              active ? 'border-amber-500 text-amber-400' : 'border-line text-muted hover:text-amber-400'
            }`}
          >
            {c.text}
          </button>
        )
      })}
    </div>
  )
}

// Рейтинг-фільтр зірками; onToggle — повторний клік по активній скидає
function RatingStars({ minRating, onToggle }: {
  minRating: string
  onToggle: (n: number) => void
}) {
  return (
    <div role="group" aria-label="Рейтинг від" className="mt-1 flex items-center gap-1">
      {RATING_STARS.map((n) => {
        const on = minRating !== '' && Number(minRating) >= n
        return (
          <button
            key={n}
            type="button"
            aria-pressed={minRating === String(n)}
            aria-label={`Рейтинг від ${n}`}
            onClick={() => onToggle(n)}
            className={`rounded-xl border px-2 py-1 text-sm leading-none transition-colors focus:outline-none focus-visible:border-amber-500 ${
              on ? 'border-amber-500 text-amber-400' : 'border-line text-faint hover:text-amber-400'
            }`}
          >
            ★
          </button>
        )
      })}
      <span className="ml-1.5 text-xs text-faint">
        {minRating ? `від ${minRating.replace('.', ',')}` : 'будь-який'}
      </span>
    </div>
  )
}

export function VenueFilters({ initial }: { initial: CatalogQuery }) {
  const {
    draft, update, tags, types, features,
    toggleTag, toggleFeature, toggleMinRating,
    apply, reset, nearMe, geoError,
  } = useVenueFilters(initial)

  return (
    <form
      onSubmit={apply}
      aria-label="Фільтри каталогу"
      className="w-full shrink-0 rounded-xl border border-line bg-surface p-4 lg:w-64"
    >
      {/* На мобільних — стрічка (flex-row + overflow-x-auto), на lg — вертикальна колонка */}
      <div className="flex gap-3 overflow-x-auto pb-1 lg:flex-col lg:gap-4 lg:overflow-visible lg:pb-0">
        {/* Пошук: у хедері (sm+) він уже є — тут показуємо лише до sm, щоб не дублювати */}
        <label className="w-44 shrink-0 text-sm sm:hidden">
          Пошук
          <Input value={draft.q} onChange={(e) => update({ q: e.target.value })} placeholder="Назва або адреса" className="mt-1" />
        </label>
        <label className="w-44 shrink-0 text-sm lg:w-auto">
          Сортування
          <Select value={draft.sort} onChange={(e) => update({ sort: e.target.value as CatalogQuery['sort'] })} className="mt-1">
            <option value="newest">Нові</option>
            <option value="rating">За рейтингом</option>
            <option value="check">За середнім чеком</option>
            <option value="name">За алфавітом</option>
            <option value="distance" disabled={!draft.geo}>Поблизу (потрібна геолокація)</option>
          </Select>
        </label>
        <label className="w-44 shrink-0 text-sm lg:w-auto">
          Тип закладу
          {/* Фолбек: довідник не вантажиться — не ховай
              блок, а лиши ручний input, щоб активний URL-фільтр лишався десь видимим */}
          {types.length > 0 ? (
            <Select value={draft.type} onChange={(e) => update({ type: e.target.value })} className="mt-1">
              <option value="">Всі типи</option>
              {types.map((t) => (
                <option key={t.id} value={t.slug}>{t.name}</option>
              ))}
            </Select>
          ) : (
            <Input value={draft.type} onChange={(e) => update({ type: e.target.value })} placeholder="напр. bar" className="mt-1" />
          )}
        </label>
        <div className="w-44 shrink-0 text-sm lg:w-auto">
          <span>Теги</span>
          {tags.length > 0 && (
            <FilterChips
              ariaLabel="Теги"
              chips={tags.map((t) => ({ key: t.id, value: t.slug, text: `#${t.name}` }))}
              isActive={(v) => csvIncludes(draft.tag, v)}
              onToggle={toggleTag}
            />
          )}
        </div>
        <div className="w-44 shrink-0 text-sm lg:w-auto">
          <span>Особливості</span>
          {features.length === 0 && draft.feature && (
            <Input
              value={draft.feature}
              onChange={(e) => update({ feature: e.target.value })}
              aria-label="Особливості вручну (через кому)"
              className="mt-1"
            />
          )}
          {features.length > 0 && (
            <FilterChips
              ariaLabel="Особливості"
              chips={features.map((f) => ({ key: f.id, value: f.code, text: f.icon ? `${f.icon} ${f.name}` : f.name }))}
              isActive={(v) => csvIncludes(draft.feature, v)}
              onToggle={toggleFeature}
            />
          )}
        </div>
        <label className="w-28 shrink-0 text-sm lg:w-auto">
          Чек від
          <Input type="number" min="0" value={draft.minCheck} onChange={(e) => update({ minCheck: e.target.value })} className="mt-1" />
        </label>
        <label className="w-28 shrink-0 text-sm lg:w-auto">
          Чек до
          <Input type="number" min="0" value={draft.maxCheck} onChange={(e) => update({ maxCheck: e.target.value })} className="mt-1" />
        </label>
        <div className="w-44 shrink-0 lg:w-auto">
          <span className="text-sm">Рейтинг</span>
          <RatingStars minRating={draft.minRating} onToggle={toggleMinRating} />
        </div>
        <div className="w-28 shrink-0 lg:w-auto">
          <label className="text-sm">
            Радіус (км)
            <Input type="number" min="0.1" max="100" step="any" value={draft.radiusKm} onChange={(e) => update({ radiusKm: e.target.value })} placeholder="порожньо = усі" className="mt-1" />
          </label>
          {draft.geo && <span className="mt-1 block text-xs text-muted">{draft.radiusKm ? `Поблизу, радіус ${draft.radiusKm} км` : 'Поблизу, без обмеження радіуса'}</span>}
        </div>
        <div className="flex shrink-0 gap-2 lg:w-auto lg:flex-col">
          <Button type="submit">Застосувати</Button>
          <Button type="button" variant="secondary" onClick={nearMe}>📍 Поблизу</Button>
          <Button type="button" variant="ghost" onClick={reset}>Скинути</Button>
        </div>
      </div>
      {geoError && <p role="alert" className="mt-2 text-sm text-danger">{geoError}</p>}
    </form>
  )
}