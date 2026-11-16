import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { push, refresh, nav } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), nav: { search: '' } }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => new URLSearchParams(nav.search),
}))
vi.mock('@/components/providers/user-provider', () => ({
  useUser: () => ({ user: null, setUser: vi.fn(), logout: vi.fn() }),
}))

import { LoginForm } from '@/app/auth/login/login-form'

beforeEach(() => {
  push.mockClear()
  refresh.mockClear()
  vi.unstubAllGlobals()
})

describe('LoginForm: редірект після входу', () => {
  it.each([
    ['внутрішній шлях', '/venues/v1', '/venues/v1'],
    ['без next', '', '/'],
    ['protocol-relative //evil.com', '//evil.com', '/'],
    ['абсолютний https://evil.com', 'https://evil.com', '/'],
  ])('next: %s → %s', async (_name, next, expected) => {
    nav.search = next ? `next=${encodeURIComponent(next)}` : ''
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith('/auth/me')
        ? new Response(JSON.stringify({ data: { id: 'u1', email: 'a@b.ua', roles: ['user'] } }), { headers: { 'content-type': 'application/json' } })
        : new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    ))
    render(<LoginForm />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.ua' } })
    fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: 'Passw0rdX' } })
    fireEvent.click(screen.getByRole('button', { name: 'Увійти' }))
    await waitFor(() => expect(push).toHaveBeenCalledWith(expected))
    expect(refresh).toHaveBeenCalled()
  })
})
