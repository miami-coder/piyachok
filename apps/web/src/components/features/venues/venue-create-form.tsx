'use client'

// Розмітка форми подання закладу; увесь стан і логіка — в useVenueCreateForm
// (use-venue-create-form.ts): zod-валідація перед
// POST /venues → 201, помилки валідації — по-полівно під інпутом (роль
// alert + aria-describedby), успіх → модераційний редірект на кабінет.
// Field — повторюваний патерн «лейбл + елемент + помилка під ним».

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { FilePickerButton } from '@/components/ui/file-picker-button'
import { WH_DAYS } from '@/lib/validation/venue'
import { DAY_LABELS, MAX_PHOTOS, useVenueCreateForm } from './use-venue-create-form'

// Зірочка — видимий маркер обовʼязковості, прихована від скрінрідера
// (вимогу передає aria-required на інпуті). span2 — ширші поля 2-колоночної
// сітки (кластер C2).
function Field({ id, label, required = false, error, span2 = false, children }: {
  id: string
  label: string
  required?: boolean
  error?: string
  span2?: boolean
  children: ReactNode
}) {
  return (
    <div className={`text-sm${span2 ? ' sm:col-span-2' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" className="text-danger">{' '}*</span>
        )}
      </label>
      {children}
      {error && (
        <span id={`${id}-error`} role="alert" className="mt-1 block text-danger">{error}</span>
      )}
    </div>
  )
}

// describedBy — id span-помилки під полем (порожній, коли помилки немає)
function describedBy(id: string, error?: string): string | undefined {
  return error ? `${id}-error` : undefined
}

export function VenueCreateForm() {
  const {
    name, setName, address, setAddress,
    latitude, setLatitude, longitude, setLongitude,
    description, setDescription,
    phone, setPhone, instagram, setInstagram, facebook, setFacebook, website, setWebsite,
    hours, setHours, averageCheck, setAverageCheck,
    featureCodes, setFeatureCodes, tagSlugs, setTagSlugs, typeSlug, setTypeSlug,
    photos, addPhotos, removePhoto,
    fieldErrors, error, sending, submit,
  } = useVenueCreateForm()

  return (
    // noValidate: нативні бульбашки конфліктують з інлайн-помилками (як у register-form)
    // Сітка 2 колонок у картці (кластер C2): широкі поля — col-span-2
    <form
      noValidate
      onSubmit={submit}
      className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-surface p-5 sm:grid-cols-2"
      aria-label="Створення закладу"
    >
      <Field id="vn-name" label="Назва" required error={fieldErrors.name}>
        <Input
          id="vn-name"
          required
          aria-required="true"
          aria-describedby={describedBy('vn-name', fieldErrors.name)}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full"
        />
      </Field>
      <Field id="vn-address" label="Адреса" required error={fieldErrors.address}>
        <Input
          id="vn-address"
          required
          aria-required="true"
          aria-describedby={describedBy('vn-address', fieldErrors.address)}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="mt-1 w-full"
        />
      </Field>
      <Field id="vn-description" label="Опис" span2>
        <Textarea
          id="vn-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="mt-1 w-full"
        />
      </Field>
      {/* Координати опційні: без них заклад не бере участі у пошуку «Поблизу» */}
      <Field id="vn-lat" label="Широта" error={fieldErrors.latitude}>
        <Input
          id="vn-lat"
          type="number"
          step="0.000001"
          min="-90"
          max="90"
          placeholder="напр. 50.4501"
          aria-describedby={describedBy('vn-lat', fieldErrors.latitude)}
          value={latitude}
          onChange={(e) => setLatitude(e.target.value)}
          className="mt-1 w-full"
        />
      </Field>
      <Field id="vn-lng" label="Довгота" error={fieldErrors.longitude}>
        <Input
          id="vn-lng"
          type="number"
          step="0.000001"
          min="-180"
          max="180"
          placeholder="напр. 30.5234"
          aria-describedby={describedBy('vn-lng', fieldErrors.longitude)}
          value={longitude}
          onChange={(e) => setLongitude(e.target.value)}
          className="mt-1 w-full"
        />
      </Field>
      <fieldset className="rounded-xl border border-line p-3 sm:col-span-2">
        <legend className="px-1 text-sm font-medium">Контакти</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Телефон" aria-label="Телефон" />
          <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="Instagram" aria-label="Instagram" />
          <Input value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="Facebook" aria-label="Facebook" />
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Сайт" aria-label="Сайт" />
        </div>
      </fieldset>
      <fieldset className="rounded-xl border border-line p-3 sm:col-span-2">
        <legend className="px-1 text-sm font-medium">Години роботи (формат HH:MM-HH:MM, порожнє — вихідний)</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {WH_DAYS.map((d) => (
            <label key={d} className="block text-xs text-muted">
              {DAY_LABELS[d]}
              <Input
                value={hours[d] ?? ''}
                onChange={(e) => setHours((h) => ({ ...h, [d]: e.target.value }))}
                placeholder="10:00-22:00"
                aria-label={`Години: ${DAY_LABELS[d]}`}
                className="mt-0.5 w-full"
              />
            </label>
          ))}
        </div>
        {WH_DAYS.map((d) =>
          fieldErrors[`workingHours.${d}`] && (
            <span key={`wh-${d}`} role="alert" className="block text-danger">
              {fieldErrors[`workingHours.${d}`]}
            </span>
          ),
        )}
      </fieldset>
      <Field id="vn-check" label="Середній чек (₴)" error={fieldErrors.averageCheck}>
        <Input
          id="vn-check"
          type="number"
          min="0"
          aria-describedby={describedBy('vn-check', fieldErrors.averageCheck)}
          value={averageCheck}
          onChange={(e) => setAverageCheck(e.target.value)}
          className="mt-1 w-full"
        />
      </Field>
      <Field id="vn-features" label="Фічі (через кому, до 20)" error={fieldErrors.featureCodes}>
        <Input
          id="vn-features"
          value={featureCodes}
          onChange={(e) => setFeatureCodes(e.target.value)}
          className="mt-1 w-full"
        />
      </Field>
      <Field id="vn-tags" label="Теги (через кому, до 20)" error={fieldErrors.tagSlugs}>
        <Input
          id="vn-tags"
          value={tagSlugs}
          onChange={(e) => setTagSlugs(e.target.value)}
          className="mt-1 w-full"
        />
      </Field>
      <Field id="vn-type" label="Тип (slug)" error={fieldErrors.typeSlug}>
        <Input
          id="vn-type"
          value={typeSlug}
          onChange={(e) => setTypeSlug(e.target.value)}
          className="mt-1 w-full"
        />
      </Field>
      <div className="text-sm sm:col-span-2">
        <label>Фото закладу (до {MAX_PHOTOS})</label>
        <FilePickerButton
          buttonLabel="Обрати фото"
          inputLabel="Фото закладу"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="mt-1"
          onFiles={addPhotos}
        />
        {photos.length > 0 && (
          <ul className="mt-2 space-y-1">
            {photos.map((f, i) => (
              <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 truncate text-muted">{f.name}</span>
                <button
                  type="button"
                  aria-label={`Прибрати ${f.name}`}
                  className="shrink-0 rounded px-1 text-danger hover:underline"
                  onClick={() => removePhoto(i)}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs text-muted">JPEG/PNG/WebP, до 5 МБ кожне. Перше фото стане головним.</p>
      </div>
      {/* Футер форми: зліва підказка/глобальна помилка, праворуч submit */}
      <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
        <div className="min-w-0 text-sm text-muted">
          {error && <p role="alert" className="text-danger">{error}</p>}
          <p>Заклад буде відправлено на модерацію.</p>
        </div>
        <Button type="submit" disabled={sending}>{sending ? 'Подаємо…' : 'Подати заклад'}</Button>
      </div>
    </form>
  )
}