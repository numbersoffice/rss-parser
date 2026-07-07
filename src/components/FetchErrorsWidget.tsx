import type { WidgetServerProps } from 'payload'

import Link from 'next/link'
import { formatAdminURL } from 'payload/shared'

/** How many recent errors to list — enough to spot a pattern without scrolling. */
const MAX_ERRORS = 5

/**
 * Dashboard widget: the most recent adapter fetch failures across all sources,
 * so an admin can see at a glance what's breaking (blocked handles, proxy
 * issues, adapter errors) without opening the Sources list and sorting.
 *
 * Reads sources with lastFetchStatus === 'error', newest failure first. Each
 * row links to the source's edit view, where the full lastFetchError and
 * lastFetchDebug diagnostics live.
 *
 * Account-wide operational data, so admins only — registered under
 * admin.dashboard.widgets in payload.config.ts and additionally guarded here.
 * Styling shares the compact .usage-widget shell in (payload)/custom.scss.
 */
export async function FetchErrorsWidget(props: WidgetServerProps) {
  const { req } = props
  const { payload, user } = req
  if (user?.role !== 'admin') return null

  const { docs } = await payload.find({
    collection: 'sources',
    where: { lastFetchStatus: { equals: 'error' } },
    sort: '-lastFetchedAt',
    limit: MAX_ERRORS,
    depth: 0,
    overrideAccess: false,
    user,
  })

  const adminRoute = payload.config.routes.admin
  const listHref = formatAdminURL({
    adminRoute,
    path: '/collections/sources?limit=10&sort=-lastFetchedAt&where[lastFetchStatus][equals]=error',
  })

  return (
    <div className="usage-widget">
      <div className="usage-widget__header">
        <span className="usage-widget__title">Fetch errors</span>
        <Link className="usage-widget__link" href={listHref} prefetch={false}>
          View all →
        </Link>
      </div>

      {docs.length > 0 ? (
        <ul className="fetch-errors">
          {docs.map((source) => {
            const editHref = formatAdminURL({
              adminRoute,
              path: `/collections/sources/${source.id}`,
            })
            return (
              <li key={source.id} className="fetch-errors__item">
                <div className="fetch-errors__row">
                  <Link className="fetch-errors__source" href={editHref} prefetch={false}>
                    {source.name || `${source.type} · ${source.handle}`}
                  </Link>
                  {source.lastFetchedAt && (
                    <time className="fetch-errors__time" dateTime={source.lastFetchedAt}>
                      {formatRelative(source.lastFetchedAt)}
                    </time>
                  )}
                </div>
                <p className="fetch-errors__message" title={source.lastFetchError ?? undefined}>
                  {source.lastFetchError || 'Unknown error'}
                </p>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="usage-widget__empty">No fetch errors — every source last fetched cleanly.</p>
      )}
    </div>
  )
}

/**
 * Compact "just now / 5m ago / 3h ago / 2d ago" for a fetch timestamp. Fetch
 * errors are only interesting relative to now ("did this just break?"), so a
 * relative label reads faster than an absolute date here.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}
