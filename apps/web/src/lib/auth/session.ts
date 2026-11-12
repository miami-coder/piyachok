import 'server-only'
import { cookies } from 'next/headers'
import { backendFetch } from '@/lib/api/server-client'

export const SESSION_COOKIE = 'piyachok_session'

export interface SessionTokens {
  accessToken: string
  refreshToken: string
}

export function encodeTokens(t: SessionTokens): string {
  return JSON.stringify(t)
}

export function decodeTokens(value: string | undefined | null): SessionTokens | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<SessionTokens>
    if (typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
      return { accessToken: parsed.accessToken, refreshToken: parsed.refreshToken }
    }
  } catch {
    // не-JSON
  }
  return null
}

export function sessionCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 30 * 24 * 3600,
    secure: process.env.NODE_ENV === 'production',
  }
}

export async function getSessionTokens(): Promise<SessionTokens | null> {
  const store = await cookies()
  return decodeTokens(store.get(SESSION_COOKIE)?.value)
}

// Читаємо exp із access-JWT без перевірки підпису: це НЕ межа безпеки — підпис і
// права все одно перевіряє бекенд на /auth/me. Це сигнал proxy, чи сесія вже
// прострочена й її треба продовжити через refresh, щоб SSR-рендер не побачив 401.
export function isAccessStale(accessToken: string): boolean {
  try {
    const payloadB64 = accessToken.split('.')[1]
    if (!payloadB64) return false
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8')) as { exp?: number }
    if (typeof payload.exp !== 'number') return false
    // Буфер 60с: токен має дожити не лише до proxy, а й до /auth/me у тому ж рендері
    return payload.exp <= Date.now() / 1000 + 60
  } catch {
    return false
  }
}

// Викликати ЛИШЕ в route handlers / server actions
export async function setSessionCookie(tokens: SessionTokens): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, encodeTokens(tokens), sessionCookieOptions())
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 })
}

export async function refreshTokens(refreshToken: string): Promise<SessionTokens | null> {
  try {
    const res = await backendFetch('/auth/refresh', {
      init: {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      },
    })
    if (!res.ok) return null
    const body = (await res.json()) as { accessToken?: string; refreshToken?: string }
    if (!body.accessToken || !body.refreshToken) return null
    return { accessToken: body.accessToken, refreshToken: body.refreshToken }
  } catch {
    return null
  }
}
