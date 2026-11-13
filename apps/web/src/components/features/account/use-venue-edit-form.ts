'use client'

// Логіка форми редагування закладу (розмітка — venue-edit-form.tsx):
// префіл із venue, сабміт — PATCH /venues/:id лише зі ЗМІНЕНИМИ полями
// (venueUpdateSchema). Успіх → toast + router.refresh().
//
// PATCH розрізняє «поле відсутнє» (не міняти) і «поле явно очищене»
// (явний null / порожній рядок для тексту = записати NULL у базу). Тому
// очищене поле надсилається як null, а не просто не надсилається.
// Контакти і workingHours замінюються ОБʼЄКТОМ ЦІЛІКОМ, тому при зміні
// хоча б одного поля надсилаємо повний обʼєкт, де очищене поле — null
// (бекенд порожні ключі прибирає сам, решта не втрачається).

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { updateVenue } from '@/services/venues'
import { useToast } from '@/components/ui/toast'
import { ApiError } from '@/lib/api/parse'
import { csvToArray, venueUpdateSchema, WH_DAYS } from '@/lib/validation/venue'
import type { ContactField } from '@/components/features/venues/venue-form-fieldsets'
import type { Venue } from '@/types/venue'

const CONTACT_FIELDS: ContactField[] = ['phone', 'instagram', 'facebook', 'website']

export function useVenueEditForm({ venue }: { venue: Venue }) {
  const router = useRouter()
  const { toast } = useToast()
  const [name, setName] = useState(venue.name)
  const [address, setAddress] = useState(venue.address)
  const [description, setDescription] = useState(venue.description ?? '')
  const [latitude, setLatitude] = useState(venue.latitude !== null ? String(venue.latitude) : '')
  const [longitude, setLongitude] = useState(venue.longitude !== null ? String(venue.longitude) : '')
  const [contacts, setContacts] = useState<Record<ContactField, string>>({
    phone: venue.contacts.phone ?? '',
    instagram: venue.contacts.instagram ?? '',
    facebook: venue.contacts.facebook ?? '',
    website: venue.contacts.website ?? '',
  })
  const [hours, setHours] = useState<Record<string, string>>({ ...venue.workingHours })
  const [averageCheck, setAverageCheck] = useState(venue.averageCheck !== null ? String(venue.averageCheck) : '')
  const [featureCodes, setFeatureCodes] = useState(venue.features.map((f) => f.code).join(', '))
  const [tagSlugs, setTagSlugs] = useState(venue.tags.map((t) => t.slug).join(', '))
  const [typeSlug, setTypeSlug] = useState(venue.types[0]?.slug ?? '')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  function setContact(field: ContactField, value: string) {
    setContacts((prev) => ({ ...prev, [field]: value }))
  }

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
    const contactsChanged = CONTACT_FIELDS.some(
      (f) => contacts[f].trim() !== (venue.contacts[f] ?? ''),
    )
    if (contactsChanged) {
      // повний обʼєкт: PATCH замінює contacts повністю; очищене поле — null
      dto.contacts = {
        phone: contacts.phone.trim() || null,
        instagram: contacts.instagram.trim() || null,
        facebook: contacts.facebook.trim() || null,
        website: contacts.website.trim() || null,
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

  return {
    name, setName, address, setAddress,
    latitude, setLatitude, longitude, setLongitude,
    description, setDescription,
    contacts, setContact,
    hours, setHours, averageCheck, setAverageCheck,
    featureCodes, setFeatureCodes, tagSlugs, setTagSlugs, typeSlug, setTypeSlug,
    error, sending, submit,
  }
}
