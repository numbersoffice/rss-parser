import type { WidgetServerProps } from 'payload'

import { FetchTrendWidgetView } from './FetchTrendWidgetView'

/** Days of history the chart spans (including today). */
const DAYS = 7

type Day = { label: string; rate: number | null }

/** A single request-log row, trimmed to the fields the trends need. */
type Row = { createdAt: string; status: 'success' | 'error'; fetchId?: string | null }

/**
 * Dashboard widget: daily adapter-fetch success rate over the last week, so an
 * admin can spot macro reliability trends (a bad day, a slow slide) rather than
 * just the latest error. Aggregated across all sources from the request-logs
 * collection.
 *
 * The admin can toggle how retries are counted (see FetchTrendWidgetView):
 * - "Every attempt": rate = successes / attempts, each request-log row on its
 *   own — a fetch that failed twice before succeeding costs two failures.
 * - "Per fetch": rows grouped by `fetchId` into fetch sessions, each counting
 *   once and successful if *any* of its attempts (retries) succeeded, so only
 *   the final outcome of a fetch session counts.
 *
 * Both series are computed here from a single pass over the window's rows and
 * handed to the client shell. Admin-only, registered under
 * admin.dashboard.widgets in payload.config.ts. Styling reuses the compact
 * .usage-widget shell; the chart is a deliberately minimal sparkline (see
 * .trend-* in (payload)/custom.scss).
 */
export async function FetchTrendWidget(props: WidgetServerProps) {
  const { req } = props
  const { payload, user } = req
  if (user?.role !== 'admin') return null

  const { attemptDays, sessionDays } = await collectTrends(payload)

  return <FetchTrendWidgetView attemptDays={attemptDays} sessionDays={sessionDays} />
}

/**
 * Build both daily series over the last week. Loads every request-log row in
 * the window once (cheap, depth 0, three fields) and buckets it two ways:
 *
 * - attempts: per-row success rate for the day.
 * - sessions: rows sharing a `fetchId` are one fetch session (a refresh's
 *   retries), collapsed to a single success/failure — successful if any attempt
 *   in it succeeded — and bucketed by the session's final-outcome time. Legacy
 *   rows written before `fetchId` existed each stand as their own session.
 *
 * Day boundaries are local midnights, walked with setDate so DST shifts don't
 * skew them (matching how the source fields are stamped).
 */
async function collectTrends(
  payload: WidgetServerProps['req']['payload'],
): Promise<{ attemptDays: Day[]; sessionDays: Day[] }> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (DAYS - 1))

  // Inclusive lower bound (start of the oldest day) through now.
  const rows = await loadRows(payload, start)

  // Precompute the DAYS+1 local-midnight boundaries; day i is [bounds[i], bounds[i+1]).
  const bounds: Date[] = []
  for (let i = 0; i <= DAYS; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    bounds.push(d)
  }
  const dayIndex = (iso: string): number => {
    const t = new Date(iso).getTime()
    for (let i = 0; i < DAYS; i++) {
      if (t >= bounds[i]!.getTime() && t < bounds[i + 1]!.getTime()) return i
    }
    return -1
  }
  const labels = bounds.slice(0, DAYS).map(dayLabel)

  // Per-attempt tallies straight from the rows.
  const attemptTotal = new Array(DAYS).fill(0)
  const attemptError = new Array(DAYS).fill(0)
  for (const row of rows) {
    const i = dayIndex(row.createdAt)
    if (i < 0) continue
    attemptTotal[i]++
    if (row.status === 'error') attemptError[i]++
  }

  // Per-session: collapse rows sharing a fetchId; legacy (no id) rows stand alone.
  const sessions = groupSessions(rows)
  const sessionTotal = new Array(DAYS).fill(0)
  const sessionError = new Array(DAYS).fill(0)
  for (const s of sessions) {
    const i = dayIndex(s.outcomeAt)
    if (i < 0) continue
    sessionTotal[i]++
    if (!s.success) sessionError[i]++
  }

  const toDays = (total: number[], error: number[]): Day[] =>
    labels.map((label, i) => ({
      label,
      rate: total[i] > 0 ? ((total[i] - error[i]) / total[i]) * 100 : null,
    }))

  return {
    attemptDays: toDays(attemptTotal, attemptError),
    sessionDays: toDays(sessionTotal, sessionError),
  }
}

type Session = { success: boolean; outcomeAt: string }

/** Fold rows into fetch sessions: same `fetchId` = one session (success if any
 * attempt in it succeeded), timed by its latest attempt (the outcome). Rows
 * without a `fetchId` predate grouping, so each is treated as its own session. */
function groupSessions(rows: Row[]): Session[] {
  const byFetch = new Map<string, Row[]>()
  const sessions: Session[] = []
  for (const row of rows) {
    if (row.fetchId) {
      const group = byFetch.get(row.fetchId)
      if (group) group.push(row)
      else byFetch.set(row.fetchId, [row])
    } else {
      sessions.push({ success: row.status === 'success', outcomeAt: row.createdAt })
    }
  }
  for (const group of byFetch.values()) {
    const success = group.some((r) => r.status === 'success')
    const outcomeAt = group.reduce(
      (latest, r) => (r.createdAt > latest ? r.createdAt : latest),
      group[0]!.createdAt,
    )
    sessions.push({ success, outcomeAt })
  }
  return sessions
}

/** Pull every request-log row in the window, trimmed to the fields the trends
 * need. Pagination is disabled so a busy week isn't silently truncated. */
async function loadRows(
  payload: WidgetServerProps['req']['payload'],
  start: Date,
): Promise<Row[]> {
  const res = await payload.find({
    collection: 'request-logs',
    where: { createdAt: { greater_than_equal: start.toISOString() } },
    pagination: false,
    depth: 0,
    select: { createdAt: true, status: true, fetchId: true },
  })
  return res.docs as Row[]
}

/** Short weekday initial for the x-axis, e.g. "M" / "T" / "W". */
function dayLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'narrow' })
}
