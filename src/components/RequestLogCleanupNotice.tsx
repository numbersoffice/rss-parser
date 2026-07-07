import type { BeforeListTableServerProps } from 'payload'

import { PRUNE_LOGS_QUEUE, PRUNE_LOGS_SLUG, REQUEST_LOG_TTL_DAYS } from '@/lib/jobs/pruneRequestLogs'

/** Runtime shape of the payload-jobs-stats global's loosely-typed `stats`. */
interface JobScheduleStats {
  scheduledRuns?: {
    queues?: {
      [queue: string]: {
        tasks?: { [task: string]: { lastScheduledRun?: string } }
      }
    }
  }
}

const fmt = (d: Date) => d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Admin-only line above the Request Logs list: when the log cleanup last ran and
 * when it runs next. "Last run" comes from Payload's payload-jobs-stats global
 * (`lastScheduledRun`, written each time the scheduled job is queued); "next
 * run" is the next midnight, matching the task's daily-midnight cron. Mirrors
 * the Users list's UnverifiedCleanupNotice.
 */
export async function RequestLogCleanupNotice(props: BeforeListTableServerProps) {
  const { payload, user } = props
  if (user?.role !== 'admin') return null

  let lastRun: Date | null = null
  try {
    const jobStats = await payload.findGlobal({ slug: 'payload-jobs-stats' })
    const stats = jobStats?.stats as JobScheduleStats | null | undefined
    const iso =
      stats?.scheduledRuns?.queues?.[PRUNE_LOGS_QUEUE]?.tasks?.[PRUNE_LOGS_SLUG]?.lastScheduledRun
    if (iso) lastRun = new Date(iso)
  } catch {
    // The stats global may not exist until the first scheduled run — treat as "not yet".
  }

  // Next run: the upcoming midnight in the server's timezone.
  const nextRun = new Date()
  nextRun.setHours(24, 0, 0, 0)

  return (
    <p className="cleanup-notice">
      Request logs older than {REQUEST_LOG_TTL_DAYS} days are removed automatically each night.{' '}
      Last cleanup: <strong>{lastRun ? fmt(lastRun) : 'not yet'}</strong> · Next cleanup:{' '}
      <strong>{fmt(nextRun)}</strong>.
    </p>
  )
}
