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
import {
  type GalleryAsset,
  galleryAssetNames,
  parseGallery,
  postAssetName,
  profileAssetName,
  storeImage,
  unlinkAssets,
} from './assets.js'
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

  // The first successful fetch seeds a whole feed at once — that's a backfill,
  // not a day's posting, and counting it would put a spike at the start of every
  // feed's history. Everything created after it is genuinely new: the reconcile
  // never inserts a fetched post that falls outside the cap, so an old pinned
  // post the platform keeps re-serving can't register as phantom activity
  // either.
  //
  // A feed that was broken for a week and then recovers does attribute its
  // catch-up posts to the recovery day. That's rare, it washes out as the window
  // rolls, and suppressing it would cost more than it's worth.
  const newPosts = source.first_success_at === null ? 0 : creates.length

  const outcome: SourceOutcome = {
    status: 'success',
    error: null,
    httpStatus,
    durationMs,
    newPosts,
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
  // A pruned item takes its cover and every gallery child with it.
  const doomed = plan.deletes.flatMap((row) => [
    ...(row.asset !== null ? [row.asset] : []),
    ...galleryAssetNames(row.gallery),
  ])
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
      newPosts: 0,
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
  /** Extra gallery images (second onward); empty for a single-image post. */
  gallery: GalleryAsset[]
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
    row.gallery === data.gallery &&
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
  // Reused children keep their original serialization (same key order,
  // untouched imageUrl), so a quiet gallery re-serializes byte-identically and
  // isUnchanged holds — no needless write, no reader ETag churn.
  gallery: image.gallery.length > 0 ? JSON.stringify(image.gallery) : null,
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
  // Every image in the post, cover first. A normal post has one; a carousel has
  // its children (already capped in the adapter).
  const images =
    item.images && item.images.length > 0 ? item.images : item.imageUrl ? [item.imageUrl] : []

  // Nothing to mirror: serve the platform URLs and keep whatever we had stored.
  if (images.length === 0 || !config.mirrorImages) {
    return {
      imageUrl: item.imageUrl ?? null,
      asset: existing?.asset ?? null,
      assetBytes: existing?.asset_bytes ?? null,
      assetMime: existing?.asset_mime ?? null,
      gallery: parseGallery(existing?.gallery),
      content: item.content,
      mirroredNow: false,
    }
  }

  // The signed CDN URLs the content embeds, swapped for our stable /assets URLs
  // as each image resolves. A child that fails to mirror keeps its CDN URL, and
  // because it leaves no gallery record the next refresh retries it.
  const replacements: [from: string, to: string][] = []
  let mirroredNow = false

  const warn = (err: unknown): void =>
    log.warn('could not mirror image', {
      handle: `@${source.handle}`,
      post: item.externalId,
      error: describeError(err),
    })

  // --- cover (index 0): lives in the item's own asset columns ---------------
  const coverUrl = images[0]!
  let coverAsset: string | null = null
  let coverBytes: number | null = null
  let coverMime: string | null = null
  if (existing?.asset) {
    // Mirror-once: keep the stored file and its size/type, just re-point content.
    coverAsset = existing.asset
    coverBytes = existing.asset_bytes
    coverMime = existing.asset_mime
    replacements.push([coverUrl, assetUrl(existing.asset)])
  } else {
    try {
      const stored = await storeImage(coverUrl, postAssetName(source.id, item.externalId))
      coverAsset = stored.filename
      coverBytes = stored.bytes
      coverMime = stored.mime
      replacements.push([coverUrl, stored.url])
      mirroredNow = true
    } catch (err) {
      warn(err) // leave the CDN URL in place; asset stays null so we retry
    }
  }

  // --- children (index ≥ 1): mirror-once, keyed by their deterministic name --
  // Index prior children by base name (extension stripped) so a stored child is
  // reused regardless of order or a gap an earlier failure left behind.
  const priorByBase = new Map<string, GalleryAsset>()
  for (const rec of parseGallery(existing?.gallery)) priorByBase.set(stripExtension(rec.asset), rec)

  const gallery: GalleryAsset[] = []
  for (let i = 1; i < images.length; i++) {
    const url = images[i]!
    const base = postAssetName(source.id, item.externalId, i)
    const prior = priorByBase.get(base)
    if (prior) {
      gallery.push(prior)
      replacements.push([url, assetUrl(prior.asset)])
      continue
    }
    try {
      const stored = await storeImage(url, base)
      gallery.push({ asset: stored.filename, bytes: stored.bytes, mime: stored.mime, imageUrl: url })
      replacements.push([url, stored.url])
      mirroredNow = true
    } catch (err) {
      warn(err) // leave this child's CDN URL; no record, so it retries next time
    }
  }

  return {
    imageUrl: coverAsset ? assetUrl(coverAsset) : (item.imageUrl ?? null),
    asset: coverAsset,
    assetBytes: coverBytes,
    assetMime: coverMime,
    gallery,
    content: applyReplacements(item.content, replacements),
    mirroredNow,
  }
}

/** Drop a filename's extension, e.g. `3-abc-1.webp` → `3-abc-1`. */
const stripExtension = (name: string): string => name.replace(/\.[^./]+$/, '')

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

/** Apply a batch of image-URL swaps to content HTML, in order. Adapters embed
 * URLs HTML-escaped (via the same escapeHtml), so each swap replaces that form
 * as well as the raw one. */
function applyReplacements(content: string, replacements: [from: string, to: string][]): string {
  let out = content
  for (const [from, to] of replacements) {
    out = out.replaceAll(escapeHtml(from), escapeHtml(to)).replaceAll(from, to)
  }
  return out
}
