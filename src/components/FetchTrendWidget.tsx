import type { WidgetServerProps } from 'payload'

import { FetchTrendChart } from './FetchTrendChart'

/** Days of history the chart spans (including today). */
const DAYS = 7

type Day = { label: string; rate: number | null }

/**
 * Dashboard widget: daily adapter-fetch success rate over the last week, so an
 * admin can spot macro reliability trends (a bad day, a slow slide) rather than
 * just the latest error. Aggregated across all sources from the request-logs
 * collection.
 *
 * Rate per day = successes / attempts. Computed with cheap count queries (two
 * per day) instead of loading rows. Admin-only, registered under
 * admin.dashboard.widgets in payload.config.ts. Styling reuses the compact
 * .usage-widget shell; the chart is a deliberately minimal sparkline (see
 * .trend-* in (payload)/custom.scss).
 */
export async function FetchTrendWidget(props: WidgetServerProps) {
  const { req } = props
  const { payload, user } = req
  if (user?.role !== 'admin') return null

  const days = await collectDays(payload)
  const withData = days.filter((d): d is Day & { rate: number } => d.rate !== null)
  const avg =
    withData.length > 0 ? withData.reduce((sum, d) => sum + d.rate, 0) / withData.length : null

  return (
    <div className="usage-widget">
      <div className="usage-widget__header">
        <span className="usage-widget__title">Fetch success rate</span>
        <span className="usage-widget__link" aria-hidden="true">
          last {DAYS} days
        </span>
      </div>

      {withData.length > 0 ? (
        <>
          <FetchTrendChart days={days} />
          <p className="usage-widget__caption">
            {avg !== null ? `avg ${formatPercent(avg)}% over ${withData.length}d` : ''}
          </p>
        </>
      ) : (
        <p className="usage-widget__empty">No fetch attempts recorded yet.</p>
      )}
    </div>
  )
}

/** Build the day buckets (oldest → newest), each with its success rate or null
 * when there were no attempts. Uses count queries scoped by local-midnight
 * day boundaries — two per day (total, errors). */
async function collectDays(payload: WidgetServerProps['req']['payload']): Promise<Day[]> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (DAYS - 1))

  const days: Day[] = []
  for (let i = 0; i < DAYS; i++) {
    const from = new Date(start)
    from.setDate(start.getDate() + i)
    const to = new Date(from)
    to.setDate(from.getDate() + 1)

    const range = { greater_than_equal: from.toISOString(), less_than: to.toISOString() }
    const [total, errors] = await Promise.all([
      payload.count({ collection: 'request-logs', where: { createdAt: range } }),
      payload.count({
        collection: 'request-logs',
        where: { and: [{ createdAt: range }, { status: { equals: 'error' } }] },
      }),
    ])

    const rate = total.totalDocs > 0 ? ((total.totalDocs - errors.totalDocs) / total.totalDocs) * 100 : null
    days.push({ label: dayLabel(from), rate })
  }
  return days
}

/** Short weekday initial for the x-axis, e.g. "M" / "T" / "W". */
function dayLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'narrow' })
}

/** Percentages to one decimal, dropping a trailing ".0" (e.g. "92" / "99.5"). */
function formatPercent(pct: number): string {
  return Number(pct.toFixed(1)).toString()
}
