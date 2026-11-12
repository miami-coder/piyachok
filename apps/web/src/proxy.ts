import { NextResponse, type NextRequest } from 'next/server'
import {
  SESSION_COOKIE,
  decodeTokens,
  encodeTokens,
  isAccessStale,
  refreshTokens,
  sessionCookieOptions,
} from '@/lib/auth/session'

// F5 чи прямий перехід на захищені сторінки — SSR-рендер, а не браузерні
// fetch. Клієнтський авто-refresh живе в проксі /api/v1/[...path] і сюди не
// доходить, тому з простроченим access-токеном layout відправляв би на логін, хоч
// refresh-токен у куці живий. Тут, ДО рендера, продовжуємо сесію.
//
// Куки писати можна лише тут (у route handlers/server actions/RSC — не можна),
// тому ротація токенів після одноразового refresh теж персиститься саме тут.
export async function proxy(request: NextRequest) {
  const tokens = decodeTokens(request.cookies.get(SESSION_COOKIE)?.value)
  // Куки немає / токен ще свіжий / payload не прочитався — нічого не робимо:
  // layout сам покаже логін, якщо бекенд відповість 401
  if (!tokens || !isAccessStale(tokens.accessToken)) return NextResponse.next()

  const fresh = await refreshTokens(tokens.refreshToken)
  // Refresh теж помер — віддаємо як є: існуюча поведінка (redirect на логін)
  if (!fresh) return NextResponse.next()

  // Свіжі токени — і в поточний запит (щоб /auth/me у цьому ж рендері пішов
  // з ними), і в відповідь (щоб ротація дожила в браузері)
  const encoded = encodeTokens(fresh)
  request.cookies.set(SESSION_COOKIE, encoded)
  const response = NextResponse.next({ request })
  response.cookies.set(SESSION_COOKIE, encoded, sessionCookieOptions())
  return response
}

export const config = {
  // Вузько, ровно захищені зони: на публічних сторінках прострочений
  // access-токен нічого не ламає, а тут кожен прохід — можливий refresh-код
  // на бекенді. /api/* не потрапляє: у проксі-роуті свій авто-refresh.
  matcher: ['/account/:path*', '/admin/:path*'],
}
