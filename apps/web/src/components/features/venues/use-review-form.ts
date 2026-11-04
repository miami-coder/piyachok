'use client'

// Логіка форми відгуку: створення — multipart POST із фото чеку,
// редагування — JSON PATCH (розмітка — review-form.tsx; закрита картка
// наявного відгуку з видаленням — my-review-card.tsx).

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/toast'
import { ApiError } from '@/lib/api/parse'
import { createVenueReview, updateReview } from '@/services/reviews'
import { reviewFormSchema } from '@/lib/validation/review'

const MAX_FILE = 5 * 1024 * 1024
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

export interface MyReview { id: string; rating: number; text: string; billAmount?: number | null }

// initialEditing: відкрити редактор одразу (для вбудовування у модалку —
// my-review-item); без нього наявний відгук показується компактною карткою
// (my-review-card.tsx)
export function useReviewForm(
  venueId: string,
  myReview: MyReview | null,
  initialEditing = false,
) {
  const { toast } = useToast()
  const router = useRouter()
  const reviewId = myReview?.id ?? null
  const [editing, setEditing] = useState(Boolean(myReview) && initialEditing)
  const [rating, setRating] = useState(myReview?.rating ?? 0)
  const [text, setText] = useState(myReview?.text ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [checkFile, setCheckFile] = useState<File | null>(null)
  const [checkResetKey, setCheckResetKey] = useState(0)
  const [billAmount, setBillAmount] = useState(myReview?.billAmount?.toString() ?? '')

  // Зміна відгуку зверху (створено/видалено) — поля синхронізуємо, редактор закриваємо.
  // Монтування пропускаємо: initialEditing уже відкрив редактор
  const prevIdRef = useRef<string | null>(reviewId)
  useEffect(() => {
    if (prevIdRef.current === reviewId) return
    prevIdRef.current = reviewId
    setRating(myReview?.rating ?? 0)
    setText(myReview?.text ?? '')
    setEditing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId])

  function startEdit() {
    if (!myReview) return
    setRating(myReview.rating)
    setBillAmount(myReview.billAmount?.toString() ?? '')
    setText(myReview.text)
    setError(null)
    setEditing(true)
  }

  // Скасування — правки відкатуються до збереженого відгуку
  function cancelEdit() {
    if (myReview) {
      setRating(myReview.rating)
      setText(myReview.text)
    }
    setError(null)
    setEditing(false)
  }

  async function submit() {
    setError(null)
    const parsed = reviewFormSchema.safeParse({ rating, text, billAmount: billAmount ? Number(billAmount) : null })
    if (!parsed.success) {
      // помилки полів DTO на поля не маппимо — message першого issue інлайн
      setError(parsed.error.issues[0]?.message ?? 'Перевірте поля')
      return
    }
    const file = checkFile
    if (file) {
      if (!ALLOWED.includes(file.type)) {
        setError('Фото: лише JPEG, PNG або WebP')
        return
      }
      if (file.size > MAX_FILE) {
        setError('Фото не більше 5 МБ')
        return
      }
    }

    setSaving(true)
    try {
      if (!myReview) {
        const fd = new FormData()
        fd.set('rating', String(parsed.data.rating))
        fd.set('text', parsed.data.text)
        if (billAmount) fd.set('billAmount', String(Number(billAmount)))
        if (file) fd.set('checkPhoto', file)
        await createVenueReview(venueId, fd)
        // Після успішного створення форма заново чиста; вкладка «Редагувати»
        // відкриється повністю підставленою зі свіжого myReview
        setRating(0)
        setText('')
        setBillAmount('')
        setCheckFile(null)
        setCheckResetKey((k) => k + 1)
      } else {
        await updateReview(myReview.id, parsed.data)
        setEditing(false)
      }
      toast(myReview ? 'Відгук оновлено' : 'Дякуємо за відгук!')
      router.refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Сервіс тимчасово недоступний')
    } finally {
      setSaving(false)
    }
  }

  return {
    editing, rating, setRating, text, setText, error, saving,
    checkFile, setCheckFile, checkResetKey, billAmount, setBillAmount,
    startEdit, cancelEdit, submit,
  }
}