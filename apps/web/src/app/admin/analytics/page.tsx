import { Suspense } from 'react'
import { getAnalyticsTimeseries, getAnalyticsVenues } from '@/services/admin.server'
import { getSessionTokens } from '@/lib/auth/session'
import { defaultAnalyticsRange, dateParam } from '@/lib/utils/date-range'
import {
  AdminAnalyticsControls,
  AnalyticsPeriodLabel,
  TimeseriesChart,
  VenueStatsTable,
  type Granularity,
} from '@/components/features/admin/admin-analytics'

export const revalidate = 0

const GRANULARITIES: Granularity[] = ['day', 'week', 'month']

interface Props {
  searchParams: Promise<{ from?: string; to?: string; granularity?: string }>
}

// Аналітика переглядів для суперадміна (пункти ТЗ 8-9): часовой ряд із
// гранулярністю day/week/month + топ закладів за переглядами
export default async function AdminAnalyticsPage({ searchParams }: Props) {
  const sp = await searchParams
  const d = defaultAnalyticsRange()
  const from = dateParam(sp?.from, d.from)
  const to = dateParam(sp?.to, d.to)
  const granularity: Granularity =
    sp?.granularity && GRANULARITIES.includes(sp.granularity as Granularity)
      ? (sp.granularity as Granularity)
      : 'day'

  const tokens = await getSessionTokens()
  const qs = `from=${from}&to=${to}`
  // serverFetch уже розгортає конверт {data} — повертається одразу масив
  // (venues → {data,meta}, parseData бере data; meta тут не потрібна)
  const [timeseries, venueStats] = await Promise.all([
    getAnalyticsTimeseries(from, to, granularity, tokens),
    getAnalyticsVenues(qs, tokens),
  ])

  return (
    <section aria-label="Аналітика" className="space-y-4">
      <Suspense fallback={null}>
        <AdminAnalyticsControls from={from} to={to} granularity={granularity} />
      </Suspense>
      <AnalyticsPeriodLabel from={from} to={to} />

      {!timeseries || !venueStats ? (
        <p className="text-sm text-danger">Не вдалося завантажити аналітику.</p>
      ) : (
        <>
          <div className="rounded-xl border border-line p-4">
            <p className="mb-2 text-sm text-muted">
              Перегляди ({granularity === 'day' ? 'за днями' : granularity === 'week' ? 'за тижнями' : 'за місяцями'})
            </p>
            <TimeseriesChart data={timeseries} />
          </div>
          <div className="rounded-xl border border-line p-4">
            <p className="mb-2 text-sm text-muted">Перегляди за закладами</p>
            <VenueStatsTable data={venueStats} />
          </div>
        </>
      )}
    </section>
  )
}