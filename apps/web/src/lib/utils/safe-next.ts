// Куди повертати користувача після входу/реєстрації (query-параметр next).
// Лише внутрішні шляхи — захист від open-redirect. router.push розбирає
// рядок парсером WHATWG URL (new URL(href, location.href)), який вважає «\»
// слешем і викидає TAB/LF/CR всередині, тож «/\evil.com» чи «/<TAB>/evil.com»
// ведуть на чужий origin. Тому поряд із перевіркою рядка результат звіряємо
// тим самим парсером. Безпечний шлях повертаємо без змін.
const BASE = 'http://internal.invalid'

export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(next)) return '/'
  try {
    return new URL(next, BASE).origin === BASE ? next : '/'
  } catch {
    return '/'
  }
}
