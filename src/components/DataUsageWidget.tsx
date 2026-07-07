import type { WidgetServerProps } from 'payload'

import { getDecodoUsage } from '@/lib/decodo'

const DECODO_DASHBOARD_URL = 'https://dashboard.decodo.com'

/**
 * Dashboard widget: Decodo residential proxy data usage for the current billing
 * cycle, with a shortcut over to the Decodo dashboard. Reads the account's
 * usage from Decodo's Public API (see @/lib/decodo).
 *
 * Account-level billing data, so admins only — registered under
 * admin.dashboard.widgets in payload.config.ts (which only the admin
 * DefaultDashboard surfaces) and additionally guarded here.
 *
 * This is a system-admin readout, so it favours a compact, detailed layout
 * over the big number / CTA button of the subscriptions widget — see
 * .usage-widget in (payload)/custom.scss.
 */
export async function DataUsageWidget(props: WidgetServerProps) {
  const { user } = props.req
  if (user?.role !== 'admin') return null

  const usage = await getDecodoUsage()
  // Percent used drives both the meter fill and the numeric readouts; guard the
  // divide so an unreported/zero limit doesn't yield NaN.
  const percentUsed = usage && usage.limitGb > 0 ? (usage.usedGb / usage.limitGb) * 100 : 0
  const fillPercent = Math.min(Math.max(percentUsed, 0), 100)

  return (
    <div className="usage-widget">
      <div className="usage-widget__header">
        <span className="usage-widget__title">Residential proxy</span>
        <a
          className="usage-widget__link"
          href={DECODO_DASHBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Decodo ↗
        </a>
      </div>

      {usage ? (
        <>
          <div className="usage-widget__meter" aria-hidden="true">
            <div className="usage-widget__meter-fill" style={{ width: `${fillPercent}%` }} />
          </div>
          <p className="usage-widget__caption">
            {formatPercent(percentUsed)}% of this cycle used
            {usage.validUntil ? ` · renews ${formatDate(usage.validUntil)}` : ''}
          </p>

          <dl className="usage-widget__stats">
            <div>
              <dt>Used</dt>
              <dd>{formatGb(usage.usedGb)} GB</dd>
            </div>
            <div>
              <dt>Remaining</dt>
              <dd>{formatGb(usage.remainingGb)} GB</dd>
            </div>
            <div>
              <dt>Limit</dt>
              <dd>{formatGb(usage.limitGb)} GB</dd>
            </div>
            <div>
              <dt>Used</dt>
              <dd>{formatPercent(percentUsed)}%</dd>
            </div>
          </dl>
        </>
      ) : (
        <p className="usage-widget__empty">
          Usage unavailable — set <code>DECODO_API_KEY</code> to show remaining GB.
        </p>
      )}
    </div>
  )
}

/** GB figures to a fixed two decimals so small usage never rounds away to "0". */
function formatGb(gb: number): string {
  return gb.toFixed(2)
}

/** Percentages to one decimal, dropping a trailing ".0" (e.g. "32" / "0.8"). */
function formatPercent(pct: number): string {
  return Number(pct.toFixed(1)).toString()
}

/** Render an ISO date as a short, locale-stable "Jul 7, 2026". */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
