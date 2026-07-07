import type { TaskConfig } from 'payload'

/** How long a fetch log is kept before it's pruned. Bounds the history the
 * trend chart draws from and keeps the table small. */
export const REQUEST_LOG_TTL_DAYS = 7

/** Slug/queue/cron shared with payload.config.ts. Runs on the same `nightly`
 * queue as pruneUnverifiedUsers, so the existing autoRun entry for that queue
 * drives it too — no separate autoRun registration needed. */
export const PRUNE_LOGS_SLUG = 'pruneRequestLogs'
export const PRUNE_LOGS_QUEUE = 'nightly'
export const PRUNE_LOGS_CRON = '0 0 * * *'

/**
 * Nightly cleanup: delete request logs older than a week. Queued and run on the
 * `nightly` queue by `jobs.autoRun` (see payload.config.ts).
 */
export const pruneRequestLogsTask: TaskConfig<'pruneRequestLogs'> = {
  slug: PRUNE_LOGS_SLUG,
  schedule: [{ cron: PRUNE_LOGS_CRON, queue: PRUNE_LOGS_QUEUE }],
  handler: async ({ req }) => {
    const { payload } = req
    const cutoff = new Date(
      Date.now() - REQUEST_LOG_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString()

    const { docs } = await payload.delete({
      collection: 'request-logs',
      where: { createdAt: { less_than: cutoff } },
      req,
    })

    if (docs.length > 0) {
      payload.logger.info(
        `pruneRequestLogs: removed ${docs.length} request log(s) older than ${REQUEST_LOG_TTL_DAYS}d`,
      )
    }
    return { output: { removed: docs.length } }
  },
}
