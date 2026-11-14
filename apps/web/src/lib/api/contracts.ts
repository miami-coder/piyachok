// Легкі контракти відповідей бекенда на межі web↔API. Це НЕ парсер і НЕ заміна
// типів у src/types: схеми перевіряють лише поля, чия неправильна форма реально
// ламає UI (статуси, числа, id); невідповідність логується в консоль (sanity у
// parse.ts), а значення проходить далі як є — деградація замість падіння сторінки.

import { z, type ZodType } from 'zod'

/** Заклад у списках/деталці: статус і числа, які не мусять прийти рядками чи сміттям. */
export const venueContract: ZodType<unknown> = z
  .object({
    id: z.string(),
    status: z.enum(['pending', 'approved', 'rejected', 'archived']),
    ratingAvg: z.union([z.string(), z.number()]).nullable(),
    ratingCount: z.number(),
    latitude: z.union([z.string(), z.number()]).nullable(),
    longitude: z.union([z.string(), z.number()]).nullable(),
    viewCount: z.number(),
  })
  .loose()

export const venueListContract: ZodType<unknown> = z.array(venueContract)

export const tagRefContract: ZodType<unknown> = z
  .object({ id: z.string(), name: z.string(), slug: z.string(), venueCount: z.number() })
  .loose()

export const tagRefListContract: ZodType<unknown> = z.array(tagRefContract)

export const typeRefContract: ZodType<unknown> = z
  .object({ id: z.string(), name: z.string(), slug: z.string() })
  .loose()

export const typeRefListContract: ZodType<unknown> = z.array(typeRefContract)

export const featureRefContract: ZodType<unknown> = z
  .object({ id: z.string(), name: z.string(), code: z.string(), icon: z.string().nullable() })
  .loose()

export const featureRefListContract: ZodType<unknown> = z.array(featureRefContract)

/** Обране (кабінет): рядок у списку — числа ratingAvg для картки. */
export const favoriteContract: ZodType<unknown> = z
  .object({
    id: z.string(),
    name: z.string(),
    address: z.string(),
    ratingAvg: z.union([z.string(), z.number()]).nullable(),
  })
  .loose()

export const favoriteListContract: ZodType<unknown> = z.array(favoriteContract)

// --- Аналітика: числа, на яких будуються бари/ділення (п.21: transformer) ---

const counter = z.union([z.string(), z.number()])

export const timeseriesPointContract: ZodType<unknown> = z
  .object({ date: z.string(), count: counter })
  .loose()

export const timeseriesContract: ZodType<unknown> = z.array(timeseriesPointContract)

export const venueStatContract: ZodType<unknown> = z
  .object({ venueId: z.string(), venueName: z.string().nullable(), views: counter })
  .loose()

export const venueStatsContract: ZodType<unknown> = z.array(venueStatContract)

export const analyticsOverviewContract: ZodType<unknown> = z
  .object({
    totalViews: counter,
    totalEvents: counter,
    eventsByType: z.array(z.object({ eventType: z.string(), count: counter }).loose()),
  })
  .loose()
