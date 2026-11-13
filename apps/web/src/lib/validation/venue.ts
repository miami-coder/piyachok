import { z } from 'zod'

export const WH_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const

// Людські назви днів (uk) для філдсетів годин у формах закладу і текстів
// помилок «Години роботи (День)». Єдине джерело: імпортують форми і показ
// годин у карточці (working-hours.tsx).
// Пʼятниця — типографський апостроф (U+2019), уникає \'-екранування.
export const DAY_LABELS: Record<string, string> = {
  monday: 'Понеділок', tuesday: 'Вівторок', wednesday: 'Середа', thursday: 'Четвер',
  friday: 'П’ятниця', saturday: 'Субота', sunday: 'Неділя',
}

const timeRangeRe = /^\d{2}:\d{2}-\d{2}:\d{2}$/

export function csvToArray(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean)
}

// null у опційних полях PATCH = «очистити» (бекенд пише NULL у базу),
// відсутнє поле = не міняти — тому nullish замість optional
const contactsSchema = z
  .object({
    phone: z.string().trim().nullish(),
    instagram: z.string().trim().nullish(),
    facebook: z.string().trim().nullish(),
    website: z.string().trim().nullish(),
  })
  .nullish()

export const venueCreateSchema = z.object({
  name: z.string().trim().min(3, 'Мінімум 3 символи'),
  address: z.string().trim().min(5, 'Мінімум 5 символів'),
  description: z.string().trim().nullish(),
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
  contacts: contactsSchema,
  workingHours: z
    .record(z.string(), z.string().regex(timeRangeRe, 'Формат: HH:MM-HH:MM'))
    .nullish(),
  averageCheck: z.coerce.number().min(0, 'Не менше 0').nullish(),
  featureCodes: z.array(z.string()).max(20, 'Максимум 20').nullish(),
  tagSlugs: z.array(z.string()).max(20, 'Максимум 20').nullish(),
  typeSlug: z.string().trim().nullish(),
})

export const venueUpdateSchema = venueCreateSchema.partial()

export type VenueCreateValues = z.infer<typeof venueCreateSchema>
export type VenueUpdateValues = z.infer<typeof venueUpdateSchema>
