import { config } from '../config.js'
import { optimizeDb, pruneDailyPostsBefore, pruneFetchLogBefore } from '../db.js'
import { windowStartDay } from '../lib/activity.js'
import type { JobResult } from './scheduler.js'

/**
 * Drop history that has fallen out of its retention window: per-attempt fetch
 * records, which exist to diagnose proxy trouble and are only useful while
 * recent, and daily post counts older than the window the average covers.
 */
export async function pruneHistory(): Promise<JobResult> {
  const logCutoff = Date.now() - config.fetchLogRetentionDays * 24 * 60 * 60_000
  const fetches = pruneFetchLogBefore(logCutoff)

  // windowStartDay includes today, so this keeps exactly activityWindowDays
  // distinct days. (The job this replaces was off by one and kept a day extra.)
  const days = pruneDailyPostsBefore(windowStartDay(config.activityWindowDays))

  optimizeDb()
  if (fetches === 0 && days === 0) return { skipped: true }
  return { fields: { fetches: fetches || undefined, dayBuckets: days || undefined } }
}
