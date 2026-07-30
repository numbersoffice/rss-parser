import fs from 'node:fs/promises'

import { config } from '../config.js'
import { deleteSource, insertSource, listSources } from '../db.js'
import { log } from '../log.js'
import { parseAccounts } from '../lib/accounts.js'
import { unlinkAssets } from '../lib/assets.js'
import { describeError } from '../lib/errors.js'

const TYPE = 'instagram'

/**
 * Reconcile the sources table with `accounts.txt`: insert what's new, delete
 * what's gone along with its mirrored images.
 *
 * Runs once, at boot. The file is committed to the repo, so adding or removing a
 * handle triggers a redeploy — and the fresh process reconciles here on the way
 * up. There is no periodic re-read: nothing changes the file within a run's life.
 *
 * The safety rule here matters more than anything else in the app: if the file
 * is missing, unreadable, or contains no usable handles, change *nothing*.
 * Otherwise a failed bind mount or a botched edit would silently delete every
 * feed and every asset, and that is the one loss in this system that isn't
 * recoverable from a re-fetch.
 */
export async function syncAccounts(): Promise<void> {
  let text: string
  try {
    text = await fs.readFile(config.accountsFile, 'utf8')
  } catch (err) {
    log.error('cannot read the accounts file — leaving all feeds untouched', {
      file: config.accountsFile,
      error: describeError(err),
    })
    return
  }

  const { handles, invalid } = parseAccounts(text)
  for (const line of invalid) {
    log.warn('ignoring unusable line in accounts file', { line })
  }
  if (handles.length === 0) {
    log.error('accounts file lists no usable handles — leaving all feeds untouched', {
      file: config.accountsFile,
    })
    return
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

  const feeds = existing.length + added.length - removed.length
  if (added.length === 0 && removed.length === 0) {
    log.info('accounts in sync', { feeds })
    return
  }
  log.info('accounts synced', {
    added: added.length || undefined,
    removed: removed.length || undefined,
    handles: [...added.map((h) => `+@${h}`), ...removed.map((h) => `-@${h}`)].join(' '),
    assets: assetsRemoved || undefined,
    feeds,
  })
}
