'use client'

// Компактна картка наявного відгуку — редактор закритий: кнопки редагування
// (відкриває редактор через onEdit у review-form.tsx) і видалення. Саме тут
// живе видалення: підтвердження — діалог у DOM (Modal, не window.confirm),
// DELETE → 200 з порожнім тілом, оновлення списку через router.refresh().

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { useToast } from '@/components/ui/toast'
import { ApiError } from '@/lib/api/parse'
import { deleteReview } from '@/services/reviews'
import type { MyReview } from './use-review-form'

export function MyReviewCard({ myReview, onEdit }: {
  myReview: MyReview
  onEdit: VoidFunction
}) {
  const { toast } = useToast()
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function remove() {
    try {
      // DELETE → 200 з порожнім тілом: парсимо через parseEmpty (apiVoid), не parseData
      await deleteReview(myReview.id)
      setDeleting(false)
      toast('Відгук видалено')
      router.refresh()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не вдалося видалити відгук', 'error')
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="rounded-xl border border-line p-4">
        <p className="text-sm text-muted">Ваш відгук опубліковано — він у списку нижче.</p>
        <div className="mt-3 flex gap-2">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Редагувати
          </Button>
          <Button variant="danger" size="sm" onClick={() => setDeleting(true)}>
            Видалити
          </Button>
        </div>
      </div>
      <Modal open={deleting} onClose={() => setDeleting(false)} title="Видалити відгук?">
        <p className="text-muted">Відгук буде видалено назавжди.</p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => setDeleting(false)}>Скасувати</Button>
          <Button onClick={remove}>Так, видалити</Button>
        </div>
      </Modal>
    </>
  )
}