# Пиячок — фронтенд

Каталог закладів «Пиячок»: Next.js 16 App Router, React 19, TypeScript, Tailwind v4. Інтерфейс — українською. Порт `3001`, потрібен запущений бекенд на `:3000`.

## Технології і навіщо вони

- **Next.js 16 (App Router) + React 19** — SSR-каталог (фільтри й сорти зберігаються в URL і віддаються з сервера) плюс клієнтські компоненти там, де потрібна взаємодія; React Compiler увімкнено (`reactCompiler: true`) — автоматична оптимізація ре-рендерів.
- **TypeScript** — типи відповідей API зведені у `src/types/*`, що дає контракт з бекендом на рівні компіляції.
- **Tailwind v4** — атомарні стилі; дизайн-токени (кольори, шрифти) описані напряму в CSS (`@tailwindcss/postcss`).
- **BFF-проксі Next.js route handlers** (`src/app/api/v1/[...path]`, `src/app/api/auth/*`) — JWT зберігається **в httpOnly cookie**, клієнтський JS його не бачить; проксі інжектує `Authorization`, сам рефрешить токени і виставляє cookie при логіні/логауті. Безпечніше за токени в `localStorage` й не потребує окремого сесійного бекенду.
- **Zod** — валідація форм на клієнті (реєстрація, подача закладу, відгук, новина, зустріч, скарга) до відправки на бекенд.
- **Vitest + Testing Library + jsdom** — unit і компонентні тести (сторінки, компоненти, BFF, `lib/`), команда `pnpm test`.
- **ESLint 9 + eslint-config-next** — лінт за правилами Next.js.
- **pnpm**, Node 22, Docker (спільний compose-стек у корені монорепо).

## Запуск через Docker

Compose-файл спільний для всього стека і лежить у корені монорепо (у цій папці compose-файлу немає):

```bash
docker compose up -d --build web
```

Підніме сервіс `web` на `http://localhost:3001`; `BACKEND_URL` у нього прописаний на контейнер `api` того ж стека, нічого конфігурувати не треба. Hot-reload у контейнері не передбачений — вихідники запікаються в образ, тож після змін фронта перезберіть (`docker compose up -d --build web`); для розробки з hot-reload запускайте локально (`pnpm dev`).

Логи: `docker compose logs -f web`. Зупинка: `docker compose down`.

## Запуск без Docker

Потрібні Node 22 і pnpm, і бекенд на `http://localhost:3000`.

1. Змінні оточення:

   ```bash
   cp .env.example .env.local
   ```

   `.env.local`: `BACKEND_URL=http://localhost:3000` — адреса бекенда, куди фронте́нд проксує `/api/v1`.

2. Залежності та dev-сервер:

   ```bash
   pnpm install
   pnpm dev
   # → http://localhost:3001
   ```

3. Тести:

   ```bash
   pnpm test
   ```