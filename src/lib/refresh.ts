import type { Payload } from 'payload'

import { getAdapter } from '@/adapters/registry'
import type { Source } from '@/payload-types'

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

/** Refresh only if the cached items are older than the source's TTL. */
export async function refreshSourceIfStale(payload: Payload, source: Source): Promise<void> {
  const ttlMs = (source.refreshIntervalMinutes ?? 60) * 60_000
  const lastFetched = source.lastFetchedAt ? new Date(source.lastFetchedAt).getTime() : 0
  if (Date.now() - lastFetched > ttlMs) {
    await refreshSource(payload, source.id)
  }
}
