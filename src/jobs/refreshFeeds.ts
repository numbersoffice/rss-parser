import { config } from '../config.js'
import { dueSources } from '../db.js'
import { log } from '../log.js'
import { refreshSource } from '../lib/refresh.js'
import type { JobResult } from './scheduler.js'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Refresh the accounts that are due, one at a time with a pause between.
 *
 * Sequential-with-stagger is the whole throttling strategy: never more than one
 * Instagram request in flight, which is what a metered residential proxy wants
 * and what Instagram's per-IP rate limiting punishes you for ignoring. At the
 * default 3 per minute that's 180 accounts/hour of capacity against a 60-minute
 * TTL — roughly 3.5× headroom for a 50-account list — and it means adding 50
 * accounts at once spreads their first fetch over ~17 minutes instead of firing
 * 50 proxied requests simultaneously. The per-tick cap *is* the herd control;
 * no jitter needed.
 */
export async function refreshFeeds(): Promise<JobResult> {
  const due = dueSources(config.refreshesPerTick)
  if (due.length === 0) return { skipped: true }

  const startedAt = Date.now()
  let ok = 0
  let failed = 0
  let created = 0
  let deleted = 0
  let mirrored = 0

  for (const [index, source] of due.entries()) {
    if (index > 0) {
      // Stop starting new fetches once the tick has run long; the next tick
      // picks up the rest, and the non-overlap guard keeps them from stacking.
      if (Date.now() - startedAt > config.refreshTickBudgetMs) {
        log.debug('refresh budget spent, deferring the rest', { remaining: due.length - index })
        break
      }
      await sleep(config.refreshStaggerMs)
    }

    const result = await refreshSource(source.id)
    if (result.status === 'success') {
      ok++
      created += result.created
      deleted += result.deleted
      mirrored += result.mirrored
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
      failed++
      log.warn('refresh failed', {
        handle: `@${source.handle}`,
        http: result.httpStatus,
        attempt: source.consecutive_failures + 1,
        error: result.error,
      })
    }
  }

  return {
    status: failed > 0 && ok === 0 ? 'error' : 'ok',
    fields: {
      ok,
      failed: failed || undefined,
      new: created || undefined,
      pruned: deleted || undefined,
      images: mirrored || undefined,
    },
  }
}
