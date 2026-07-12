import type { TaskConfig } from 'payload'

import { dayKey } from '@/lib/day'

/** How long a daily source-activity row is kept before it's pruned. Bounds the
 * window the "Most active sources" widget sums over (its "last 7 days") and
 * keeps the table small. */
export const SOURCE_ACTIVITY_TTL_DAYS = 7

/** Slug/queue/cron shared with payload.config.ts and the admin notice. Runs on
 * the same `nightly` queue as the other prune tasks, so the existing autoRun
 * entry for that queue drives it too — no separate autoRun registration needed. */
export const PRUNE_ACTIVITY_SLUG = 'pruneSourceActivity'
export const PRUNE_ACTIVITY_QUEUE = 'nightly'
export const PRUNE_ACTIVITY_CRON = '0 0 * * *'

/**
 * Nightly cleanup: delete daily source-activity rows older than a week. Queued
 * and run on the `nightly` queue by `jobs.autoRun` (see payload.config.ts).
 */
export const pruneSourceActivityTask: TaskConfig<'pruneSourceActivity'> = {
  slug: PRUNE_ACTIVITY_SLUG,
  schedule: [{ cron: PRUNE_ACTIVITY_CRON, queue: PRUNE_ACTIVITY_QUEUE }],
  handler: async ({ req }) => {
    const { payload } = req
    // Keep today plus the prior 6 days: drop rows for days strictly before the
    // cutoff day. `day` is a fixed-width YYYY-MM-DD string, so a lexicographic
    // `less_than` is a correct date compare.
    const cutoff = dayKey(new Date(Date.now() - SOURCE_ACTIVITY_TTL_DAYS * 24 * 60 * 60 * 1000))

    const { docs } = await payload.delete({
      collection: 'source-activity',
      where: { day: { less_than: cutoff } },
      req,
    })

    if (docs.length > 0) {
      payload.logger.info(
        `pruneSourceActivity: removed ${docs.length} activity row(s) older than ${SOURCE_ACTIVITY_TTL_DAYS}d`,
      )
    }
    return { output: { removed: docs.length } }
  },
}
