// Розбір діапазону дат — один спільний фрагмент замість копій у
// адмін-аналітиці, аналітиці закладу і фільтрі пиячок: регекс валідності,
// дефолтний період і парсинг одного query-параметра.

// Формат дати з URL (YYYY-MM-DD): сире значення з query не інтерполюємо
// у запит — невалідне відкидаємо (на дефолт або «фільтр не застосовується»)
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Дефолтний період аналітики: to = сьогодні, from = to − 30 днів
// (en-CA дає YYYY-MM-DD). react-hooks/purity не пускає Date.now()/new Date()
// прямо в рендері — тому це функція, виклик всередині серверного компонента.
export function defaultAnalyticsRange(): { from: string; to: string } {
  return {
    to: new Date().toLocaleDateString('en-CA'),
    from: new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA'),
  }
}

// Один query-параметр-дата: валідний YYYY-MM-DD → значення, інакше fallback
// (undefined — «фільтр просто не застосовується», конкретна дата — дефолт періоду).
// Перегрузка: з обовʼязковим фолбеком гарантовано рядок (дефолтний період
// аналітики не може стати undefined після відкидання невалідного query).
export function dateParam(value: string | undefined, fallback: string): string
export function dateParam(
  value: string | undefined,
  fallback?: undefined,
): string | undefined
export function dateParam(
  value: string | undefined,
  fallback?: string,
): string | undefined {
  return value && DATE_RE.test(value) ? value : fallback
}
