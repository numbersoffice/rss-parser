import fs from 'node:fs/promises'

import { assetsDir, config } from '../config.js'
import { referencedAssets } from '../db.js'
import { log } from '../log.js'
import { assetPath, clearTmp, invalidateAssetUsage } from '../lib/assets.js'
import { describeError } from '../lib/errors.js'
import type { JobResult } from './scheduler.js'

/**
 * Reclaim image files no row references any more.
 *
 * This is the backstop for every crash window in the system: a refresh writes
 * image files before committing the rows that point at them, and deletes rows
 * before unlinking their files, so an ill-timed crash can leave a file with no
 * owner. Deliberately the safe direction — an orphan file wastes a little disk,
 * whereas a row pointing at a missing image breaks a feed.
 *
 * The grace period is load-bearing: without it, a sweep landing between a
 * download and its commit would delete a file that is about to be referenced.
 * That window is milliseconds wide; an hour of slack costs nothing.
 */
export async function sweepAssets(): Promise<JobResult> {
  await clearTmp()

  let entries: string[]
  try {
    entries = await fs.readdir(assetsDir)
  } catch (err) {
    log.warn('could not read the assets directory', { error: describeError(err) })
    return { status: 'error' }
  }

  const referenced = referencedAssets()
  const cutoff = Date.now() - config.assetSweepGraceMs
  let removed = 0
  let bytes = 0

  for (const entry of entries) {
    if (referenced.has(entry)) continue
    const file = assetPath(entry)
    try {
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.mtimeMs >= cutoff) continue
      await fs.unlink(file)
      removed++
      bytes += stat.size
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') {
        log.debug('could not sweep asset', { file: entry, error: describeError(err) })
      }
    }
  }

  if (removed === 0) return { skipped: true }
  invalidateAssetUsage()
  return { fields: { removed, kb: Math.round(bytes / 1024) } }
}
