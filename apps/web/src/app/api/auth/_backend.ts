import { NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api/backend'

export { BACKEND_URL as backendUrl, BROWSER_BACKEND_URL as browserBackendUrl } from '@/lib/api/backend'

/** Викликає auth-ендпоінт бекенда; повертає NextResponse або JSON-помилку бекенда. */
export async function postBackend(path: string, body: unknown): Promise<NextResponse> {
  let res: Response
  try {
    res = await fetch(`${BACKEND_URL}/api/v1${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // Бекенд недоступний (мережа) — 502 за контрактом помилок
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Сервіс тимчасово недоступний', details: null } },
      { status: 502 },
    )
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    return NextResponse.json(json ?? { error: { code: 'INTERNAL_ERROR', message: 'Сервіс тимчасово недоступний' } }, { status: res.status })
  }
  return NextResponse.json(json)
}