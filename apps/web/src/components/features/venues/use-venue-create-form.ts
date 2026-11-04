'use client'

// Логіка форми подання закладу (розмітка — venue-create-form.tsx): усі поля
// формы, збірка DTO, zod-валідація venueCreateSchema перед POST /venues →
// 201. Порожні опційні поля НЕ надсилаємо (whitelist на бекенді, порожні
// рядки ламали б MinLength/regex), успіх → модераційний редірект на кабінет
// з ?created=1. Помилки валідації — по-полівно: ключ = zod-issue path,
// текст = «Поле: причина».

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createVenue, uploadVenuePhoto } from '@/services/venues'
import { ApiError } from '@/lib/api/parse'
import { venueCreateSchema, csvToArray } from '@/lib/validation/venue'

// Ліміт фото при поданні (решту можна додати у вкладці «Фото» кабінету)
export const MAX_PHOTOS = 4

// Людські назви днів: fieldLabel для по-полівних помилок годин + розмітка
// філдсету «Години роботи» у формі
export const DAY_LABELS: Record<string, string> = {
  monday: 'Понеділок', tuesday: 'Вівторок', wednesday: 'Середа', thursday: 'Четвер',
  friday: 'Пʼятниця', saturday: 'Субота', sunday: 'Неділя',
}

// Людські назви полів для по-полівних помилок (ключ — zod-issue path)
const FIELD_LABELS: Record<string, string> = {
  name: 'Назва',
  address: 'Адреса',
  latitude: 'Широта',
  longitude: 'Довгота',
  description: 'Опис',
  'contacts.phone': 'Телефон',
  'contacts.instagram': 'Instagram',
  'contacts.facebook': 'Facebook',
  'contacts.website': 'Сайт',
  workingHours: 'Години роботи',
  averageCheck: 'Середній чек (₴)',
  featureCodes: 'Фічі',
  tagSlugs: 'Теги',
  typeSlug: 'Тип',
}

function fieldLabel(path: ReadonlyArray<PropertyKey>): string {
  const key = path.join('.')
  if (key.startsWith('workingHours.')) {
    const day = String(path[path.length - 1])
    return `Години роботи (${DAY_LABELS[day] ?? day})`
  }
  return FIELD_LABELS[key] ?? key
}

export function useVenueCreateForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [description, setDescription] = useState('')
  const [phone, setPhone] = useState('')
  const [instagram, setInstagram] = useState('')
  const [facebook, setFacebook] = useState('')
  const [website, setWebsite] = useState('')
  const [hours, setHours] = useState<Record<string, string>>({})
  const [averageCheck, setAverageCheck] = useState('')
  const [featureCodes, setFeatureCodes] = useState('')
  const [tagSlugs, setTagSlugs] = useState('')
  const [typeSlug, setTypeSlug] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    const workingHours = Object.fromEntries(
      Object.entries(hours).filter(([, v]) => v.trim()),
    )
    const dto = {
      name,
      address,
      latitude: latitude.trim() ? Number(latitude) : undefined,
      longitude: longitude.trim() ? Number(longitude) : undefined,
      description: description.trim() || undefined,
      contacts: (phone.trim() || instagram.trim() || facebook.trim() || website.trim())
        ? {
            ...(phone.trim() ? { phone } : {}),
            ...(instagram.trim() ? { instagram } : {}),
            ...(facebook.trim() ? { facebook } : {}),
            ...(website.trim() ? { website } : {}),
          }
        : undefined,
      workingHours: Object.keys(workingHours).length ? workingHours : undefined,
      averageCheck: averageCheck.trim() ? Number(averageCheck) : undefined,
      featureCodes: csvToArray(featureCodes).length ? csvToArray(featureCodes) : undefined,
      tagSlugs: csvToArray(tagSlugs).length ? csvToArray(tagSlugs) : undefined,
      typeSlug: typeSlug.trim() || undefined,
    }
    const parsed = venueCreateSchema.safeParse(dto)
    if (!parsed.success) {
      // Кожна issue — під своїм інпутом: ключ = zod path, текст = «Поле: причина»
      const errors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.length ? issue.path.join('.') : '_'
        if (!errors[key]) errors[key] = `${fieldLabel(issue.path)}: ${issue.message}`
      }
      setFieldErrors(errors)
      return
    }
    setSending(true)
    try {
      const created = await createVenue(parsed.data)
      // Фото — після створення (ендпоінт привʼязаний до id): по одному файлу
      // на запит. Помилка окремого фото не скасовує подання (заклад уже
      // створений) — редірект іде далі, повторно завантажити можна у
      // вкладці «Фото» кабінету.
      for (const file of photos) {
        if (!created) break // id немає (напр., порожнє тіло) — фото нікуди слати
        await uploadVenuePhoto(created.id, file)
      }
      router.push('/account/venues?created=1')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося подати заклад')
      setSending(false)
    }
  }

  // Додавання фото: дублікат (та сам файл двічі) — ігноруємо; спільний ліміт 4
  function addPhotos(picked: File[]) {
    setPhotos((prev) => {
      const merged = [
        ...prev,
        ...picked.filter((p) => !prev.some((q) => q.name === p.name && q.size === p.size)),
      ]
      return merged.slice(0, MAX_PHOTOS)
    })
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  return {
    name, setName, address, setAddress,
    latitude, setLatitude, longitude, setLongitude,
    description, setDescription,
    phone, setPhone, instagram, setInstagram, facebook, setFacebook, website, setWebsite,
    hours, setHours, averageCheck, setAverageCheck,
    featureCodes, setFeatureCodes, tagSlugs, setTagSlugs, typeSlug, setTypeSlug,
    photos, addPhotos, removePhoto,
    fieldErrors, error, sending, submit,
  }
}