import type { WidgetServerProps } from 'payload'

import Link from 'next/link'
import { formatAdminURL } from 'payload/shared'

import { getMaxItemsPerFeed } from '@/lib/limits'
import { relationId } from '@/lib/relations'

/** Trailing window the ranking covers. */
const WINDOW_HOURS = 24

/** How many sources the widget lists. */
const TOP_N = 3

type Ranked = { id: number; name: string; count: number }

/**
 * Dashboard widget: the sources that published the most posts in the last 24h,
 * so an admin can spot high-frequency accounts — they drive the most proxy
 * bandwidth (each new post is a fetch + image mirror) — and disable them if
 * needed. Only active sources are ranked; a disabled source drops off.
 *
 * Counted by post `publishedAt`, not our `createdAt`, so the number reflects the
 * account's real posting cadence rather than a subscribe-time seed batch. Feeds
 * keep at most `maxItemsPerFeed` items (pruned on refresh), so a source at that
 * cap may have posted more than we can see — shown as "more than N".
 *
 * Admin-only, registered under admin.dashboard.widgets in payload.config.ts
 * (which only the admin DefaultDashboard surfaces) and additionally guarded
 * here. Reuses the compact `.usage-widget` shell (see (payload)/custom.scss).
 */
export async function FrequentSourcesWidget(props: WidgetServerProps) {
  const { req } = props
  const { payload, user } = req
  if (user?.role !== 'admin') return null

  const cap = await getMaxItemsPerFeed(payload)
  const ranked = await rankSources(payload)
  const adminRoute = payload.config.routes.admin

  return (
    <div className="usage-widget">
      <div className="usage-widget__header">
        <span className="usage-widget__title">Most active sources</span>
        <span className="usage-widget__link">last {WINDOW_HOURS}h</span>
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
                <span className="frequent-sources__count">
                  {s.count >= cap ? `more than ${cap}` : s.count}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className="usage-widget__empty">No new posts in the last {WINDOW_HOURS}h.</p>
      )}
    </div>
  )
}

/**
 * Tally feed-items published in the window by source (one pass in JS, mirroring
 * FetchTrendWidget), then resolve names and drop disabled sources. The windowed
 * item set is small even at thousands of sources — most refreshes add no items —
 * and `publishedAt` is indexed.
 */
async function rankSources(payload: WidgetServerProps['req']['payload']): Promise<Ranked[]> {
  const cutoff = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString()

  const { docs } = await payload.find({
    collection: 'feed-items',
    where: { publishedAt: { greater_than_equal: cutoff } },
    pagination: false,
    depth: 0,
    select: { source: true },
  })

  const counts = new Map<number, number>()
  for (const doc of docs) {
    const id = relationId(doc.source)
    if (typeof id !== 'number') continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  if (counts.size === 0) return []

  // Resolve names and the enabled flag for the tallied sources in one query;
  // the id set is bounded by how many sources posted in the window.
  const { docs: sources } = await payload.find({
    collection: 'sources',
    where: { id: { in: [...counts.keys()] } },
    pagination: false,
    depth: 0,
    select: { name: true, enabled: true },
  })

  return sources
    .filter((s) => s.enabled !== false)
    .map((s) => ({ id: s.id, name: s.name, count: counts.get(s.id) ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_N)
}
