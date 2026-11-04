// Єдина точка, де задається адреса бекенда. Імпортує серверний код: SSR-клієнт
// (server-client), проксі /api/v1, auth-BFF-роути й refresh у сесії. Фолбек —
// localhost:3000 для локального стенду; у docker compose і на проді адреса
// приходить через змінні середовища (compose ставить BACKEND_URL=http://api:3000).

const LOCALHOST_FALLBACK = 'http://localhost:3000'

/** Адреса бекенда для серверних викликів (SSR, проксі, auth-BFF). */
export const BACKEND_URL = process.env.BACKEND_URL ?? LOCALHOST_FALLBACK

/** Адреса бекенда для 302 БРАУЗЕРА (OAuth-старт): BACKEND_URL може бути
 *  docker-імʼям (host.docker.internal), яке браузер на хості не резолвить —
 *  редірект ведемо на публікований порт бекенда. */
export const BROWSER_BACKEND_URL = process.env.PUBLIC_BACKEND_URL ?? LOCALHOST_FALLBACK