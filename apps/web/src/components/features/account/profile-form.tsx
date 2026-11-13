'use client'

// Острів редагування профілю: стан полів, збірка кандидата «заповнені —
// надсилаємо, порожні — ні» і валідація — у спільному use-profile-fields.ts
// (кабінет і адмінка). Тут — сабміт: PATCH /me/profile через api(), далі
// router.refresh(). Окремо — видалення профілю (модалка + логаут): після
// deleteMe() відгуки лишаються з позначкою «Обліковий запис видалено»,
// увійти назад цим акаунтом буде неможливо.

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/components/providers/user-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { deleteMe } from '@/services/users'
import { useToast } from '@/components/ui/toast'
import { updateMyProfile } from '@/services/users'
import { ApiError } from '@/lib/api/parse'
import { useProfileFields } from '@/components/shared/use-profile-fields'
import type { ProfileFields } from '@/components/shared/use-profile-fields'

export function ProfileForm({ profile }: { profile: ProfileFields }) {
  const router = useRouter()
  const { toast } = useToast()
  const [deleting, setDeleting] = useState(false)
  const { logout: logoutUser } = useUser()
  const {
    firstname, setFirstname, lastname, setLastname,
    phone, setPhone, age, setAge, avatarUrl, setAvatarUrl,
    buildCandidates, validate,
  } = useProfileFields(profile)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const result = validate(buildCandidates())
    if (!result.ok) {
      setError(result.message)
      return
    }
    setSaving(true)
    try {
      await updateMyProfile(result.data)
      toast('Профіль збережено')
      router.refresh()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не вдалося зберегти профіль')
    } finally {
      setSaving(false)
    }
  }

  async function removeMe() {
    try {
      await deleteMe()
      toast('Профіль видалено. До зустрічі!')
      await logoutUser()
      router.push('/')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не вдалося видалити профіль', 'error')
      setDeleting(false)
    }
  }


  return (
    <form onSubmit={submit} className="max-w-md space-y-3" aria-label="Профіль">
      <label className="block text-sm font-medium">Імʼя
        <Input value={firstname} onChange={(e) => setFirstname(e.target.value)} className="mt-1 w-full" />
      </label>
      <label className="block text-sm font-medium">Прізвище
        <Input value={lastname} onChange={(e) => setLastname(e.target.value)} className="mt-1 w-full" />
      </label>
      <label className="block text-sm font-medium">Телефон
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full" />
      </label>
      <label className="block text-sm font-medium">Вік
        <Input type="number" value={age} onChange={(e) => setAge(e.target.value)} className="mt-1 w-full" />
      </label>
      <label className="block text-sm font-medium">URL аватара
        <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} className="mt-1 w-full" />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={saving}>{saving ? 'Зберігаємо…' : 'Зберегти'}</Button>

      {/* Видалення профілю: модалка-підтвердження, після —
          логаут і редірект на каталог. */}
      <div className="mt-6 border-t border-line pt-4">
        <button
          type="button"
          onClick={() => setDeleting(true)}
          className="text-sm text-danger hover:underline"
        >
          Видалити профіль
        </button>
        {/* Загальна модалка (Esc, фокус-трап, повернення фокусу) —
            замість самописного оверлея без нього. */}
        <Modal
          open={deleting}
          onClose={() => setDeleting(false)}
          title="Видалити профіль?"
        >
          <p className="text-sm text-muted">
            Відгуки залишаться з позначкою «Обліковий запис видалено».
            Увійти назад цим акаунтом буде неможливо.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleting(false)}>
              Скасувати
            </Button>
            <Button variant="danger" onClick={() => void removeMe()}>
              Так, видалити
            </Button>
          </div>
        </Modal>
      </div>
    </form>
  )
}
