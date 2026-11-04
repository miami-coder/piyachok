'use client'

// Розмітка форми відгуку; стан і логіка — в useReviewForm
// (use-review-form.ts: створення multipart / редагування PATCH), закрита
// картка наявного відгуку з видаленням — my-review-card.tsx. Гість бачить
// запрошення увійти замість форми.

import Link from 'next/link'
import { useUser } from '@/components/providers/user-provider'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { FilePickerButton } from '@/components/ui/file-picker-button'
import { Textarea } from '@/components/ui/textarea'
import { useReviewForm, type MyReview } from './use-review-form'
import { MyReviewCard } from './my-review-card'

// Оцінка зірками — радіогрупа 1..5 (sr-only-радіо під зіркою: доступно
// скрінрідеру, видимий лише символ зірки)
function StarRatingInput({ value, onChange }: {
  value: number
  onChange: (n: number) => void
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium">Оцінка</legend>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer">
            <input
              type="radio"
              name="rating"
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="sr-only"
            />
            <span className={`text-2xl ${value >= n ? 'text-amber-400' : 'text-faint'}`} aria-hidden>
              ★
            </span>
            <span className="sr-only">{n}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function ReviewForm({ venueId, myReview, initialEditing = false }: {
  venueId: string
  myReview: MyReview | null
  initialEditing?: boolean
}) {
  const { user } = useUser()
  const form = useReviewForm(venueId, myReview, initialEditing)

  if (!user) {
    return (
      <p className="rounded-xl bg-raised p-4 text-sm text-muted">
        Щоб залишити відгук,{' '}
        <Link className="text-amber-500 hover:underline" href={`/auth/login?next=/venues/${venueId}`}>
          Увійдіть
        </Link>{' '}
        або зареєструйтеся.
      </p>
    )
  }

  // Відгук існує й редактор закритий — компактна картка замість постійно
  // відкритої форми: створення й редагування більше не путаються
  if (myReview && !form.editing) {
    return <MyReviewCard myReview={myReview} onEdit={form.startEdit} />
  }

  const isEdit = Boolean(myReview)

  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <StarRatingInput value={form.rating} onChange={form.setRating} />

      <label htmlFor="review-bill" className="block text-sm font-medium">
        Сума чека, грн (необов&apos;язково)
      </label>
      <Input
        id="review-bill"
        type="number"
        min="0"
        value={form.billAmount}
        onChange={(e) => form.setBillAmount(e.target.value)}
        placeholder="Напр. 450"
      />

      <label htmlFor="review-text" className="block text-sm font-medium">
        Відгук
      </label>
      <Textarea
        id="review-text"
        value={form.text}
        onChange={(e) => form.setText(e.target.value)}
        placeholder="Розкажіть про враження (мінімум 10 символів)"
      />

      {!myReview && (
        <div className="text-sm">
          <label htmlFor="review-check" className="block">
            Фото чеку (необов&apos;язково, до 5 МБ)
          </label>
          <div className="mt-1 flex items-center gap-2">
            <FilePickerButton
              buttonLabel="Обрати фото"
              inputLabel="Фото чеку"
              inputId="review-check"
              accept="image/jpeg,image/png,image/webp"
              onFiles={(files) => form.setCheckFile(files[0] ?? null)}
              resetKey={form.checkResetKey}
            />
            <span className="text-xs text-muted">{form.checkFile ? form.checkFile.name : 'Файл не вибрано'}</span>
          </div>
        </div>
      )}

      {form.error && <p role="alert" className="text-sm text-danger">{form.error}</p>}

      <div className="flex gap-2">
        <Button type="button" variant="primary" onClick={form.submit} disabled={form.saving}>
          {isEdit ? 'Зберегти зміни' : 'Надіслати відгук'}
        </Button>
        {isEdit && (
          <Button type="button" variant="secondary" onClick={form.cancelEdit}>
            Скасувати
          </Button>
        )}
      </div>
    </div>
  )
}