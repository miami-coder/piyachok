'use client'

// Розмітка форми редагування закладу; стан і логіка — в useVenueEditForm
// (use-venue-edit-form.ts): diff-only PATCH /venues/:id, помилки — першою
// issue. Повторювані філдсети «Контакти» / «Години роботи» — спільні
// з формою створення (venue-form-fieldsets.tsx).

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ContactsFieldset, WorkingHoursFieldset } from '@/components/features/venues/venue-form-fieldsets'
import { useVenueEditForm } from './use-venue-edit-form'
import type { Venue } from '@/types/venue'

export function VenueEditForm({ venue }: { venue: Venue }) {
  const {
    name, setName, address, setAddress,
    latitude, setLatitude, longitude, setLongitude,
    description, setDescription,
    contacts, setContact,
    hours, setHours, averageCheck, setAverageCheck,
    featureCodes, setFeatureCodes, tagSlugs, setTagSlugs, typeSlug, setTypeSlug,
    error, sending, submit,
  } = useVenueEditForm({ venue })

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Редагування закладу">
      <label className="block text-sm font-medium">Назва
        <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full" />
      </label>
      <label className="block text-sm font-medium">Адреса
        <Input value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1 w-full" />
      </label>
      <label className="block text-sm font-medium">Опис
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1 w-full" />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">Широта
          <Input value={latitude} onChange={(e) => setLatitude(e.target.value)} className="mt-1 w-full" inputMode="decimal" />
        </label>
        <label className="block text-sm font-medium">Довгота
          <Input value={longitude} onChange={(e) => setLongitude(e.target.value)} className="mt-1 w-full" inputMode="decimal" />
        </label>
      </div>
      {/* Порожній інпут тут = очистити поле (на відміну від create, де
          порожні просто не шлються) — звідси підказка в legend */}
      <ContactsFieldset
        contacts={contacts}
        onField={setContact}
        legend="Контакти (порожнє = очистити)"
      />
      <WorkingHoursFieldset
        hours={hours}
        onDay={(d, v) => setHours((h) => ({ ...h, [d]: v }))}
      />
      <label className="block text-sm font-medium">Середній чек (₴)
        <Input type="number" min="0" value={averageCheck} onChange={(e) => setAverageCheck(e.target.value)} className="mt-1 w-full" />
      </label>
      <label className="block text-sm font-medium">Фічі (через кому, до 20)
        <Input value={featureCodes} onChange={(e) => setFeatureCodes(e.target.value)} className="mt-1 w-full" />
      </label>
      <label className="block text-sm font-medium">Теги (через кому, до 20)
        <Input value={tagSlugs} onChange={(e) => setTagSlugs(e.target.value)} className="mt-1 w-full" />
      </label>
      <label className="block text-sm font-medium">Тип (slug)
        <Input value={typeSlug} onChange={(e) => setTypeSlug(e.target.value)} className="mt-1 w-full" />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={sending}>{sending ? 'Зберігаємо…' : 'Зберегти зміни'}</Button>
    </form>
  )
}
