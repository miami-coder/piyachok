'use client'

// Острів «Профіль» на деталці адмін-юзера: поля у спільному
// use-profile-fields (як у кабінетній ProfileForm), але сабміт свій —
// diff проти початкових значень (порожній diff → «Немає змін») далі
// PATCH /admin/users/:id. avatarUrl не рендеримо і не надсилаємо
// (UpdateProfileDto його не має), хоча бекенд його в profile повертає.

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { adminUpdateUser } from '@/services/users'
import { ApiError } from '@/lib/api/parse'
import { useProfileFields } from '@/components/shared/use-profile-fields'
import type { ProfileFields, ProfileUpdateValues } from '@/components/shared/use-profile-fields'

export function UserProfileForm({ userId, profile }: { userId: string; profile: Partial<ProfileFields> | null }) {
  const router = useRouter()
  const { toast } = useToast()
  const {
    firstname, setFirstname, lastname, setLastname,
    phone, setPhone, age, setAge,
    buildCandidates, validate,
  } = useProfileFields(profile)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return // in-flight гард
    setError(null)
    const result = validate(buildCandidates())
    if (!result.ok) {
      setError(result.message)
      return
    }
    // diff проти початкових значень: змінене — летить, незмінене — ні
    const diff: ProfileUpdateValues = {}
    if (result.data.firstname !== undefined && result.data.firstname !== (profile?.firstname ?? null)) {
      diff.firstname = result.data.firstname
    }
    if (result.data.lastname !== undefined && result.data.lastname !== (profile?.lastname ?? null)) {
      diff.lastname = result.data.lastname
    }
    if (result.data.phone !== undefined && result.data.phone !== (profile?.phone ?? null)) {
      diff.phone = result.data.phone
    }
    if (result.data.age !== undefined && result.data.age !== (profile?.age ?? null)) {
      diff.age = result.data.age
    }
    if (Object.keys(diff).length === 0) {
      toast('Немає змін')
      return
    }
    setSaving(true)
    try {
      await adminUpdateUser(userId, diff)
      toast('Профіль оновлено')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося оновити профіль')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-3" aria-label="Профіль">
      <label className="block text-sm font-medium">
        Імʼя
        <Input value={firstname} onChange={(e) => setFirstname(e.target.value)} className="mt-1 w-full" />
      </label>
      <label className="block text-sm font-medium">
        Прізвище
        <Input value={lastname} onChange={(e) => setLastname(e.target.value)} className="mt-1 w-full" />
      </label>
      <label className="block text-sm font-medium">
        Телефон
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full" />
      </label>
      <label className="block text-sm font-medium">
        Вік
        <Input type="number" value={age} onChange={(e) => setAge(e.target.value)} className="mt-1 w-full" />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={saving}>
        {saving ? 'Зберігаємо…' : 'Зберегти'}
      </Button>
    </form>
  )
}
