import type { Payload, PayloadRequest } from 'payload'

import { getAdapter } from '@/adapters/registry'
import type { AttemptRecord, NormalizedItem } from '@/adapters/types'
import { escapeHtml } from '@/lib/html'
import { getMaxFetchAttempts, getMaxItemsPerFeed } from '@/lib/limits'
import { outboundFetch } from '@/lib/proxy'
import { relationId } from '@/lib/relations'
import { isPublicS3Url, publicS3Url, s3Enabled } from '@/lib/s3'
import type { FeedItem, Source } from '@/payload-types'

export interface RefreshResult {
  status: 'success' | 'error'
  itemCount?: number
  changes?: ItemChanges
  error?: string
  debug?: Record<string, unknown>
}

/** What a reconciliation ({@link storeItems}) did to the stored feed-items. */
export interface ItemChanges {
  created: number
  updated: number
  deleted: number
}

/**
 * Fetch the latest items for a source via its adapter and upsert them into
 * feed-items. Records the outcome on the source document so it is visible
 * in the admin dashboard. Never throws — on failure the cached items remain.
 */
export async function refreshSource(payload: Payload, sourceId: string | number): Promise<RefreshResult> {
  const source = (await payload.findByID({ collection: 'sources', id: sourceId })) as Source

  // Collected by the adapter as it runs (proxy, response status, timing,
  // throttling headers) and stored even when the fetch throws, so proxy and
  // blocking issues can be diagnosed from the admin dashboard.
  const debug: Record<string, unknown> = {}

  let result: RefreshResult
  let profileFields: ProfileImageFields = {}
  try {
    // Each failed attempt retries on a fresh proxy IP (see the Instagram
    // adapter); the admin-configured cap bounds how many times.
    const maxAttempts = await getMaxFetchAttempts(payload)
    const { items, profile } = await getAdapter(source.type).fetchItems(source, debug, maxAttempts)
    const changes = await storeItems(payload, source, items)
    // Mirror the account's profile picture into our bucket (see resolveProfileImage).
    profileFields = await resolveProfileImage(payload, source, profile?.imageUrl, true)
    result = { status: 'success', itemCount: items.length, changes, debug }
  } catch (err) {
    result = { status: 'error', error: describeError(err), debug }
    payload.logger.warn(`Refresh failed for source "${source.name}": ${result.error}`)
  }

  await recordFetchOutcome(payload, source.id, result, profileFields)
  return result
}

/**
 * Reconcile a source's stored feed-items with a fetch's results, mirroring each
 * stored item's image into our own bucket so feeds serve stable public URLs
 * (see resolveImage). Split out of {@link refreshSource} so the initial fetch
 * that happens while a source is being created (findOrCreateVerifiedSource)
 * can reuse the items it fetched to validate the account, without a second
 * request.
 *
 * Invariant: after this runs, the DB holds exactly the newest ≤N items (the
 * per-feed cap) of union(fetched, existing) by publishedAt. The target set is
 * computed in memory first and only the diff is written, so fetched items that
 * don't make the cut — e.g. an old pinned post the platform keeps serving —
 * are never inserted at all: no delete/re-create churn, no phantom activity,
 * no wasted image mirroring. The only creates are genuinely new items, and
 * each one counts as the source's daily activity via FeedItems' afterChange
 * hook; `skipActivity` suppresses that (the subscribe-time backfill seeds a
 * whole feed at once, which isn't activity).
 *
 * All row writes happen in one transaction, so a client fetching the feed
 * mid-reconciliation sees either the old or the new item set — never an
 * in-between state such as an item (and its image URL) that is pruned moments
 * later. Image mirroring does network I/O, so item data is prepared before
 * the transaction opens and the write lock is only held for the row writes
 * themselves. Deleting a feed item cascades to its mirrored S3 image via
 * FeedItems.afterDelete.
 *
 * Returns what the reconciliation did, so callers can report it (e.g. the
 * admin's manual-refresh toast shows how many items were new and pruned).
 */
export async function storeItems(
  payload: Payload,
  source: Source,
  items: NormalizedItem[],
  opts: { mirrorImages?: boolean; skipActivity?: boolean } = {},
): Promise<ItemChanges> {
  const { mirrorImages = true, skipActivity = false } = opts

  const limit = await getMaxItemsPerFeed(payload)
  const existing = await payload.find({
    collection: 'feed-items',
    where: { source: { equals: source.id } },
    pagination: false,
    depth: 0,
  })

  // Union of fetched and existing, keyed by externalId. An entry can carry the
  // stored doc, the fetched item, or both.
  const union = new Map<string, { publishedAt: number; fetched?: NormalizedItem; doc?: FeedItem }>()
  for (const doc of existing.docs) {
    union.set(doc.externalId, { publishedAt: new Date(doc.publishedAt).getTime(), doc })
  }
  for (const item of items) {
    union.set(item.externalId, {
      publishedAt: item.publishedAt.getTime(),
      fetched: item,
      doc: union.get(item.externalId)?.doc,
    })
  }

  const target = [...union.values()]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, limit)
  const targetExternalIds = new Set(
    target.map((entry) => entry.fetched?.externalId ?? entry.doc!.externalId),
  )

  // Prepare all document data up front: buildItemData mirrors images (network
  // I/O), which must not run while the transaction below holds the write lock.
  // Updates refresh stored items the fetch returned again (content edits, and
  // the signed-CDN→bucket URL rewrite in resolveImage); stored items the fetch
  // didn't return are left untouched.
  const updates: { id: number; data: FeedItemData }[] = []
  for (const entry of target) {
    if (entry.fetched && entry.doc) {
      updates.push({
        id: entry.doc.id,
        data: await buildItemData(payload, source, entry.fetched, entry.doc, mirrorImages),
      })
    }
  }
  const deletes = existing.docs.filter((doc) => !targetExternalIds.has(doc.externalId))
  const creates: FeedItemData[] = []
  for (const entry of target.filter((e) => e.fetched && !e.doc).sort((a, b) => a.publishedAt - b.publishedAt)) {
    creates.push(await buildItemData(payload, source, entry.fetched!, undefined, mirrorImages))
  }
  const changes: ItemChanges = {
    created: creates.length,
    updated: updates.length,
    deleted: deletes.length,
  }
  if (updates.length === 0 && deletes.length === 0 && creates.length === 0) return changes

  // Commit the whole diff atomically. Hooks receive `req`, so the afterDelete
  // media cascade and the afterChange activity count join the transaction and
  // roll back with it. `beginTransaction` returns null when the adapter has
  // transactions disabled — then this degrades to sequential writes.
  const transactionID = (await payload.db.beginTransaction()) ?? undefined
  const req = (transactionID !== undefined ? { transactionID } : undefined) as
    | PayloadRequest
    | undefined
  try {
    for (const update of updates) {
      await payload.update({ collection: 'feed-items', id: update.id, data: update.data, depth: 0, req })
    }
    for (const doomed of deletes) {
      await payload.delete({ collection: 'feed-items', id: doomed.id, depth: 0, req })
    }
    for (const data of creates) {
      await payload.create({
        collection: 'feed-items',
        data,
        depth: 0,
        // FeedItems.afterChange counts each created item as daily activity
        // unless told not to.
        context: { skipActivity },
        req,
      })
    }
    if (transactionID !== undefined) await payload.db.commitTransaction(transactionID)
  } catch (err) {
    if (transactionID !== undefined) await payload.db.rollbackTransaction(transactionID)
    throw err
  }
  return changes
}

type FeedItemData = Awaited<ReturnType<typeof buildItemData>>

/** The feed-item document fields for a fetched item, with its image resolved
 * (see resolveImage). Shared by the update and create branches of storeItems. */
async function buildItemData(
  payload: Payload,
  source: Source,
  item: NormalizedItem,
  existing: FeedItem | undefined,
  mirrorImages: boolean,
) {
  const image = await resolveImage(payload, source, item, existing, mirrorImages)
  return {
    source: source.id,
    externalId: item.externalId,
    title: item.title,
    content: image.content,
    url: item.url,
    imageUrl: image.imageUrl,
    image: image.image,
    publishedAt: item.publishedAt.toISOString(),
  }
}

interface ResolvedImage {
  imageUrl: string | null
  image: number | null
  content: string
}

/**
 * Decide what image a feed item should serve. Platform image URLs (Instagram
 * CDN) are signed, expire after a few days, and are origin-restricted so not
 * every feed reader can load them — so the first time we see a post we
 * download its image once (a dozen posts × ~200 KB, negligible even on the
 * metered proxy) and store it in our public bucket, then serve that stable
 * URL in `imageUrl` and inside the content HTML.
 *
 * On download/upload failure the item is stored with the raw CDN URL and no
 * stored image — feeds never lose a post over image trouble — and because
 * the stored URL is then not a bucket URL, the next refresh retries. That
 * same property backfills items that predate image mirroring.
 */
async function resolveImage(
  payload: Payload,
  source: Source,
  item: NormalizedItem,
  existing: FeedItem | undefined,
  mirrorImages: boolean,
): Promise<ResolvedImage> {
  const existingImageId = relationId(existing?.image)
  const existingImage = typeof existingImageId === 'number' ? existingImageId : null
  // No image, S3 off, or the caller deferred mirroring (e.g. subscribe seeds
  // items fast and a background job mirrors them) — store the raw CDN URL. The
  // stored URL is then not a bucket URL, so the next refresh (or the job) still
  // mirrors it.
  if (!item.imageUrl || !s3Enabled() || !mirrorImages) {
    return { imageUrl: item.imageUrl ?? null, image: existingImage, content: item.content }
  }

  // Already mirrored: keep the stored copy, but still swap the fresh signed
  // CDN URL the adapter embedded in this fetch's content for the bucket URL.
  if (existingImage && existing?.imageUrl && isPublicS3Url(existing.imageUrl)) {
    return {
      imageUrl: existing.imageUrl,
      image: existingImage,
      content: rewriteImageUrl(item.content, item.imageUrl, existing.imageUrl),
    }
  }

  try {
    return await mirrorImageUrl(payload, source, {
      imageUrl: item.imageUrl,
      externalId: item.externalId,
      content: item.content,
    })
  } catch (err) {
    payload.logger.warn(
      `Could not mirror image for "${item.title}" (source "${source.name}"): ${describeError(err)}`,
    )
    return { imageUrl: item.imageUrl, image: existingImage, content: item.content }
  }
}

/**
 * Download an image from a URL and store it in our public bucket, returning the
 * stable bucket URL and the created media doc's id. Throws on download/upload
 * failure so callers can decide how to degrade. The lower-level primitive shared
 * by post-image mirroring ({@link mirrorImageUrl}) and profile-image mirroring
 * ({@link resolveProfileImage}).
 */
export async function storeImageFromUrl(
  payload: Payload,
  url: string,
  name: string,
): Promise<{ imageUrl: string; image: number }> {
  const res = await outboundFetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) {
    throw new Error(`image request returned ${res.status}`)
  }
  const bytes = Buffer.from(await res.arrayBuffer())
  const mimetype = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg'
  const media = await payload.create({
    collection: 'media',
    data: {},
    file: { data: bytes, mimetype, name, size: bytes.byteLength },
    depth: 0,
  })
  // Read the URL off the created doc, not the requested name — Payload
  // suffixes filename collisions.
  const imageUrl = media.url ?? publicS3Url(media.filename ?? '')
  return { imageUrl, image: media.id }
}

/**
 * Download a platform image, store it in our public bucket, and return the
 * bucket URL plus the content HTML rewritten to point at it. Throws on
 * download/upload failure so callers can decide how to degrade. Shared by the
 * live refresh path ({@link resolveImage}) and the background mirror job, which
 * mirrors items that were seeded fast (without images) during subscribe.
 */
export async function mirrorImageUrl(
  payload: Payload,
  source: Source,
  item: { imageUrl: string; externalId: string; content: string },
): Promise<{ imageUrl: string; image: number; content: string }> {
  const stored = await storeImageFromUrl(payload, item.imageUrl, `${source.id}-${item.externalId}.jpg`)
  return {
    imageUrl: stored.imageUrl,
    image: stored.image,
    content: rewriteImageUrl(item.content, item.imageUrl, stored.imageUrl),
  }
}

/** Source fields set by {@link resolveProfileImage}. */
export interface ProfileImageFields {
  profileImageUrl?: string
  profileImage?: number
}

/**
 * Decide what profile image a source should serve as its RSS channel image.
 * Like {@link resolveImage} does for posts: Instagram's profile-pic CDN URL is
 * signed and origin-restricted, so we mirror it into our bucket once and serve
 * that stable URL thereafter.
 *
 * Mirror-once: a source whose profile image is already stored in the bucket is
 * left untouched — the signed CDN URL changes every fetch, so we can't cheaply
 * tell whether the avatar itself changed. On download/upload failure (or with
 * `mirror` false, e.g. subscribe seeds fast and a background job mirrors later)
 * we store the raw CDN URL and no media; because that stored URL is then not a
 * bucket URL, the next mirror attempt retries.
 */
export async function resolveProfileImage(
  payload: Payload,
  source: Source,
  profileCdnUrl: string | undefined,
  mirror: boolean,
): Promise<ProfileImageFields> {
  if (!profileCdnUrl) return {}

  // Already mirrored: keep the stored copy (see mirror-once note above).
  const existingImage = relationId(source.profileImage)
  if (existingImage && source.profileImageUrl && isPublicS3Url(source.profileImageUrl)) {
    return {}
  }

  // S3 off, or the caller deferred mirroring — store the raw CDN URL for now.
  if (!s3Enabled() || !mirror) {
    return { profileImageUrl: profileCdnUrl }
  }

  try {
    const stored = await storeImageFromUrl(payload, profileCdnUrl, `${source.id}-profile.jpg`)
    return { profileImageUrl: stored.imageUrl, profileImage: stored.image }
  } catch (err) {
    payload.logger.warn(
      `Could not mirror profile image for source "${source.name}": ${describeError(err)}`,
    )
    return { profileImageUrl: profileCdnUrl }
  }
}

/** Swap an image URL inside content HTML. Adapters embed URLs HTML-escaped
 * (via the same escapeHtml), so replace that form as well as the raw one. */
function rewriteImageUrl(content: string, from: string, to: string): string {
  return content.replaceAll(escapeHtml(from), escapeHtml(to)).replaceAll(from, to)
}

/** Record the outcome of a fetch on the source document so it is visible in the
 * admin dashboard (and so the source counts as fetched). */
export async function recordFetchOutcome(
  payload: Payload,
  sourceId: string | number,
  result: RefreshResult,
  extraFields: ProfileImageFields = {},
): Promise<void> {
  await payload.update({
    collection: 'sources',
    id: sourceId,
    data: {
      lastFetchedAt: new Date().toISOString(),
      lastFetchStatus: result.status,
      lastFetchError: result.error ?? null,
      lastFetchDebug: result.debug ?? {},
      ...extraFields,
    },
    depth: 0,
    context: { skipSourceRefresh: true },
  })

  // Append request-log rows for the trend chart / per-source health bar. This
  // is history (the source fields above only hold the latest outcome), pruned
  // after a week. When the adapter retried, it reports one record per attempt
  // (debug.attempts) and we log each as its own request so retries count toward
  // the health trend like any other; otherwise we fall back to a single row
  // from the final outcome. Every row from this one refresh shares a `fetchId`
  // so the health readout can group the retries back into a single session.
  // Never let logging break a fetch — refreshSource is contracted not to throw.
  try {
    const source = typeof sourceId === 'string' ? Number(sourceId) : sourceId
    const fetchId = crypto.randomUUID()
    const debug = (result.debug ?? {}) as Record<string, unknown>
    const attempts = Array.isArray(debug.attempts) ? (debug.attempts as AttemptRecord[]) : []
    const rows =
      attempts.length > 0
        ? attempts.map((a) => ({
            source,
            fetchId,
            status: a.status,
            error: a.error ?? null,
            httpStatus: typeof a.httpStatus === 'number' ? a.httpStatus : null,
            durationMs: typeof a.durationMs === 'number' ? a.durationMs : null,
          }))
        : [
            {
              source,
              fetchId,
              status: result.status,
              error: result.error ?? null,
              httpStatus: typeof debug.httpStatus === 'number' ? debug.httpStatus : null,
              durationMs: typeof debug.durationMs === 'number' ? debug.durationMs : null,
            },
          ]
    for (const data of rows) {
      await payload.create({ collection: 'request-logs', data, depth: 0 })
    }
  } catch (err) {
    payload.logger.warn(`Could not write request log for source ${sourceId}: ${describeError(err)}`)
  }
}

/**
 * Node's `fetch` reports connection-level failures — including proxy errors —
 * as a bare "fetch failed", stashing the real reason on `err.cause` (and
 * sometimes nested further). Flatten the chain so the source's lastFetchError
 * shows the actionable detail: a proxy 407, ECONNREFUSED, a TLS error, etc.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = err
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    const code = (current as { code?: string }).code
    parts.push(code ? `${current.message} (${code})` : current.message)
    current = (current as { cause?: unknown }).cause
  }
  // Drop consecutive duplicates (the top message often repeats its cause).
  return parts.filter((part, i) => part !== parts[i - 1]).join(' — ')
}

/**
 * Refresh if the last fetch is older than the source's TTL. Returns true if
 * a refresh ran so the caller can re-read source and items.
 */
export async function refreshSourceIfNeeded(payload: Payload, source: Source): Promise<boolean> {
  const ttlMs = (source.refreshIntervalMinutes ?? 60) * 60_000
  const sinceLastFetch = Date.now() - (source.lastFetchedAt ? new Date(source.lastFetchedAt).getTime() : 0)
  if (sinceLastFetch <= ttlMs) {
    return false
  }

  await refreshSource(payload, source.id)
  return true
}
