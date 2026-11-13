'use client'

// Форма редагування закладу: патерн VenueCreateForm, але сабміт — PATCH
// /venues/:id лише зі ЗМІНЕНИМИ полями (venueUpdateSchema). Успіх →
// toast + router.refresh().
//
// PATCH розрізняє «поле відсутнє» (не міняти) і «поле явно очищене»
// (явний null / порожній рядок для тексту = записати NULL у базу). Тому
// очищене поле надсилається як null, а не просто не надсилається.
// Контакти і workingHours замінюються ОБʼЄКТОМ ЦІЛІКОМ, тому при зміні
// хоча б одного поля надсилаємо повний обʼєкт, де очищене поле — null
// (бекенд порожні ключі прибирає сам, решта не втрачається).

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { updateVenue } from '@/services/venues'
import { ApiError } from '@/lib/api/parse'
import { csvToArray, venueUpdateSchema, WH_DAYS } from '@/lib/validation/venue'
import type { Venue } from '@/types/venue'

const DAY_LABELS: Record<string, string> = {
  monday: 'Понеділок', tuesday: 'Вівторок', wednesday: 'Середа', thursday: 'Четвер',
  friday: 'Пʼятниця', saturday: 'Субота', sunday: 'Неділя',
}

export function VenueEditForm({ venue }: { venue: Venue }) {
  const router = useRouter()
  const { toast } = useToast()
  const [name, setName] = useState(venue.name)
  const [address, setAddress] = useState(venue.address)
  const [description, setDescription] = useState(venue.description ?? '')
  const [latitude, setLatitude] = useState(venue.latitude !== null ? String(venue.latitude) : '')
  const [longitude, setLongitude] = useState(venue.longitude !== null ? String(venue.longitude) : '')
  const [phone, setPhone] = useState(venue.contacts.phone ?? '')
  const [instagram, setInstagram] = useState(venue.contacts.instagram ?? '')
  const [facebook, setFacebook] = useState(venue.contacts.facebook ?? '')
  const [website, setWebsite] = useState(venue.contacts.website ?? '')
  const [hours, setHours] = useState<Record<string, string>>({ ...venue.workingHours })
  const [averageCheck, setAverageCheck] = useState(venue.averageCheck !== null ? String(venue.averageCheck) : '')
  const [featureCodes, setFeatureCodes] = useState(venue.features.map((f) => f.code).join(', '))
  const [tagSlugs, setTagSlugs] = useState(venue.tags.map((t) => t.slug).join(', '))
  const [typeSlug, setTypeSlug] = useState(venue.types[0]?.slug ?? '')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    // dto лише зі зміненими полями: змінене опційне → нове значення АБО
    // null, якщо користувач його стер; незмінене → взагалі без ключа
    const dto: Record<string, unknown> = {}
    if (name.trim() !== venue.name) dto.name = name.trim()
    if (address.trim() !== venue.address) dto.address = address.trim()
    if (description.trim() !== (venue.description ?? ''))
      dto.description = description.trim() || null
    const currentLat = venue.latitude !== null ? String(venue.latitude) : ''
    if (latitude.trim() !== currentLat)
      dto.latitude = latitude.trim() ? Number(latitude) : null
    const currentLng = venue.longitude !== null ? String(venue.longitude) : ''
    if (longitude.trim() !== currentLng)
      dto.longitude = longitude.trim() ? Number(longitude) : null
    const contactsChanged =
      phone.trim() !== (venue.contacts.phone ?? '') ||
      instagram.trim() !== (venue.contacts.instagram ?? '') ||
      facebook.trim() !== (venue.contacts.facebook ?? '') ||
      website.trim() !== (venue.contacts.website ?? '')
    if (contactsChanged) {
      // повний обʼєкт: PATCH замінює contacts повністю; очищене поле — null
      dto.contacts = {
        phone: phone.trim() || null,
        instagram: instagram.trim() || null,
        facebook: facebook.trim() || null,
        website: website.trim() || null,
      }
    }
    const hoursChanged = WH_DAYS.some(
      (d) => (hours[d] ?? '').trim() !== (venue.workingHours[d] ?? ''),
    )
    if (hoursChanged) {
      // повний запис: PATCH замінює workingHours повністю; порожній день —
      // не надсилаємо (вихідний)
      dto.workingHours = Object.fromEntries(
        WH_DAYS.map((d) => [d, (hours[d] ?? '').trim()]).filter(([, v]) => v),
      )
    }
    const currentCheck = venue.averageCheck !== null ? String(venue.averageCheck) : ''
    if (averageCheck.trim() !== currentCheck)
      dto.averageCheck = averageCheck.trim() ? Number(averageCheck) : null
    const currentFeatures = venue.features.map((f) => f.code).sort().join(', ')
    if (csvToArray(featureCodes).sort().join(', ') !== currentFeatures)
      dto.featureCodes = csvToArray(featureCodes)
    const currentTags = venue.tags.map((t) => t.slug).sort().join(', ')
    if (csvToArray(tagSlugs).sort().join(', ') !== currentTags)
      dto.tagSlugs = csvToArray(tagSlugs)
    const currentType = venue.types[0]?.slug ?? ''
    if (typeSlug.trim() !== currentType) dto.typeSlug = typeSlug.trim() || null

    const parsed = venueUpdateSchema.safeParse(dto)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Перевірте поля')
      return
    }
    if (Object.keys(parsed.data).length === 0) {
      setError('Немає змін')
      return
    }
    setSending(true)
    try {
      // content-type обовʼязковий: BFF-проксі не проставляє його сам
      await updateVenue(venue.id, parsed.data)
      toast('Зміни збережено')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося зберегти зміни')
    } finally {
      setSending(false)
    }
  }

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
      <fieldset className="rounded-xl border border-line p-3">
        <legend className="px-1 text-sm font-medium">Контакти (порожнє = очистити)</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Телефон" aria-label="Телефон" />
          <Input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="Instagram" aria-label="Instagram" />
          <Input value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="Facebook" aria-label="Facebook" />
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Сайт" aria-label="Сайт" />
        </div>
      </fieldset>
      <fieldset className="rounded-xl border border-line p-3">
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
      </fieldset>
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
