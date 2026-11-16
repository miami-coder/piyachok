// Куди повертати користувача після входу/реєстрації (query-параметр next).
// Лише внутрішні шляхи — захист від open-redirect: «/x» лишається,
// «//host» (protocol-relative), абсолютні й відносні адреси → «/».
export function safeNextPath(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}
