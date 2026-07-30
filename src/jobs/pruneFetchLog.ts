import { config } from '../config.js'
import { optimizeDb, pruneFetchLogBefore } from '../db.js'
import type { JobResult } from './scheduler.js'

/**
 * Drop old per-attempt fetch records. They exist to diagnose proxy trouble
 * ("was that a 401 from one bad exit IP or is the account gone?"), which is only
 * useful while recent.
 */
export async function pruneFetchLog(): Promise<JobResult> {
  const cutoff = Date.now() - config.fetchLogRetentionDays * 24 * 60 * 60_000
  const removed = pruneFetchLogBefore(cutoff)
  optimizeDb()
  if (removed === 0) return { skipped: true }
  return { fields: { removed, olderThanDays: config.fetchLogRetentionDays } }
}
