'use client'

import { useConfig, useDocumentInfo } from '@payloadcms/ui'
import React, { useEffect, useState } from 'react'

/** How many recent fetch sessions the bar shows — matches the "last 5" wording. */
const SESSION_COUNT = 5

/** Fallback when the settings global can't be read — mirrors DEFAULT_MAX_FETCH_ATTEMPTS. */
const DEFAULT_MAX_ATTEMPTS = 3

type Attempt = {
  id: number | string
  status: 'success' | 'error'
  createdAt: string
  error?: string | null
  fetchId?: string | null
}

/** A fetch session: one refresh's worth of attempts (retries), collapsed to a
 * single dot — healthy if any attempt in it succeeded. */
type Session = { attempts: Attempt[]; status: 'success' | 'error'; createdAt: string }

/**
 * Read-only strip of coloured dots in the source's document header — the last
 * few *fetch sessions*, oldest → newest, green when the session ultimately
 * succeeded and red when every retry failed. A refresh may retry on a fresh
 * proxy IP up to Settings.maxFetchAttempts times, writing one request-log row
 * per attempt — all sharing a `fetchId` — so we group by that id to collapse a
 * refresh's retries into one dot. The row count we fetch is sized from the retry
 * cap (SESSION_COUNT + 1 sessions × attempts each) so a full 5 sessions survive
 * even if every one exhausted its retries — overfetching slightly is fine.
 */
export const SourceHealthBar: React.FC = () => {
  const { id } = useDocumentInfo()
  const {
    config: {
      routes: { api },
      serverURL,
    },
  } = useConfig()
  const [sessions, setSessions] = useState<Session[] | null>(null)

  useEffect(() => {
    if (!id) return
    const controller = new AbortController()

    async function load() {
      // Size the fetch from the current retry cap: worst case a session is
      // maxAttempts rows, so pull enough for SESSION_COUNT + 1 of them.
      const maxAttempts = await fetchMaxAttempts(serverURL, api, controller.signal)
      const limit = (SESSION_COUNT + 1) * maxAttempts
      const params = new URLSearchParams({
        'where[source][equals]': String(id),
        sort: '-createdAt',
        limit: String(limit),
        depth: '0',
      })
      const res = await fetch(`${serverURL}${api}/request-logs?${params}`, {
        credentials: 'include',
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = await res.json()
      const attempts = (data?.docs as Attempt[]) ?? []
      // API returns newest-first; group oldest → newest so a success closes its
      // session, then keep the most recent SESSION_COUNT sessions.
      const grouped = groupSessions([...attempts].reverse(), maxAttempts)
      setSessions(grouped.slice(-SESSION_COUNT))
    }

    load().catch(() => {
      /* aborted or failed — leave as the empty state */
    })
    return () => controller.abort()
  }, [id, api, serverURL])

  // No id yet (create form) — nothing to show.
  if (!id) return null

  return (
    <div className="source-health" title="Recent fetch health">
      {sessions === null ? (
        <span className="source-health__empty">Health …</span>
      ) : sessions.length === 0 ? (
        <span className="source-health__empty">No fetches yet</span>
      ) : (
        <>
          <span className="source-health__caption">oldest</span>
          <div className="source-health__dots" role="img" aria-label={ariaSummary(sessions)}>
            {sessions.map((s) => (
              <span
                key={s.createdAt}
                className={`source-health__dot source-health__dot--${s.status === 'success' ? 'ok' : 'err'}`}
                title={dotTitle(s)}
              />
            ))}
          </div>
          <span className="source-health__caption">newest</span>
        </>
      )}
    </div>
  )
}

/** Read the admin-configured retry cap from the settings global; fall back to
 * the default if it can't be read (never blocks the dots from rendering). */
async function fetchMaxAttempts(serverURL: string, api: string, signal: AbortSignal): Promise<number> {
  try {
    const res = await fetch(`${serverURL}${api}/globals/settings?depth=0`, {
      credentials: 'include',
      signal,
    })
    if (!res.ok) return DEFAULT_MAX_ATTEMPTS
    const data = await res.json()
    const value = Number(data?.maxFetchAttempts)
    return Number.isFinite(value) && value >= 1 ? value : DEFAULT_MAX_ATTEMPTS
  } catch {
    return DEFAULT_MAX_ATTEMPTS
  }
}

/**
 * Fold a chronological (oldest → newest) list of attempts into sessions. Every
 * attempt of one refresh shares a `fetchId`, so consecutive rows with the same
 * id are one session. Legacy rows written before fetchId existed have none; for
 * those we fall back to the shape of a retry run — the adapter stops on the
 * first success and after maxAttempts failures, so a session ends at a success
 * or the maxAttempts-th attempt. A session is healthy if any attempt succeeded.
 */
function groupSessions(attempts: Attempt[], maxAttempts: number): Session[] {
  const sessions: Session[] = []
  let current: Attempt[] = []
  const flush = () => {
    if (current.length > 0) {
      sessions.push(toSession(current))
      current = []
    }
  }
  for (const attempt of attempts) {
    // A different fetchId means a new refresh started — close the previous one.
    const prev = current[current.length - 1]
    if (prev && (prev.fetchId ?? null) !== (attempt.fetchId ?? null)) flush()
    current.push(attempt)

    if (attempt.fetchId) continue // grouped by id; boundary is the next id change
    // Legacy rows (no fetchId): infer the boundary from the retry shape.
    if (attempt.status === 'success' || current.length >= maxAttempts) flush()
  }
  // Trailing attempts (a session still in flight, or cut short by the fetch
  // window) — surface them as their own dot.
  flush()
  return sessions
}

function toSession(attempts: Attempt[]): Session {
  const succeeded = attempts.some((a) => a.status === 'success')
  return {
    attempts,
    status: succeeded ? 'success' : 'error',
    // Key/label off the last attempt — the session's actual outcome time.
    createdAt: attempts[attempts.length - 1]!.createdAt,
  }
}

/** Hover text: when the session finished, its outcome, and any retry count. */
function dotTitle(s: Session): string {
  const when = new Date(s.createdAt).toLocaleString()
  const tries = s.attempts.length > 1 ? ` (${s.attempts.length} attempts)` : ''
  if (s.status === 'success') return `${when} — success${tries}`
  const lastError = [...s.attempts].reverse().find((a) => a.error)?.error
  return `${when} — failed${tries}${lastError ? `: ${lastError}` : ''}`
}

/** Screen-reader summary, e.g. "Last 5 fetches: 4 succeeded, 1 failed." */
function ariaSummary(sessions: Session[]): string {
  const ok = sessions.filter((s) => s.status === 'success').length
  return `Last ${sessions.length} fetches: ${ok} succeeded, ${sessions.length - ok} failed`
}
