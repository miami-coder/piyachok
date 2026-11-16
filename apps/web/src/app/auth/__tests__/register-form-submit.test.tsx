import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Параметри пошуку керуються з тестів: next читається через useSearchParams()
const { push, refresh, setUser, nav } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  setUser: vi.fn(),
  nav: { search: '' },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => new URLSearchParams(nav.search),
}))
vi.mock('@/components/providers/user-provider', () => ({
  useUser: () => ({ user: null, setUser, logout: vi.fn() }),
}))

import { RegisterForm } from '@/app/auth/register/register-form'

const sessionUser = { id: 'u1', email: 'a@b.ua', roles: ['user'] }
const jsonHeaders = { 'content-type': 'application/json' }

// /api/auth/register — відповідь register; /api/v1/auth/me — сесія
function mockFetch(register: () => Response | Promise<Response>) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/auth/me')) {
      return new Response(JSON.stringify({ data: sessionUser }), { headers: jsonHeaders })
    }
    return register()
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const registerCalls = (fn: ReturnType<typeof vi.fn>) =>
  fn.mock.calls.filter(([u]) => String(u) === '/api/auth/register')

function fillRequired() {
  fireEvent.change(screen.getByLabelText("Ім'я", { selector: 'input' }), { target: { value: 'Олена' } })
  fireEvent.change(screen.getByLabelText('Прізвище'), { target: { value: 'Коваль' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'olena@test.ua' } })
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Passw0rdX' } })
  fireEvent.click(screen.getByLabelText(/Приймаю умови/))
}
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Зареєструватися' }))

beforeEach(() => {
  push.mockClear()
  refresh.mockClear()
  setUser.mockClear()
  nav.search = ''
  vi.unstubAllGlobals()
})

describe('RegisterForm: відправка', () => {
  it('успіх: тіло без порожніх age/phone, setUser з /auth/me, редірект на «/» і refresh', async () => {
    const fn = mockFetch(() => new Response('{}', { status: 200, headers: jsonHeaders }))
    render(<RegisterForm />)
    fillRequired()
    submit()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/'))
    expect(registerCalls(fn)).toHaveLength(1)
    const sent = JSON.parse((registerCalls(fn)[0][1] as RequestInit).body as string)
    expect(sent).toEqual({
      firstname: 'Олена', lastname: 'Коваль', email: 'olena@test.ua',
      password: 'Passw0rdX', acceptEula: true,
    })
    expect(setUser).toHaveBeenCalledWith(sessionUser)
    expect(refresh).toHaveBeenCalled()
  })

  it('заповнені age і phone йдуть у тілі (age — числом)', async () => {
    const fn = mockFetch(() => new Response('{}', { status: 200, headers: jsonHeaders }))
    render(<RegisterForm />)
    fillRequired()
    fireEvent.change(screen.getByLabelText(/Вік/), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText(/Телефон/), { target: { value: '+380671234567' } })
    submit()
    await waitFor(() => expect(push).toHaveBeenCalled())
    const sent = JSON.parse((registerCalls(fn)[0][1] as RequestInit).body as string)
    expect(sent).toMatchObject({ age: 25, phone: '+380671234567' })
  })

  it.each([
    ['внутрішній шлях', '/venues/v1', '/venues/v1'],
    ['без next', '', '/'],
    ['protocol-relative //evil.com', '//evil.com', '/'],
    ['абсолютний https://evil.com', 'https://evil.com', '/'],
    ['відносний без слеша', 'venues/v1', '/'],
    ['слеш+зворотний слеш /\\evil.com', '/\\evil.com', '/'],
    ['три слеші ///evil.com', '///evil.com', '/'],
    ['TAB усередині', '/\t/evil.com', '/'],
    ['закодований /%2F%2Fevil.com (шлях на нашому сайті)', '/%2F%2Fevil.com', '/%2F%2Fevil.com'],
    ['query і hash зберігаються', '/venues/v1?tab=reviews#top', '/venues/v1?tab=reviews#top'],
  ])('next: %s → %s', async (_name, next, expected) => {
    nav.search = next ? `next=${encodeURIComponent(next)}` : ''
    mockFetch(() => new Response('{}', { status: 200, headers: jsonHeaders }))
    render(<RegisterForm />)
    fillRequired()
    submit()
    await waitFor(() => expect(push).toHaveBeenCalledWith(expected))
  })

  it('409: показує повідомлення з тіла, без редіректу', async () => {
    mockFetch(() => new Response(
      JSON.stringify({ error: { code: 'CONFLICT', message: 'Email вже зайнятий', details: null } }),
      { status: 409, headers: jsonHeaders },
    ))
    render(<RegisterForm />)
    fillRequired()
    submit()
    expect(await screen.findByText('Email вже зайнятий')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
    expect(setUser).not.toHaveBeenCalled()
  })

  it('помилка без JSON-тіла → «Не вдалося зареєструватися»', async () => {
    mockFetch(() => new Response('oops', { status: 500 }))
    render(<RegisterForm />)
    fillRequired()
    submit()
    expect(await screen.findByText('Не вдалося зареєструватися')).toBeInTheDocument()
  })

  it('мережева помилка → «Сервіс тимчасово недоступний»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))
    render(<RegisterForm />)
    fillRequired()
    submit()
    expect(await screen.findByText('Сервіс тимчасово недоступний')).toBeInTheDocument()
    expect(push).not.toHaveBeenCalled()
  })

  it('поки запит у польоті: кнопка «Реєструємо…» заблокована, другий запит не йде', async () => {
    let resolve!: (r: Response) => void
    const pending = new Promise<Response>((r) => { resolve = r })
    const fn = mockFetch(() => pending)
    render(<RegisterForm />)
    fillRequired()
    submit()
    const busy = await screen.findByRole('button', { name: 'Реєструємо…' })
    expect(busy).toBeDisabled()
    fireEvent.click(busy)
    expect(registerCalls(fn)).toHaveLength(1)
    resolve(new Response('{}', { status: 200, headers: jsonHeaders }))
    await waitFor(() => expect(push).toHaveBeenCalled())
  })
})

describe('RegisterForm: валідація', () => {
  it('порожня форма: запиту немає, кожне поле отримує свою помилку з id <поле>-error', () => {
    const fn = mockFetch(() => new Response('{}'))
    render(<RegisterForm />)
    submit()
    expect(fn).not.toHaveBeenCalled()
    const expectations: [string, string, string][] = [
      ['reg-firstname', 'reg-firstname-error', 'Мінімум 2 символи'],
      ['reg-lastname', 'reg-lastname-error', 'Мінімум 2 символи'],
      ['reg-email', 'reg-email-error', 'Некоректний email'],
      ['reg-password', 'reg-password-error', 'Мінімум 8 символів'],
    ]
    for (const [inputId, errId, text] of expectations) {
      expect(document.getElementById(inputId)).toHaveAttribute('aria-describedby', errId)
      const err = document.getElementById(errId)
      expect(err).toHaveAttribute('role', 'alert')
      expect(err).toHaveTextContent(text)
    }
    // EULA: окреме повідомлення role="alert" без привʼязки до id поля
    expect(screen.getByText('Потрібно прийняти угоду користувача')).toHaveAttribute('role', 'alert')
  })

  it('необовʼязкові age/phone без значень не дають помилок', () => {
    mockFetch(() => new Response('{}'))
    render(<RegisterForm />)
    submit()
    expect(document.getElementById('reg-age-error')).toBeNull()
    expect(document.getElementById('reg-phone-error')).toBeNull()
    expect(document.getElementById('reg-age')).not.toHaveAttribute('aria-describedby')
  })

  it('невалідний вік (17) → помилка поля age', () => {
    mockFetch(() => new Response('{}'))
    render(<RegisterForm />)
    fillRequired()
    fireEvent.change(screen.getByLabelText(/Вік/), { target: { value: '17' } })
    submit()
    expect(document.getElementById('reg-age-error')).toHaveTextContent('Мінімум 18 років')
    expect(push).not.toHaveBeenCalled()
  })

  it('повторна відправка очищає старі помилки полів', async () => {
    mockFetch(() => new Response('{}', { status: 200, headers: jsonHeaders }))
    render(<RegisterForm />)
    submit()
    expect(document.getElementById('reg-email-error')).not.toBeNull()
    fillRequired()
    submit()
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(document.getElementById('reg-email-error')).toBeNull()
  })

  it('атрибути полів: autoComplete, type, min для віку, noValidate на формі', () => {
    mockFetch(() => new Response('{}'))
    const { container } = render(<RegisterForm />)
    expect(document.getElementById('reg-firstname')).toHaveAttribute('autocomplete', 'given-name')
    expect(document.getElementById('reg-lastname')).toHaveAttribute('autocomplete', 'family-name')
    expect(document.getElementById('reg-email')).toHaveAttribute('type', 'email')
    expect(document.getElementById('reg-password')).toHaveAttribute('autocomplete', 'new-password')
    expect(document.getElementById('reg-age')).toHaveAttribute('min', '18')
    expect(document.getElementById('reg-phone')).toHaveAttribute('type', 'tel')
    expect(container.querySelector('form')).toHaveAttribute('novalidate')
  })
})
