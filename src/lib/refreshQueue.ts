import { config } from '../config.js'
import { log } from '../log.js'
import { describeError } from './errors.js'
import { type RefreshResult, refreshSource } from './refresh.js'

/**
 * Background refresh coordinator — the replacement for the old timer that
 * refreshed every account every hour whether or not anyone was reading.
 *
 * A feed is now refreshed only when a reader polls its `.xml`, and at most once
 * an hour: the hourly cap already lives in `sources.next_fetch_at` (the refresh
 * sets it forward on success, or to a short backoff on failure), so a trigger is
 * just "is this source due, and not already running?".
 *
 * Fire-and-forget from the request path: the poll serves the cached feed
 * instantly and the refresh happens in the background, so a reader never pays
 * Instagram's latency (see the note on the feed route in server.ts). New posts
 * surface on the reader's next poll — plain stale-while-revalidate.
 *
 * One shared serial chain runs the refreshes, so there is never more than one
 * Instagram request in flight even if a reader polls every feed at once — the
 * same throttle the old sequential job provided, and what a metered residential
 * proxy and Instagram's per-IP limits both want.
 */

/** What the coordinator needs off a source row to decide whether to refresh. */
export interface RefreshCandidate {
  id: number
  handle: string
  next_fetch_at: number
}

export interface RefreshQueue {
  /**
   * Trigger a background refresh if `source` is due and not already queued or
   * running. Never awaited by callers and never throws. `force` bypasses the
   * due-check (used to seed a never-fetched account at boot).
   */
  request(source: RefreshCandidate, force?: boolean): void
  /** How many sources are currently queued or running — for tests. */
  readonly busy: number
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Build a coordinator around a refresh function. Production wires in
 * `refreshSource`; tests inject a stub so the queue's dedup/gating/serialization
 * can be exercised without a network, database or filesystem.
 */
export function createRefreshQueue(
  refresh: (sourceId: number) => Promise<RefreshResult>,
  opts: { staggerMs?: number } = {},
): RefreshQueue {
  const staggerMs = opts.staggerMs ?? 0
  // Sources currently queued or running. Dedupes rapid polls of the same feed:
  // a second trigger while the first is still pending is a no-op.
  const inFlight = new Set<number>()
  // A single chain, so runs happen one at a time. It must never reject, or a
  // fire-and-forget trigger would surface as an unhandled rejection.
  let tail: Promise<void> = Promise.resolve()

  const run = async (source: RefreshCandidate): Promise<void> => {
    // Space successive fetches out a little, so a burst of polls doesn't hammer
    // the proxy pool back to back. Skipped for the first run in an idle chain.
    if (staggerMs > 0 && inFlight.size > 1) await sleep(staggerMs)
    try {
      const result = await refresh(source.id)
      if (result.status === 'success') {
        log.info('refreshed', {
          handle: `@${source.handle}`,
          http: result.httpStatus,
          ms: result.durationMs,
          items: result.itemCount,
          new: result.created || undefined,
          pruned: result.deleted || undefined,
          images: result.mirrored || undefined,
        })
      } else {
        log.warn('refresh failed', {
          handle: `@${source.handle}`,
          http: result.httpStatus,
          error: result.error,
        })
      }
    } catch (err) {
      // refreshSource is contracted never to throw, but a stub might; keep the
      // chain alive and quiet regardless.
      log.error('refresh threw', { handle: `@${source.handle}`, error: describeError(err) })
    } finally {
      inFlight.delete(source.id)
    }
  }

  return {
    request(source, force = false): void {
      if (inFlight.has(source.id)) return
      if (!force && source.next_fetch_at > Date.now()) return
      inFlight.add(source.id)
      tail = tail.then(() => run(source))
    },
    get busy(): number {
      return inFlight.size
    },
  }
}

/** The process-wide coordinator the feed route and the boot seed both use. */
export const refreshQueue = createRefreshQueue(refreshSource, {
  staggerMs: config.refreshStaggerMs,
})
