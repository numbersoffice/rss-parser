'use client'

import React, { useState } from 'react'

import { FetchTrendChart, type TrendDay } from './FetchTrendChart'

/** Days of history the chart spans (including today) — mirrors the server. */
const DAYS = 7

/**
 * Which failures the success rate counts:
 * - `attempts`: every request-log row on its own — a retried fetch that failed
 *   twice before succeeding drags the rate down by those two failures.
 * - `sessions`: rows grouped by `fetchId`, so a whole refresh (with its
 *   retries) counts once and is a success if *any* attempt in it succeeded.
 *   Only the final outcome of a fetch session matters.
 */
type Mode = 'attempts' | 'sessions'

/**
 * Client shell for the fetch-success-rate widget. The server (FetchTrendWidget)
 * does the counting and hands us both series; this component just lets the admin
 * toggle which one the sparkline shows and recomputes the average caption to
 * match. Kept as a client component only for that toggle — no data fetching here.
 */
export function FetchTrendWidgetView({
  attemptDays,
  sessionDays,
}: {
  attemptDays: TrendDay[]
  sessionDays: TrendDay[]
}) {
  const [mode, setMode] = useState<Mode>('attempts')
  const days = mode === 'attempts' ? attemptDays : sessionDays

  const withData = days.filter((d): d is TrendDay & { rate: number } => d.rate !== null)
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

      <div className="trend-toggle" role="tablist" aria-label="How retries are counted">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'attempts'}
          className={`trend-toggle__btn${mode === 'attempts' ? ' trend-toggle__btn--active' : ''}`}
          onClick={() => setMode('attempts')}
          title="Count every fetch attempt — each failed retry counts against the rate"
        >
          Every attempt
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'sessions'}
          className={`trend-toggle__btn${mode === 'sessions' ? ' trend-toggle__btn--active' : ''}`}
          onClick={() => setMode('sessions')}
          title="Group retries by fetch — a fetch counts as a success if any attempt succeeded"
        >
          Per fetch
        </button>
      </div>

      {withData.length > 0 ? (
        <>
          <FetchTrendChart days={days} />
          <p className="usage-widget__caption">
            {avg !== null
              ? `avg ${formatPercent(avg)}% over ${withData.length}d · ${
                  mode === 'attempts' ? 'every attempt' : 'retries count as one'
                }`
              : ''}
          </p>
        </>
      ) : (
        <p className="usage-widget__empty">No fetch attempts recorded yet.</p>
      )}
    </div>
  )
}

/** Percentages to one decimal, dropping a trailing ".0" (e.g. "92" / "99.5"). */
function formatPercent(pct: number): string {
  return Number(pct.toFixed(1)).toString()
}
