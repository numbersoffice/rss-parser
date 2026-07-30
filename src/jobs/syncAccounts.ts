import fs from 'node:fs/promises'

import { config } from '../config.js'
import { deleteSource, insertSource, listSources } from '../db.js'
import { log } from '../log.js'
import { parseAccounts } from '../lib/accounts.js'
import { unlinkAssets } from '../lib/assets.js'
import { describeError } from '../lib/errors.js'
import type { JobResult } from './scheduler.js'

const TYPE = 'instagram'

/** Last seen mtime, so an unchanged file costs one stat and no parse or diff. */
let lastMtimeMs = -1

/** Force the next run to re-read regardless of mtime (boot, SIGHUP). */
export function invalidateAccountsCache(): void {
  lastMtimeMs = -1
}

/**
 * Reconcile the sources table with `accounts.txt`: insert what's new, delete
 * what's gone along with its mirrored images.
 *
 * The safety rule here matters more than anything else in the app: if the file
 * is missing, unreadable, or contains no usable handles, change *nothing*.
 * Otherwise a failed bind mount or a botched edit would silently delete every
 * feed and every asset, and that is the one loss in this system that isn't
 * recoverable from a re-fetch.
 */
export async function syncAccounts(): Promise<JobResult> {
  let text: string
  try {
    const stat = await fs.stat(config.accountsFile)
    if (stat.mtimeMs === lastMtimeMs) return { skipped: true }
    text = await fs.readFile(config.accountsFile, 'utf8')
    lastMtimeMs = stat.mtimeMs
  } catch (err) {
    log.error('cannot read the accounts file — leaving all feeds untouched', {
      file: config.accountsFile,
      error: describeError(err),
    })
    return { status: 'error' }
  }

  const { handles, invalid } = parseAccounts(text)
  for (const line of invalid) {
    log.warn('ignoring unusable line in accounts file', { line })
  }
  if (handles.length === 0) {
    log.error('accounts file lists no usable handles — leaving all feeds untouched', {
      file: config.accountsFile,
    })
    return { status: 'error' }
  }

  const existing = listSources()
  const wanted = new Set(handles)
  const known = new Set(existing.map((source) => source.handle))

  const added: string[] = []
  for (const handle of handles) {
    if (known.has(handle)) continue
    insertSource(TYPE, handle)
    added.push(handle)
  }

  const removed: string[] = []
  let assetsRemoved = 0
  for (const source of existing) {
    if (wanted.has(source.handle)) continue
    // Rows first, files second: a crash in between leaves orphan files, which
    // the asset sweep reclaims. The other order would leave rows pointing at
    // images that no longer exist.
    const assets = deleteSource(source.id)
    assetsRemoved += await unlinkAssets(assets)
    removed.push(source.handle)
  }

  if (added.length === 0 && removed.length === 0) {
    return { fields: { feeds: existing.length } }
  }
  return {
    fields: {
      added: added.length || undefined,
      removed: removed.length || undefined,
      handles: [...added.map((h) => `+@${h}`), ...removed.map((h) => `-@${h}`)].join(' '),
      assets: assetsRemoved || undefined,
      feeds: existing.length + added.length - removed.length,
    },
  }
}
