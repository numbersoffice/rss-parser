import { randomUUID } from 'node:crypto'

import { getAdapter } from '../adapters/registry.js'
import type { AttemptRecord, NormalizedFeed, NormalizedItem } from '../adapters/types.js'
import { PermanentFetchError } from '../adapters/types.js'
import { assetUrl, config } from '../config.js'
import {
  commitRefresh,
  type FetchLogEntry,
  type ItemData,
  type ItemRow,
  type SourceOutcome,
  type SourceRow,
  getSource,
  listItems,
} from '../db.js'
import { log } from '../log.js'
import { postAssetName, profileAssetName, storeImage, unlinkAssets } from './assets.js'
import { describeError } from './errors.js'
import { escapeHtml } from './html.js'
import { planReconcile } from './plan.js'

/** What one refresh did, for the caller's log line. */
export interface RefreshResult {
  status: 'success' | 'error'
  itemCount: number
  created: number
  updated: number
  deleted: number
  mirrored: number
  httpStatus: number | null
  durationMs: number | null
  error?: string
}

/**
 * Fetch an account's latest posts, mirror their images, and reconcile them into
 * the database. Never throws: on failure the previously cached items keep
 * serving and the error is recorded on the source.
 *
 * The ordering below is deliberate and load-bearing:
 *
 *   1. fetch (network)         — may throw, handled
 *   2. read existing rows      — cheap, synchronous
 *   3. plan the diff           — pure, in memory
 *   4. mirror images (network) — every await happens here
 *   5. commit                  — one synchronous transaction, no awaits
 *   6. unlink dropped files    — after the commit, best-effort
 *
 * Steps 4 and 5 must not interleave, and better-sqlite3 enforces it: a
 * transaction body that returns a promise is rejected outright. Step 6 comes
 * after the commit so a crash between them leaves an orphan file (which the
 * asset sweep reclaims) rather than a row pointing at a missing image.
 */
export async function refreshSource(sourceId: number): Promise<RefreshResult> {
  // Read the row here rather than trusting a caller's copy: `profile_asset` and
  // `consecutive_failures` drive mirror-once and backoff decisions, and acting on
  // a stale snapshot would silently re-download the avatar on every refresh.
  const source = getSource(sourceId)
  if (!source) {
    return {
      status: 'error',
      itemCount: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      mirrored: 0,
      httpStatus: null,
      durationMs: null,
      error: `source ${sourceId} no longer exists`,
    }
  }

  const debug: Record<string, unknown> = {}
  const fetchId = randomUUID()

  let feed: NormalizedFeed
  try {
    feed = await getAdapter(source.type).fetchItems(source, debug, config.maxFetchAttempts)
  } catch (err) {
    return recordFailure(source, err, debug, fetchId)
  }

  const existing = listItems(source.id)
  const plan = planReconcile(existing, feed.items, config.maxItemsPerFeed)

  // --- network phase: mirror images before anything is written -------------
  let mirrored = 0
  const updates: { id: number; data: ItemData }[] = []
  for (const { existing: row, fetched } of plan.updates) {
    const image = await resolveImage(source, fetched, row)
    if (image.mirroredNow) mirrored++
    const data = itemData(fetched, image)
    // Most refreshes re-fetch the same posts unchanged. Skipping the identical
    // rows keeps the write phase empty, and — because `updated_at` only moves
    // when something really changed — leaves every reader's cached ETag valid,
    // so an hourly refresh of a quiet account costs no reader any bandwidth.
    if (!isUnchanged(row, data)) updates.push({ id: row.id, data })
  }
  const creates: ItemData[] = []
  for (const item of plan.creates) {
    const image = await resolveImage(source, item, undefined)
    if (image.mirroredNow) mirrored++
    creates.push(itemData(item, image))
  }
  const profile = await resolveProfileImage(source, feed.profile?.imageUrl)

  // --- commit --------------------------------------------------------------
  const changed =
    creates.length > 0 ||
    plan.deletes.length > 0 ||
    updates.length > 0 ||
    profile.profileImageUrl !== undefined

  const httpStatus = typeof debug.httpStatus === 'number' ? debug.httpStatus : null
  const durationMs = typeof debug.durationMs === 'number' ? debug.durationMs : null

  const outcome: SourceOutcome = {
    status: 'success',
    error: null,
    httpStatus,
    durationMs,
    nextFetchAt: Date.now() + config.refreshIntervalMinutes * 60_000,
    consecutiveFailures: 0,
    permanentError: null,
    permanentErrorKind: null,
    name: feed.profile?.title ?? `@${source.handle}`,
    description: feed.profile?.description ?? null,
    ...profile,
    bumpUpdatedAt: changed,
  }

  commitRefresh(
    source.id,
    { updates, deletes: plan.deletes.map((row) => row.id), creates },
    outcome,
    attemptLog(source.id, fetchId, debug, { status: 'success', httpStatus, durationMs }),
  )

  // --- post-commit cleanup -------------------------------------------------
  const doomed = plan.deletes
    .map((row) => row.asset)
    .filter((name): name is string => name !== null)
  await unlinkAssets(doomed)

  return {
    status: 'success',
    itemCount: existing.length + creates.length - plan.deletes.length,
    created: creates.length,
    updated: updates.length,
    deleted: plan.deletes.length,
    mirrored,
    httpStatus,
    durationMs,
  }
}

/**
 * Record a failed fetch. Nothing about the cached items changes — only the
 * source's status and when to try again. A transient failure (a burned proxy
 * exit IP) backs off in minutes; an account that can't work at all backs off to
 * once a day, but never stops being retried, because private/renamed accounts
 * come back and Instagram occasionally 404s a live profile.
 */
function recordFailure(
  source: SourceRow,
  err: unknown,
  debug: Record<string, unknown>,
  fetchId: string,
): RefreshResult {
  const error = describeError(err)
  const permanent = err instanceof PermanentFetchError
  const failures = source.consecutive_failures + 1
  const httpStatus = typeof debug.httpStatus === 'number' ? debug.httpStatus : null
  const durationMs = typeof debug.durationMs === 'number' ? debug.durationMs : null

  const backoff = permanent
    ? config.permanentErrorBackoffMs
    : Math.min(
        config.refreshIntervalMinutes * 60_000,
        config.retryBackoffMs * 2 ** Math.min(failures - 1, 8),
      )

  commitRefresh(
    source.id,
    { updates: [], deletes: [], creates: [] },
    {
      status: 'error',
      error,
      httpStatus,
      durationMs,
      nextFetchAt: Date.now() + backoff,
      consecutiveFailures: failures,
      permanentError: permanent ? error : null,
      permanentErrorKind: permanent ? (err as PermanentFetchError).kind : null,
      // The feed body is unchanged, so cached ETags stay valid.
      bumpUpdatedAt: false,
    },
    attemptLog(source.id, fetchId, debug, { status: 'error', httpStatus, durationMs, error }),
  )

  return {
    status: 'error',
    itemCount: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    mirrored: 0,
    httpStatus,
    durationMs,
    error,
  }
}

/**
 * One fetch-log row per attempt, all sharing a fetch id, so retries count as
 * their own requests when diagnosing proxy trouble. Adapters that don't report
 * per-attempt records fall back to a single row from the final outcome.
 */
function attemptLog(
  sourceId: number,
  fetchId: string,
  debug: Record<string, unknown>,
  fallback: {
    status: 'success' | 'error'
    httpStatus: number | null
    durationMs: number | null
    error?: string
  },
): FetchLogEntry[] {
  const attempts = Array.isArray(debug.attempts) ? (debug.attempts as AttemptRecord[]) : []
  if (attempts.length > 0) {
    return attempts.map((attempt, index) => ({
      source_id: sourceId,
      fetch_id: fetchId,
      attempt: index + 1,
      status: attempt.status,
      error: attempt.error,
      http_status: attempt.httpStatus,
      duration_ms: attempt.durationMs,
    }))
  }
  return [
    {
      source_id: sourceId,
      fetch_id: fetchId,
      attempt: 1,
      status: fallback.status,
      error: fallback.error ?? null,
      http_status: fallback.httpStatus,
      duration_ms: fallback.durationMs,
    },
  ]
}

interface ResolvedImage {
  imageUrl: string | null
  asset: string | null
  assetBytes: number | null
  assetMime: string | null
  content: string
  mirroredNow: boolean
}

/** Whether a stored row already holds exactly what this refresh would write. */
function isUnchanged(row: ItemRow, data: ItemData): boolean {
  return (
    row.title === data.title &&
    row.content === data.content &&
    row.url === data.url &&
    row.image_url === data.image_url &&
    row.asset === data.asset &&
    row.asset_bytes === data.asset_bytes &&
    row.asset_mime === data.asset_mime &&
    row.published_at === data.published_at
  )
}

const itemData = (item: NormalizedItem, image: ResolvedImage): ItemData => ({
  external_id: item.externalId,
  title: item.title,
  content: image.content,
  url: item.url,
  image_url: image.imageUrl,
  asset: image.asset,
  asset_bytes: image.assetBytes,
  asset_mime: image.assetMime,
  published_at: item.publishedAt.getTime(),
})

/**
 * Decide what image a feed item should serve.
 *
 * On download failure the item is stored with the raw CDN URL and no asset —
 * feeds never lose a post over image trouble — and because `asset` is then null,
 * the next refresh retries. That same property backfills items stored before
 * mirroring was possible.
 */
async function resolveImage(
  source: SourceRow,
  item: NormalizedItem,
  existing: ItemRow | undefined,
): Promise<ResolvedImage> {
  // Degraded: serve the platform URL and keep whatever we already had stored.
  const bare = (content: string): ResolvedImage => ({
    imageUrl: item.imageUrl ?? null,
    asset: existing?.asset ?? null,
    assetBytes: existing?.asset_bytes ?? null,
    assetMime: existing?.asset_mime ?? null,
    content,
    mirroredNow: false,
  })

  if (!item.imageUrl || !config.mirrorImages) return bare(item.content)

  // Already mirrored: keep the stored file (and its size/type, so the enclosure
  // metadata survives), but still swap the fresh signed CDN URL this fetch
  // embedded in the content for our own stable one.
  if (existing?.asset) {
    const url = assetUrl(existing.asset)
    return {
      imageUrl: url,
      asset: existing.asset,
      assetBytes: existing.asset_bytes,
      assetMime: existing.asset_mime,
      content: rewriteImageUrl(item.content, item.imageUrl, url),
      mirroredNow: false,
    }
  }

  try {
    const stored = await storeImage(item.imageUrl, postAssetName(source.id, item.externalId))
    return {
      imageUrl: stored.url,
      asset: stored.filename,
      assetBytes: stored.bytes,
      assetMime: stored.mime,
      content: rewriteImageUrl(item.content, item.imageUrl, stored.url),
      mirroredNow: true,
    }
  } catch (err) {
    log.warn('could not mirror image', {
      handle: `@${source.handle}`,
      post: item.externalId,
      error: describeError(err),
    })
    return bare(item.content)
  }
}

/**
 * Mirror the account's profile picture, used as the RSS channel image.
 *
 * Mirror-once: a source whose avatar is already stored is left alone, because
 * the signed CDN URL changes on every fetch so we can't cheaply tell whether the
 * picture itself changed. Returns an empty object when there is nothing to say,
 * so a failed mirror never blanks an avatar a previous success stored.
 */
async function resolveProfileImage(
  source: SourceRow,
  cdnUrl: string | undefined,
): Promise<{ profileImageUrl?: string | null; profileAsset?: string | null }> {
  if (!cdnUrl) return {}
  if (source.profile_asset) return {}
  if (!config.mirrorImages) return { profileImageUrl: cdnUrl, profileAsset: null }

  try {
    const stored = await storeImage(cdnUrl, profileAssetName(source.id, cdnUrl))
    return { profileImageUrl: stored.url, profileAsset: stored.filename }
  } catch (err) {
    log.warn('could not mirror profile image', {
      handle: `@${source.handle}`,
      error: describeError(err),
    })
    // Serve the CDN URL for now; `profile_asset` stays null so we retry.
    return { profileImageUrl: cdnUrl, profileAsset: null }
  }
}

/** Swap an image URL inside content HTML. Adapters embed URLs HTML-escaped
 * (via the same escapeHtml), so replace that form as well as the raw one. */
function rewriteImageUrl(content: string, from: string, to: string): string {
  return content.replaceAll(escapeHtml(from), escapeHtml(to)).replaceAll(from, to)
}
