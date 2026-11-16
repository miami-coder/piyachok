'use client'

// Форма реєстрації: та сама схема, що LoginForm — клієнтська валідація через
// registerSchema (помилки полів рендеримо окремо від label і прив'язуємо
// aria-describedby), POST на BFF-хендлер /api/auth/register, після успіху —
// /auth/me → setUser → редірект.

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useUser } from '@/components/providers/user-provider'
import { authMe, authRegister } from '@/services/auth'
import { registerSchema } from '@/lib/validation/auth'
import { safeNextPath } from '@/lib/utils/safe-next'

const INITIAL_FORM = {
  firstname: '',
  lastname: '',
  email: '',
  password: '',
  age: '',
  phone: '',
  acceptEula: false,
}

// Поле реєстрації: id — reg-<name>, помилка — reg-<name>-error (aria-describedby)
function Field({ name, label, type, autoComplete, min, value, error, onChange }: {
  name: string
  label: string
  type?: string
  autoComplete?: string
  min?: number
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  const id = `reg-${name}`
  return (
    <div className="text-sm">
      <label htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        type={type}
        min={min}
        aria-describedby={error ? `${id}-error` : undefined}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && (
        <span id={`${id}-error`} role="alert" className="mt-1 block text-danger">{error}</span>
      )}
    </div>
  )
}

export function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { setUser } = useUser()
  const [form, setForm] = useState(INITIAL_FORM)
  // Помилки полів з zod: { ім'я поля => український текст }
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function setField<K extends keyof typeof INITIAL_FORM>(key: K, value: (typeof INITIAL_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    // Клієнтська валідація до будь-якого запиту в мережу;
    // порожні опціональні поля не відправляємо на бекенд
    const parsed = registerSchema.safeParse({
      ...form,
      age: form.age === '' ? undefined : form.age,
      phone: form.phone === '' ? undefined : form.phone,
    })
    if (!parsed.success) {
      const errors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '')
        if (!errors[key]) errors[key] = issue.message
      }
      setFieldErrors(errors)
      return
    }
    setLoading(true)
    try {
      const res = await authRegister(parsed.data)
      if (res.ok) {
        const me = await authMe()
        if (me) setUser(me)
        router.push(safeNextPath(searchParams.get('next')))
        router.refresh()
        return
      }
      // 409: email зайнято / EULA не прийнято; 422: помилки полів DTO
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      setError(body?.error?.message ?? 'Не вдалося зареєструватися')
    } catch {
      setError('Сервіс тимчасово недоступний')
    } finally {
      setLoading(false)
    }
  }

  return (
    // noValidate: валідацію робимо через zod, нативні бульбашки браузера конфліктують з інлайн-помилками
    <form noValidate onSubmit={submit} className="mx-auto max-w-sm space-y-4 rounded-xl border border-line bg-surface p-6">
      <h1 className="font-display text-xl font-bold text-ink">Реєстрація</h1>
      {error && <p role="alert" className="rounded-lg bg-danger/15 p-2 text-sm text-danger">{error}</p>}
      {/* Помилка — сусід label, а не вкладена в нього: не забруднює accessible name;
          зв'язок через aria-describedby */}
      <Field name="firstname" label="Ім'я" autoComplete="given-name" value={form.firstname} error={fieldErrors.firstname} onChange={(v) => setField('firstname', v)} />
      <Field name="lastname" label="Прізвище" autoComplete="family-name" value={form.lastname} error={fieldErrors.lastname} onChange={(v) => setField('lastname', v)} />
      <Field name="email" label="Email" type="email" autoComplete="email" value={form.email} error={fieldErrors.email} onChange={(v) => setField('email', v)} />
      <Field name="password" label="Пароль" type="password" autoComplete="new-password" value={form.password} error={fieldErrors.password} onChange={(v) => setField('password', v)} />
      <Field name="age" label="Вік (необов'язково)" type="number" min={18} value={form.age} error={fieldErrors.age} onChange={(v) => setField('age', v)} />
      <Field name="phone" label="Телефон (необов'язково)" type="tel" autoComplete="tel" value={form.phone} error={fieldErrors.phone} onChange={(v) => setField('phone', v)} />
      {/* aria-describedby веде на текст EULA: скрінрідер озвучує умови після чекбокса */}
      <label id="eula-text" className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-amber-500"
          checked={form.acceptEula}
          aria-describedby="eula-text"
          onChange={(e) => setField('acceptEula', e.target.checked)}
        />
        Приймаю умови угоди користувача
      </label>
      {fieldErrors.acceptEula && <span role="alert" className="block text-sm text-danger">{fieldErrors.acceptEula}</span>}
      <Button type="submit" disabled={loading} className="w-full">{loading ? 'Реєструємо…' : 'Зареєструватися'}</Button>
      {/* Соцмережі — як на вході: обведені кнопки після розділювача */}
      <div className="flex items-center gap-3" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs text-faint">або</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <a href="/api/auth/google" className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-strong px-5 py-2.5 text-sm font-medium text-ink transition-colors hover:border-amber-500/60 hover:bg-raised">Увійти через Google</a>
      <p className="text-center text-sm">
        Вже маєте акаунт?{' '}
        <Link className="text-amber-500 hover:underline" href="/auth/login">Увійти</Link>
      </p>
    </form>
  )
}
