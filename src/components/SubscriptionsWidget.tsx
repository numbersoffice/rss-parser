import type { WidgetServerProps } from 'payload'

import { PlusIcon } from '@payloadcms/ui'
import Link from 'next/link'
import { formatAdminURL } from 'payload/shared'

import { getSubscriptionLimit } from '@/lib/limits'

/**
 * Dashboard widget: a visual stand-in for the Subscriptions collection card.
 * Shows how many feeds you follow, with explicit actions to view the full
 * list or create a new subscription.
 *
 * Registered under admin.dashboard.widgets in payload.config.ts; users add it
 * from the dashboard editor.
 */
export async function SubscriptionsWidget(props: WidgetServerProps) {
  const { req } = props
  const { payload, user } = req
  if (!user) return null

  // overrideAccess: false applies the collection's read access, so users get
  // their own count and admins get everyone's — same as the list view.
  const { totalDocs } = await payload.count({
    collection: 'subscriptions',
    overrideAccess: false,
    user,
  })

  // Users are capped (settings global); admins are not. For users totalDocs
  // is their own count, and it can sit above the limit if an admin lowered
  // it retroactively — show it as-is (e.g. 20/15), existing subscriptions
  // keep working.
  const limit = user.role === 'admin' ? null : await getSubscriptionLimit(payload)
  const limitReached = limit !== null && totalDocs >= limit

  const adminRoute = payload.config.routes.admin
  const listHref = formatAdminURL({ adminRoute, path: '/collections/subscriptions' })
  const createHref = formatAdminURL({ adminRoute, path: '/collections/subscriptions/create' })

  return (
    <div className="subs-widget">
      <div className="subs-widget__summary">
        <span className="subs-widget__count">
          {totalDocs}
          {limit !== null && <span className="subs-widget__limit"> / {limit}</span>}
        </span>
        <span className="subs-widget__label">
          {/* "1 / 10" reads as a ratio, so keep it plural whenever a limit
              is shown; only a bare count ever reads singular */}
          {limit === null && totalDocs === 1 ? 'subscription' : 'subscriptions'}
          <span className="subs-widget__sublabel">
            {user.role === 'admin' ? 'across all users' : 'feeds you follow'}
          </span>
        </span>
      </div>
      <div className="subs-widget__actions">
        {limitReached ? (
          <span
            className="subs-widget__create subs-widget__create--disabled"
            aria-disabled="true"
            title="Subscription limit reached — delete a subscription to add a new one"
          >
            <PlusIcon />
            New subscription
          </span>
        ) : (
          <Link className="subs-widget__create" href={createHref} prefetch={false}>
            <PlusIcon />
            New subscription
          </Link>
        )}
        <Link className="subs-widget__view-all" href={listHref} prefetch={false}>
          View all →
        </Link>
      </div>
    </div>
  )
}
