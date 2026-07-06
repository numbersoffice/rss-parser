import type { TaskConfig } from 'payload'

/**
 * How long a self-registered account may stay unverified before it's removed.
 * Verified accounts, admin-created accounts and the first admin are all marked
 * `_verified = true` (see Users beforeChange), so only abandoned/never-confirmed
 * signups are eligible.
 */
export const UNVERIFIED_TTL_DAYS = 7

/** Slug/queue/cron shared with payload.config.ts (autoRun) and the admin notice
 * so the schedule is defined in one place. Cron is daily at midnight (server
 * time) — the notice computes "next run" assuming exactly that. */
export const PRUNE_UNVERIFIED_SLUG = 'pruneUnverifiedUsers'
export const PRUNE_UNVERIFIED_QUEUE = 'nightly'
export const PRUNE_UNVERIFIED_CRON = '0 0 * * *'

/**
 * Nightly cleanup: delete accounts that never confirmed their email and are
 * older than a week. Queued and run on the `nightly` queue by `jobs.autoRun`
 * (see payload.config.ts). Deleting a user cascades to their subscriptions via
 * the Users `beforeDelete` hook.
 */
export const pruneUnverifiedUsersTask: TaskConfig<'pruneUnverifiedUsers'> = {
  slug: PRUNE_UNVERIFIED_SLUG,
  schedule: [{ cron: PRUNE_UNVERIFIED_CRON, queue: PRUNE_UNVERIFIED_QUEUE }],
  handler: async ({ req }) => {
    const { payload } = req
    const cutoff = new Date(
      Date.now() - UNVERIFIED_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString()

    const { docs } = await payload.delete({
      collection: 'users',
      where: {
        and: [
          { createdAt: { less_than: cutoff } },
          // Safety net: never prune an admin, even if somehow unverified (e.g. a
          // dev DB where the _verified backfill migration hasn't run).
          { role: { not_equals: 'admin' } },
          // Unverified is stored as either 0/false or NULL (never set) — cover both.
          { or: [{ _verified: { equals: false } }, { _verified: { exists: false } }] },
        ],
      },
      req,
    })

    if (docs.length > 0) {
      payload.logger.info(
        `pruneUnverifiedUsers: removed ${docs.length} unverified account(s) older than ${UNVERIFIED_TTL_DAYS}d`,
      )
    }
    return { output: { removed: docs.length } }
  },
}
