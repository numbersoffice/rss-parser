import type { Payload } from 'payload'

import { getAdapter } from '@/adapters/registry'
import type { SourceAdapter } from '@/adapters/types'
import type { FeedItem, Source } from '@/payload-types'

export interface RefreshResult {
  status: 'success' | 'error'
  itemCount?: number
  error?: string
}

/**
 * Fetch the latest items for a source via its adapter and upsert them into
 * feed-items. Records the outcome on the source document so it is visible
 * in the admin dashboard. Never throws — on failure the cached items remain.
 */
export async function refreshSource(payload: Payload, sourceId: string | number): Promise<RefreshResult> {
  const source = (await payload.findByID({ collection: 'sources', id: sourceId })) as Source

  let result: RefreshResult
  try {
    const adapter = getAdapter(source.type)
    const items = await adapter.fetchItems(source)

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

    await pruneUnrefreshableItems(payload, source, adapter, items.map((item) => item.externalId))

    result = { status: 'success', itemCount: items.length }
  } catch (err) {
    result = { status: 'error', error: err instanceof Error ? err.message : String(err) }
    payload.logger.warn(`Refresh failed for source "${source.name}": ${result.error}`)
  }

  await payload.update({
    collection: 'sources',
    id: source.id,
    data: {
      lastFetchedAt: new Date().toISOString(),
      lastFetchStatus: result.status,
      lastFetchError: result.error ?? null,
    },
    depth: 0,
    context: { skipSourceRefresh: true },
  })

  return result
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
