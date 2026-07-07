import type { WidgetServerProps } from 'payload'

/** Days of history the chart spans (including today). */
const DAYS = 7

/** SVG viewBox — wide and short, drawn in these user units then scaled to fit. */
const VIEW_W = 300
const VIEW_H = 72
const PAD_X = 6
const PAD_TOP = 6
const PAD_BOTTOM = 16 // room for day labels

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
          <TrendChart days={days} />
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

/** Inline SVG line — one point per day, gaps (days with no attempts) break the
 * line. Minimal by design: a single thin accent stroke, faint baseline, small
 * markers, quiet day labels — no axes, grid, or fill. */
function TrendChart({ days }: { days: Day[] }) {
  const innerW = VIEW_W - PAD_X * 2
  const innerH = VIEW_H - PAD_TOP - PAD_BOTTOM
  const step = days.length > 1 ? innerW / (days.length - 1) : 0

  const points = days.map((d, i) => ({
    label: d.label,
    x: PAD_X + step * i,
    // rate 100% at top, 0% at bottom
    y: d.rate === null ? null : PAD_TOP + innerH * (1 - d.rate / 100),
  }))

  // Split into contiguous runs of non-null points so gaps break the line.
  const segments: { x: number; y: number }[][] = []
  let run: { x: number; y: number }[] = []
  for (const p of points) {
    if (p.y === null) {
      if (run.length) segments.push(run)
      run = []
    } else {
      run.push({ x: p.x, y: p.y })
    }
  }
  if (run.length) segments.push(run)

  const baselineY = PAD_TOP + innerH

  return (
    <svg
      className="trend-chart"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Daily fetch success rate over the last ${days.length} days`}
    >
      <line className="trend-chart__baseline" x1={PAD_X} y1={baselineY} x2={VIEW_W - PAD_X} y2={baselineY} />

      {segments.map((seg, i) => (
        <polyline
          key={i}
          className="trend-chart__line"
          points={seg.map((p) => `${p.x},${p.y}`).join(' ')}
        />
      ))}

      {points.map((p, i) =>
        p.y === null ? null : <circle key={i} className="trend-chart__dot" cx={p.x} cy={p.y} r={2} />,
      )}

      {points.map((p, i) => (
        <text key={i} className="trend-chart__label" x={p.x} y={VIEW_H - 4} textAnchor="middle">
          {p.label}
        </text>
      ))}
    </svg>
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
