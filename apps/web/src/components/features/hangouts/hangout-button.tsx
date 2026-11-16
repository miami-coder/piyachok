'use client'

import Link from 'next/link'
import { useUser } from '@/components/providers/user-provider'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { HANGOUT_GENDERS, HANGOUT_PAYERS } from '@/lib/validation/hangout'
import { useHangoutForm } from './use-hangout-form'

// «Сьогодні» для min-атрибути інпута — за ЛОКАЛЬНОЮ зоною (en-CA → YYYY-MM-DD),
// та сама логіка, що й у схемі (фікс Task 8): toISOString() дав би UTC.
const localToday = () =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export function HangoutButton({ venueId, loginNext }: { venueId: string; loginNext: string }) {
  const { user } = useUser()
  const { open, setOpen, ack, acknowledge, form, setField, error, sending, close, submit } =
    useHangoutForm(venueId)

  if (!user) {
    return (
      // без encodeURIComponent: %2F у next проксі відкидає (нормалізація шляху),
      // а слеші в route-значенні безпечні — патерн FavoriteButton/ReviewForm/ComplaintButton
      <Link
        href={`/auth/login?next=${loginNext}`}
        className="inline-flex items-center rounded-xl bg-amber-500 px-4 py-2 text-sm font-medium text-espresso hover:bg-amber-400"
      >
        🍻 Знайти пиячок
      </Link>
    )
  }

  return (
    <>
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        🍻 Знайти пиячок
      </Button>

      <Modal open={open} onClose={close} title="Знайти пиячок">
        {!ack ? (
          // Спека §5: ПЕРШИЙ крок модалки — попередження про безпеку
          <div className="space-y-4">
            <h3 className="font-semibold text-amber-400">⚠️ Попередження про безпеку</h3>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
              <li>Ви зустрічаєтеся з незнайомими людьми. Обирайте публічні місця.</li>
              <li>Ніколи не пересилайте гроші незнайомцям до зустрічі.</li>
              <li>Повідомте близьких, куди йдете та на який час.</li>
              <li>Якщо щось викликає підозру — скасуйте зустріч.</li>
            </ul>
            <Button type="button" variant="primary" onClick={acknowledge}>
              Зрозуміло, продовжити
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="text-sm">
                <label htmlFor="hg-date" className="mb-1 block">Дата</label>
                <Input
                  id="hg-date"
                  type="date"
                  min={localToday()}
                  value={form.date}
                  onChange={(e) => setField('date', e.target.value)}
                  variant="outlined"
                />
              </div>
              <div className="text-sm">
                <label htmlFor="hg-time" className="mb-1 block">Час</label>
                <Input
                  id="hg-time"
                  type="time"
                  value={form.time}
                  onChange={(e) => setField('time', e.target.value)}
                  variant="outlined"
                />
              </div>
            </div>

            <div className="text-sm">
              <label htmlFor="hg-purpose" className="mb-1 block">
                Мета зустрічі (10-500 символів)
              </label>
              <Textarea
                id="hg-purpose"
                value={form.purpose}
                onChange={(e) => setField('purpose', e.target.value)}
                placeholder="Наприклад: дегустація крафтового пива, настільні ігри…"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="text-sm">
                <label htmlFor="hg-gender" className="mb-1 block">Компанія</label>
                <Select
                  id="hg-gender"
                  value={form.gender}
                  onChange={(e) => setField('gender', e.target.value as typeof form.gender)}
                  variant="outlined"
                >
                  {HANGOUT_GENDERS.map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </Select>
              </div>
              <div className="text-sm">
                <label htmlFor="hg-size" className="mb-1 block">Розмір групи (1-20)</label>
                <Input
                  id="hg-size"
                  type="number"
                  min={1}
                  max={20}
                  value={form.groupSize}
                  onChange={(e) => setField('groupSize', e.target.value)}
                  variant="outlined"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="text-sm">
                <label htmlFor="hg-payer" className="mb-1 block">Хто платить</label>
                <Select
                  id="hg-payer"
                  value={form.payer}
                  onChange={(e) => setField('payer', e.target.value as typeof form.payer)}
                  variant="outlined"
                >
                  {HANGOUT_PAYERS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </Select>
              </div>
              <div className="text-sm">
                <label htmlFor="hg-budget" className="mb-1 block">Бажаний чек (₴, опційно)</label>
                <Input
                  id="hg-budget"
                  type="number"
                  min={0}
                  max={100000}
                  value={form.desiredBudget}
                  onChange={(e) => setField('desiredBudget', e.target.value)}
                  variant="outlined"
                />
              </div>
            </div>

            {error && <p role="alert" className="text-sm text-danger">{error}</p>}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                Скасувати
              </Button>
              <Button type="button" variant="primary" onClick={submit} disabled={sending}>
                Створити пиячок
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
