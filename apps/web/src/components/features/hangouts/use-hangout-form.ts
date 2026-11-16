'use client'

// Логіка форми «Знайти пиячок» (розмітка — hangout-button.tsx): відкриття
// модалки, одноразове підтвердження безпеки (localStorage), поля форми одним
// обʼєктом, сабміт — POST /venues/:id/hangouts. Успіх → toast + закриття.

import { useState } from 'react'
import { useToast } from '@/components/ui/toast'
import { createVenueHangout } from '@/services/hangouts'
import { ApiError } from '@/lib/api/parse'
import { hangoutFormSchema } from '@/lib/validation/hangout'

const ACK_KEY = 'hangout-safety-ack'

interface HangoutForm {
  date: string
  time: string
  purpose: string
  gender: 'any' | 'male' | 'female'
  groupSize: string
  payer: 'me' | 'split' | 'them'
  desiredBudget: string
}

const INITIAL_FORM: HangoutForm = {
  date: '',
  time: '',
  purpose: '',
  gender: 'any',
  groupSize: '2',
  payer: 'me',
  desiredBudget: '',
}

export function useHangoutForm(venueId: string) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  // читаємо прапор підтвердження безпеки одразу в ініціалізаторі:
  // на SSR localStorage кидає ReferenceError — try/catch дає false
  const [ack, setAck] = useState(() => {
    try {
      return localStorage.getItem(ACK_KEY) === '1'
    } catch {
      return false
    }
  })
  const [form, setForm] = useState<HangoutForm>(INITIAL_FORM)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  function setField<K extends keyof HangoutForm>(key: K, value: HangoutForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  // Спека §5: підтвердження безпеки — один раз, у localStorage.
  // Приватний режим без localStorage: попередження показуватиметься щоразу, це ок.
  function acknowledge() {
    try {
      localStorage.setItem(ACK_KEY, '1')
    } catch {
      // свідомо ігноруємо — безпековий крок просто не запам'ятовується
    }
    setAck(true)
  }

  // Закриття модалки (Скасувати, Escape/фон/«×», успіх): скидаємо помилку
  // і поля — наступне відкриття не показає застарілу помилку чи prefilled-форму
  function close() {
    setOpen(false)
    setError(null)
    setForm(INITIAL_FORM)
  }

  async function submit() {
    setError(null)
    const { desiredBudget, ...rest } = form
    const parsed = hangoutFormSchema.safeParse({
      ...rest,
      // пусте поле бюджету не надсилаємо: '' через coerce став би 0
      ...(desiredBudget !== '' ? { desiredBudget } : {}),
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Перевірте поля')
      return
    }
    setSending(true)
    try {
      await createVenueHangout(venueId, parsed.data)
      toast('Пиячок створено! Очікуйте на компанію.')
      close()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Сервіс тимчасово недоступний')
    } finally {
      setSending(false)
    }
  }

  return { open, setOpen, ack, acknowledge, form, setField, error, sending, close, submit }
}
