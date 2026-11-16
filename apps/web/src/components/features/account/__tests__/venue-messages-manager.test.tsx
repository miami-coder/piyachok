import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/toast'
import { VenueMessagesManager } from '@/components/features/account/venue-messages-manager'
import { ApiError } from '@/lib/api/parse'
import { replyToVenueMessage } from '@/services/messages'
import type { Message } from '@/types/message'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))
vi.mock('@/services/messages', () => ({ replyToVenueMessage: vi.fn() }))

const reply = vi.mocked(replyToVenueMessage)

function msg(id: string, body: string): Message {
  return {
    id, senderId: 'u2', venueId: 'v1', kind: 'user_to_manager', body, isRead: false,
    createdAt: '2026-09-01T00:00:00Z', senderName: 'Олена', venueName: 'Бар',
  }
}

function renderManager() {
  return render(
    <ToastProvider>
      <VenueMessagesManager venueId="v1" messages={[msg('m1', 'Перше'), msg('m2', 'Друге')]} />
    </ToastProvider>,
  )
}

function openReply(index: number, text: string) {
  fireEvent.click(screen.getAllByRole('button', { name: 'Відповісти' })[index])
  fireEvent.change(screen.getByLabelText('Текст відповіді'), { target: { value: text } })
}

beforeEach(() => vi.clearAllMocks())

describe('VenueMessagesManager', () => {
  it('після помилки відповіді кнопка знову активна, помилка показана', async () => {
    reply.mockRejectedValueOnce(new ApiError(500, 'X', 'Сервер впав'))
    renderManager()
    openReply(0, 'Дякуємо')
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати відповідь' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Сервер впав')
    const submit = screen.getByRole('button', { name: 'Надіслати відповідь' })
    expect(submit).toBeEnabled()

    // повторна спроба проходить
    reply.mockResolvedValueOnce({})
    fireEvent.click(submit)
    await waitFor(() => expect(reply).toHaveBeenCalledTimes(2))
  })

  it('після успішної відповіді наступна відповідь на інше повідомлення не заблокована', async () => {
    reply.mockResolvedValueOnce({})
    renderManager()
    openReply(0, 'Дякуємо')
    fireEvent.click(screen.getByRole('button', { name: 'Надіслати відповідь' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())

    openReply(1, 'Ще одна')
    expect(screen.getByRole('button', { name: 'Надіслати відповідь' })).toBeEnabled()
  })
})
