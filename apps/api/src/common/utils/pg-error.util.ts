/** Коди помилок Postgres, до яких маємо сенс реагувати в застосунку.
 *  Довідник: www.postgresql.org/docs/current/errcodes-appendix.html */
export const PG_CODES = {
  /** Порушення унік-контрейнту або PK — переважно гонка паралельних дублікатів */
  UNIQUE_VIOLATION: '23505',
  /** Невалідний UUID/число у параметрі — каст впав, це помилка запиту, не сервера */
  INVALID_TEXT_REPRESENTATION: '22P02',
} as const;

export type PgErrorCode = (typeof PG_CODES)[keyof typeof PG_CODES];

/** TypeORM (QueryFailedError від pg-драйвера) кладе PG'шний code прямо
 *  на обʼєкт помилки — звідси й читаємо. Помилки зі справжнім code теж
 *  проходять гвард, тож у спеках достатньо мокати { code: '...' }. */
export function isPgError(e: unknown, ...codes: PgErrorCode[]): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const code = (e as { code?: unknown }).code;
  if (typeof code !== 'string') return false;
  return (codes as string[]).includes(code);
}
