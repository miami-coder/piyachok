'use client'

// Спільний стан полів профілю для кабінетної ProfileForm (PATCH /me/profile)
// і адмінської UserProfileForm (PATCH /admin/users/:id). Хук тримає стейти
// полів і збірку кандидатів «заповнені — надсилаємо, порожні — ні» (DTO опційні;
// порожній рядок ламав би MinLength) + zod-валідацію profileUpdateSchema.
// Сабміти свідомо різні і лишаються у формах: кабінетна шле весь кандидат,
// адмінська спершу зводить diff проти початкових значень («Немає змін»),
// avatarUrl рендериться тільки в кабінеті (UpdateProfileDto його не має).

import { useState } from 'react'
import { profileUpdateSchema, type ProfileUpdateValues } from '@/lib/validation/profile'

export type { ProfileUpdateValues }

export interface ProfileFields {
  firstname: string | null
  lastname: string | null
  phone: string | null
  age: number | null
  avatarUrl: string | null
}

export function useProfileFields(profile: Partial<ProfileFields> | null) {
  const [firstname, setFirstname] = useState(profile?.firstname ?? '')
  const [lastname, setLastname] = useState(profile?.lastname ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [age, setAge] = useState(profile?.age?.toString() ?? '')
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl ?? '')

  // Кандидат усіх заповнених полів (без трімування значень — трімить
  // сама схема); форма фільтрує його далі за своїми правилами сабміту
  function buildCandidates(): ProfileUpdateValues {
    const values: ProfileUpdateValues = {}
    if (firstname.trim()) values.firstname = firstname
    if (lastname.trim()) values.lastname = lastname
    if (phone.trim()) values.phone = phone
    if (age.trim()) values.age = Number(age)
    if (avatarUrl.trim()) values.avatarUrl = avatarUrl
    return values
  }

  // Перша issue схеми — інлайн-помилка форми; успіх → підготовлені значення.
  // Оголошений дискримінант ok: перевірка звужує union до message або data
  function validate(candidates: ProfileUpdateValues):
    { ok: true; data: ProfileUpdateValues } | { ok: false; message: string } {
    const parsed = profileUpdateSchema.safeParse(candidates)
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, message: parsed.error.issues[0]?.message ?? 'Перевірте поля' }
  }

  return {
    firstname, setFirstname, lastname, setLastname,
    phone, setPhone, age, setAge, avatarUrl, setAvatarUrl,
    buildCandidates, validate,
  }
}
