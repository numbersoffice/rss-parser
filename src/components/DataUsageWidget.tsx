import type { WidgetServerProps } from 'payload'

import { getDecodoUsage } from '@/lib/decodo'

const DECODO_DASHBOARD_URL = 'https://dashboard.decodo.com'

/**
 * Dashboard widget: remaining Decodo residential proxy data for the billing
 * cycle, with a shortcut over to the Decodo dashboard. Reads the account's
 * usage from Decodo's Public API (see @/lib/decodo).
 *
 * Account-level billing data, so admins only — registered under
 * admin.dashboard.widgets in payload.config.ts (which only the admin
 * DefaultDashboard surfaces) and additionally guarded here.
 *
 * Shares the .subs-widget layout classes; .usage-widget only adds what differs.
 */
export async function DataUsageWidget(props: WidgetServerProps) {
  const { user } = props.req
  if (user?.role !== 'admin') return null

  const usage = await getDecodoUsage()

  return (
    <div className="subs-widget usage-widget">
      {usage ? (
        <div className="subs-widget__summary">
          <span className="subs-widget__count">
            {formatGb(usage.remainingGb)}
            <span className="subs-widget__limit"> / {formatGb(usage.limitGb)} GB</span>
          </span>
          <span className="subs-widget__label">
            remaining
            <span className="subs-widget__sublabel">
              {formatGb(usage.usedGb)} GB used this cycle
              {usage.validUntil ? ` · renews ${formatDate(usage.validUntil)}` : ''}
            </span>
          </span>
        </div>
      ) : (
        <div className="subs-widget__summary">
          <span className="subs-widget__label">
            Usage unavailable
            <span className="subs-widget__sublabel">
              Set <code>DECODO_API_KEY</code> to show remaining GB.
            </span>
          </span>
        </div>
      )}
      <div className="subs-widget__actions">
        <a
          className="subs-widget__create"
          href={DECODO_DASHBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Decodo ↗
        </a>
      </div>
    </div>
  )
}

/** Trim GB figures to at most one decimal, dropping a trailing ".0". */
function formatGb(gb: number): string {
  return Number(gb.toFixed(1)).toString()
}

/** Render an ISO date as a short, locale-stable "Jul 7, 2026". */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
