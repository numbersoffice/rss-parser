import type { WidgetServerProps } from 'payload'

import Link from 'next/link'
import { formatAdminURL } from 'payload/shared'

import { relationId } from '@/lib/relations'

/** How many sources the widget lists. */
const TOP_N = 5

type Ranked = { id: number; name: string; avgPerDay: number }

/** Round to a whole number — the widget is a coarse ranking, decimals are noise. */
function formatAvg(n: number): string {
  return String(Math.round(n))
}

/**
 * Dashboard widget: the sources that add the most new posts on an average
 * active day, so an admin can spot high-frequency accounts — they drive the
 * most proxy bandwidth (each new post is a fetch + image mirror) — and disable
 * them if needed. Only active sources are ranked; a disabled source drops off.
 *
 * Reads the `source-activity` collection, which records new items per source
 * per day as they are created (see FeedItems' afterChange hook and
 * recordDailyActivity in src/lib/activity.ts). The
 * per-source figure is its average new items per day: total of its activity
 * counts divided by how many daily buckets it has (days with no new items have
 * no bucket, so this is an average over active days). Ranking is by that
 * average. The collection is pruned to a 7-day window, so it averages over at
 * most the last week.
 *
 * Admin-only, registered under admin.dashboard.widgets in payload.config.ts
 * (which only the admin DefaultDashboard surfaces) and additionally guarded
 * here. Reuses the compact `.usage-widget` shell (see (payload)/custom.scss).
 */
export async function FrequentSourcesWidget(props: WidgetServerProps) {
  const { req } = props
  const { payload, user } = req
  if (user?.role !== 'admin') return null

  const ranked = await rankSources(payload)
  const adminRoute = payload.config.routes.admin

  return (
    <div className="usage-widget">
      <div className="usage-widget__header">
        <span className="usage-widget__title">Most active sources</span>
        <span className="usage-widget__link">avg new posts / day</span>
      </div>

      {ranked.length > 0 ? (
        <ol className="frequent-sources">
          {ranked.map((s) => (
            <li key={s.id}>
              <Link
                className="frequent-sources__row"
                href={formatAdminURL({ adminRoute, path: `/collections/sources/${s.id}` })}
                prefetch={false}
              >
                <span className="frequent-sources__name">{s.name}</span>
                <span className="frequent-sources__count">{formatAvg(s.avgPerDay)}</span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="usage-widget__empty">No new posts in the last 7 days.</p>
      )}
    </div>
  )
}

/**
 * Reduce the source-activity buckets to an average-new-items-per-day per source
 * in one pass (sum of counts ÷ number of buckets), then resolve names and drop
 * disabled sources. The row set is small (one per source per active day, at most
 * a week deep) and the collection is already pruned to that window.
 */
async function rankSources(payload: WidgetServerProps['req']['payload']): Promise<Ranked[]> {
  const { docs } = await payload.find({
    collection: 'source-activity',
    pagination: false,
    depth: 0,
    select: { source: true, count: true },
  })

  // Per source: running total of new items and how many daily buckets it has.
  const totals = new Map<number, { sum: number; days: number }>()
  for (const doc of docs) {
    const id = relationId(doc.source)
    if (typeof id !== 'number') continue
    const acc = totals.get(id) ?? { sum: 0, days: 0 }
    acc.sum += doc.count ?? 0
    acc.days += 1
    totals.set(id, acc)
  }
  if (totals.size === 0) return []

  // Resolve names and the enabled flag for the tallied sources in one query;
  // the id set is bounded by how many sources posted in the window.
  const { docs: sources } = await payload.find({
    collection: 'sources',
    where: { id: { in: [...totals.keys()] } },
    pagination: false,
    depth: 0,
    select: { name: true, enabled: true },
  })

  return sources
    .filter((s) => s.enabled !== false)
    .map((s) => {
      const acc = totals.get(s.id)!
      return { id: s.id, name: s.name, avgPerDay: acc.days > 0 ? acc.sum / acc.days : 0 }
    })
    .sort((a, b) => b.avgPerDay - a.avgPerDay)
    .slice(0, TOP_N)
}
