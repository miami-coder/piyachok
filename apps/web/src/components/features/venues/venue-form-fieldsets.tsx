'use client'

// Повторювані філдсети форм закладу (створення + редагування): «Контакти»
// і «Години роботи». Компоненти «німі»: значення і обробники приходять
// з хуків (use-venue-create-form / use-venue-edit-form); семантика сабміту
// (whitelist порожніх проти явного очищення null) живе в хуках, не тут.

import { Input } from '@/components/ui/input'
import { DAY_LABELS, WH_DAYS } from '@/lib/validation/venue'

export type ContactField = 'phone' | 'instagram' | 'facebook' | 'website'

const CONTACT_FIELDS: ContactField[] = ['phone', 'instagram', 'facebook', 'website']

const CONTACT_PLACEHOLDERS: Record<ContactField, string> = {
  phone: 'Телефон',
  instagram: 'Instagram',
  facebook: 'Facebook',
  website: 'Сайт',
}

// Контакти: 4 інпути сіткою 2×2 (aria-label = placeholder, як і було).
// legend у редагуванні доповнений підказкою про очищення (у create

// підказка не потрібна — там порожні поля просто не шлються).
export function ContactsFieldset({ contacts, onField, legend = 'Контакти' }: {
  contacts: Record<ContactField, string>
  onField: (field: ContactField, value: string) => void
  legend?: string
}) {
  return (
    <fieldset className="rounded-xl border border-line p-3 sm:col-span-2">
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {CONTACT_FIELDS.map((f) => (
          <Input
            key={f}
            value={contacts[f]}
            onChange={(e) => onField(f, e.target.value)}
            placeholder={CONTACT_PLACEHOLDERS[f]}
            aria-label={CONTACT_PLACEHOLDERS[f]}
          />
        ))}
      </div>
    </fieldset>
  )
}

// Години роботи: 7 інпутів ПН-НД (порожнє — вихідний). У створенні сюди
// впадають по-днівні помилки валідації (key workingHours.monday…); у
// редагуванні помилок по-полівно немає — fieldErrors не передають.
export function WorkingHoursFieldset({ hours, onDay, fieldErrors }: {
  hours: Record<string, string>
  onDay: (day: string, value: string) => void
  fieldErrors?: Record<string, string>
}) {
  return (
    <fieldset className="rounded-xl border border-line p-3 sm:col-span-2">
      <legend className="px-1 text-sm font-medium">Години роботи (формат HH:MM-HH:MM, порожнє — вихідний)</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {WH_DAYS.map((d) => (
          <label key={d} className="block text-xs text-muted">
            {DAY_LABELS[d]}
            <Input
              value={hours[d] ?? ''}
              onChange={(e) => onDay(d, e.target.value)}
              placeholder="10:00-22:00"
              aria-label={`Години: ${DAY_LABELS[d]}`}
              className="mt-0.5 w-full"
            />
          </label>
        ))}
      </div>
      {fieldErrors &&
        WH_DAYS.map((d) =>
          fieldErrors[`workingHours.${d}`] ? (
            <span key={`wh-${d}`} role="alert" className="block text-danger">
              {fieldErrors[`workingHours.${d}`]}
            </span>
          ) : null,
        )}
    </fieldset>
  )
}
