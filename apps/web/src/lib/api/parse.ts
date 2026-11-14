import { z, type ZodType } from 'zod'
import type { PaginatedMeta } from '@/types/api'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = null,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; details?: unknown } }
    if (body.error?.code) {
      return new ApiError(res.status, body.error.code, body.error.message ?? 'Помилка запиту', body.error.details ?? null)
    }
  } catch {
    // не-JSON тіло
  }
  return new ApiError(res.status, 'INTERNAL_ERROR', 'Сервіс тимчасово недоступний')
}

export interface ParseOpts<T> {
  /** Жорсткий контракт: невідповідність → ApiError. Для типів, які ламають арифметику/UI. */
  schema?: ZodType<T>
  /** М'який контракт: невідповідність → console.error, значення проходить далі як є. */
  sanity?: ZodType<unknown>
  /** Порожнє тіло → undefined (DELETE → 200 без тіла); без нього порожнє тіло = ApiError. */
  allowEmpty?: boolean
  /** Коерсувати числову meta списку (бекенд іноді повертає її рядками). */
  coerceMeta?: boolean
}

// Контракт meta в ядрі: числова коерція з рядків — та сама семантика, що була
// вручну (Number(...)/Boolean(...)); missing/NaN-поля тепер чесно падають,
// замість тихої NaN-арифметики далі по UI
const META_CONTRACT = z.object({
  page: z.coerce.number(),
  limit: z.coerce.number(),
  total: z.coerce.number(),
  hasMore: z.coerce.boolean(),
})

const CONTRACT_FAIL_MESSAGE = 'Відповідь сервісу не відповідає очікуваній формі'

function summarizeIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.length ? i.path.map(String).join('.') : '(корінь)'}: ${i.message}`).join('; ')
}

function isJsonObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Єдине ядро прочитання відповіді, на якому стоять parseData/parseList/parseEmpty:
 *  1. !ok → ApiError з тіла error ({code, message, details}; не-JSON тіло → INTERNAL_ERROR);
 *  2. тіло читається ОДИН раз текстом — повторний res.json() на вичерпаному
 *     стрімі кидає TypeError, тому і помилки, і успіх — з одного прочитання;
 *  3. не-JSON 2xx (HTML від проксі) → ApiError INTERNAL_ERROR замість сирого SyntaxError;
 *  4. конверт {data} розгортається; порожнє тіло → undefined при allowEmpty;
 *  5. контракти: sanity — лог без зміни значення, schema — жорсткий кидок.
 */
export async function parseEnvelope<T>(
  res: Response,
  opts: ParseOpts<T> = {},
): Promise<{ data: T | undefined; meta: PaginatedMeta | undefined }> {
  const { schema, sanity, allowEmpty = false, coerceMeta = false } = opts
  if (!res.ok) throw await errorFromResponse(res)

  const text = await res.text()
  if (!text.trim()) {
    if (allowEmpty) return { data: undefined, meta: undefined }
    throw new ApiError(res.status, 'INTERNAL_ERROR', 'Сервіс тимчасово недоступний')
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw new ApiError(res.status, 'INTERNAL_ERROR', 'Сервіс тимчасово недоступний')
  }
  if (!isJsonObject(body) || !('data' in body)) {
    throw new ApiError(res.status, 'INTERNAL_ERROR', 'Сервіс тимчасово недоступний')
  }

  let meta: PaginatedMeta | undefined
  if (coerceMeta && body.meta != null) {
    const m = META_CONTRACT.safeParse(body.meta)
    if (m.success) {
      meta = m.data
    } else {
      // meta — допоміжна: невалідну не віддаємо (раніше сюди просовувалась NaN),
      // список лишається робочим, проблема видима в консолі
      console.error('[api] числова meta списку не відповідає контракту —', summarizeIssues(m.error))
    }
  }

  const raw = body.data
  if (sanity) {
    const s = sanity.safeParse(raw)
    if (!s.success) {
      console.error('[api] відповідь не відповідає контракту —', summarizeIssues(s.error))
    }
  }
  if (schema) {
    const s = schema.safeParse(raw)
    if (!s.success) {
      throw new ApiError(res.status, 'INTERNAL_ERROR', CONTRACT_FAIL_MESSAGE, summarizeIssues(s.error))
    }
    return { data: s.data as T, meta }
  }
  return { data: raw as T, meta }
}

/** Звичайний запит: конверт {data} обов'язковий, порожнього тіла не чекаємо. */
export async function parseData<T>(
  res: Response,
  opts: Omit<ParseOpts<T>, 'allowEmpty' | 'coerceMeta'> = {},
): Promise<T> {
  return (await parseEnvelope<T>(res, opts)).data as T
}

/**
 * Список: data (дефолт []) + числова meta (коерціюється з рядків через
 * META_CONTRACT у ядрі).
 */
export async function parseList<T>(
  res: Response,
  opts: Omit<ParseOpts<T[]>, 'allowEmpty' | 'coerceMeta'> = {},
): Promise<{ data: T[]; meta?: PaginatedMeta }> {
  const { data, meta } = await parseEnvelope<T[]>(res, { ...opts, coerceMeta: true })
  return { data: data ?? [], meta }
}

/**
 * Запити, у яких тіло може бути порожнім (DELETE → 200 без тіла):
 * порожнє тіло → undefined, конверт є — розгортається, як parseData.
 */
export function parseEmpty<T>(res: Response): Promise<T | undefined> {
  return parseEnvelope<T>(res, { allowEmpty: true }).then(({ data }) => data)
}
