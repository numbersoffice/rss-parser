import type { Payload } from 'payload'

import { getAdapter } from '@/adapters/registry'
import type { NormalizedItem, SourceAdapter } from '@/adapters/types'
import type { FeedItem, Source } from '@/payload-types'

export interface RefreshResult {
  status: 'success' | 'error'
  itemCount?: number
  error?: string
  debug?: Record<string, unknown>
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
  try {
    const items = await getAdapter(source.type).fetchItems(source, debug)
    await storeItems(payload, source, items)
    result = { status: 'success', itemCount: items.length, debug }
  } catch (err) {
    result = { status: 'error', error: describeError(err), debug }
    payload.logger.warn(`Refresh failed for source "${source.name}": ${result.error}`)
  }

  await recordFetchOutcome(payload, source.id, result)
  return result
}

/**
 * Upsert already-fetched items into feed-items and prune ones whose images
 * have permanently expired. Split out of {@link refreshSource} so the initial
 * fetch that happens while a source is being created (findOrCreateVerifiedSource)
 * can reuse the items it fetched to validate the account, without a second
 * request.
 */
export async function storeItems(
  payload: Payload,
  source: Source,
  items: NormalizedItem[],
): Promise<void> {
  for (const item of items) {
    const existing = await payload.find({
      collection: 'feed-items',
      where: {
        and: [{ source: { equals: source.id } }, { externalId: { equals: item.externalId } }],
      },
      limit: 1,
      depth: 0,
    })

    const data = {
      source: source.id,
      externalId: item.externalId,
      title: item.title,
      content: item.content,
      url: item.url,
      imageUrl: item.imageUrl,
      publishedAt: item.publishedAt.toISOString(),
    }

    if (existing.docs.length > 0) {
      await payload.update({ collection: 'feed-items', id: existing.docs[0].id, data, depth: 0 })
    } else {
      await payload.create({ collection: 'feed-items', data, depth: 0 })
    }
  }

  await pruneUnrefreshableItems(
    payload,
    source,
    getAdapter(source.type),
    items.map((item) => item.externalId),
  )
}

/** Record the outcome of a fetch on the source document so it is visible in the
 * admin dashboard (and so the source counts as fetched). */
export async function recordFetchOutcome(
  payload: Payload,
  sourceId: string | number,
  result: RefreshResult,
): Promise<void> {
  await payload.update({
    collection: 'sources',
    id: sourceId,
    data: {
      lastFetchedAt: new Date().toISOString(),
      lastFetchStatus: result.status,
      lastFetchError: result.error ?? null,
      lastFetchDebug: result.debug ?? {},
    },
    depth: 0,
    context: { skipSourceRefresh: true },
  })
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

/** Serve-time headroom: the feed response is cached for 5 minutes and readers
 * fetch images some time after the feed, so treat images expiring within the
 * next 15 minutes as already expired. */
const IMAGE_EXPIRY_BUFFER_MS = 15 * 60_000

/** If a refresh fails, expired items stay cached and would trigger a refresh
 * on every feed request. Cap expiry-triggered refreshes to once per this
 * interval. */
const MIN_EXPIRY_REFRESH_INTERVAL_MS = 10 * 60_000

/**
 * Delete cached items whose signed image URL has expired and whose post no
 * longer appears in the platform's response — the platform will never hand
 * out a fresh URL for them, so the image is permanently dead.
 */
async function pruneUnrefreshableItems(
  payload: Payload,
  source: Source,
  adapter: SourceAdapter,
  fetchedExternalIds: string[],
): Promise<void> {
  if (!adapter.imageUrlExpiresAt) return

  const cached = await payload.find({
    collection: 'feed-items',
    where: { source: { equals: source.id } },
    pagination: false,
    depth: 0,
  })

  const stillRefreshable = new Set(fetchedExternalIds)
  const cutoff = Date.now() + IMAGE_EXPIRY_BUFFER_MS
  for (const item of cached.docs) {
    if (stillRefreshable.has(item.externalId) || !item.imageUrl) continue
    const expiry = adapter.imageUrlExpiresAt(item.imageUrl)
    if (expiry === null || expiry.getTime() >= cutoff) continue

    await payload.delete({ collection: 'feed-items', id: item.id, depth: 0 })
    payload.logger.info(
      `Pruned feed item "${item.title}" from source "${source.name}" — image URL expired and post no longer refreshable`,
    )
  }
}

/**
 * Refresh if the cached items are older than the source's TTL, or if any
 * cached item's signed image URL has expired (Instagram media URLs only
 * live a few days, shorter than a feed item's lifetime). Returns true if a
 * refresh ran so the caller can re-read source and items.
 */
export async function refreshSourceIfNeeded(
  payload: Payload,
  source: Source,
  items: FeedItem[],
): Promise<boolean> {
  const ttlMs = (source.refreshIntervalMinutes ?? 60) * 60_000
  const sinceLastFetch = Date.now() - (source.lastFetchedAt ? new Date(source.lastFetchedAt).getTime() : 0)

  const stale = sinceLastFetch > ttlMs
  const expiredImages =
    sinceLastFetch > MIN_EXPIRY_REFRESH_INTERVAL_MS && hasExpiredImage(source.type, items)
  if (!stale && !expiredImages) {
    return false
  }

  await refreshSource(payload, source.id)
  return true
}

function hasExpiredImage(sourceType: string, items: FeedItem[]): boolean {
  let expiresAt: (imageUrl: string) => Date | null
  try {
    const adapter = getAdapter(sourceType)
    if (!adapter.imageUrlExpiresAt) return false
    expiresAt = adapter.imageUrlExpiresAt.bind(adapter)
  } catch {
    return false
  }

  const cutoff = Date.now() + IMAGE_EXPIRY_BUFFER_MS
  return items.some((item) => {
    if (!item.imageUrl) return false
    const expiry = expiresAt(item.imageUrl)
    return expiry !== null && expiry.getTime() < cutoff
  })
}
