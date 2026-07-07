'use client'

import type { UIFieldClientComponent } from 'payload'

import { FieldLabel, useConfig, useDocumentInfo } from '@payloadcms/ui'
import React, { useEffect, useState } from 'react'

/** How many recent attempts the bar shows — matches the "last 5" wording. */
const DOT_COUNT = 5

type Attempt = { id: number | string; status: 'success' | 'error'; createdAt: string; error?: string | null }

/**
 * Read-only strip of coloured dots — the last few fetch attempts for this
 * source, oldest → newest, green for success and red for error. Reads from the
 * request-logs collection (the source doc only holds the latest outcome), so it
 * fetches over the REST API once the document has an id. Shown at the top of the
 * "Last fetch" group on the source edit view.
 */
export const SourceHealthBar: UIFieldClientComponent = ({ field }) => {
  const { id } = useDocumentInfo()
  const {
    config: {
      routes: { api },
      serverURL,
    },
  } = useConfig()
  const [attempts, setAttempts] = useState<Attempt[] | null>(null)

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()
    const params = new URLSearchParams({
      'where[source][equals]': String(id),
      sort: '-createdAt',
      limit: String(DOT_COUNT),
      depth: '0',
    })
    fetch(`${serverURL}${api}/request-logs?${params}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data) => setAttempts((data?.docs as Attempt[]) ?? []))
      .catch(() => {
        /* aborted or failed — leave as the empty state */
      })
    return () => controller.abort()
  }, [id, api, serverURL])

  // No id yet (create form) — nothing to show.
  if (!id) return null

  // API returns newest-first; render oldest → newest so the latest sits on the right.
  const ordered = attempts ? [...attempts].reverse() : []

  return (
    <div className="field-type source-health">
      <FieldLabel label={field.label ?? 'Recent attempts'} />
      {attempts === null ? (
        <p className="source-health__empty">Loading…</p>
      ) : ordered.length === 0 ? (
        <p className="source-health__empty">No fetch attempts recorded yet.</p>
      ) : (
        <div className="source-health__dots" role="img" aria-label={ariaSummary(ordered)}>
          {ordered.map((a) => (
            <span
              key={a.id}
              className={`source-health__dot source-health__dot--${a.status === 'success' ? 'ok' : 'err'}`}
              title={dotTitle(a)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Hover text: when it happened, plus the error message for a failure. */
function dotTitle(a: Attempt): string {
  const when = new Date(a.createdAt).toLocaleString()
  if (a.status === 'error') return `${when} — error${a.error ? `: ${a.error}` : ''}`
  return `${when} — success`
}

/** Screen-reader summary, e.g. "Last 5 attempts: 4 succeeded, 1 failed." */
function ariaSummary(attempts: Attempt[]): string {
  const ok = attempts.filter((a) => a.status === 'success').length
  return `Last ${attempts.length} attempts: ${ok} succeeded, ${attempts.length - ok} failed`
}
