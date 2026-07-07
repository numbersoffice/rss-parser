import { after } from 'next/server'
import { APIError, type Payload, type PayloadRequest } from 'payload'

import { getAdapter } from '@/adapters/registry'
import type { NormalizedFeed } from '@/adapters/types'
import { getMaxFetchAttempts } from '@/lib/limits'
import { describeError, recordFetchOutcome, resolveProfileImage, storeItems } from '@/lib/refresh'
import { s3Enabled } from '@/lib/s3'
import type { Source } from '@/payload-types'

export const normalizeHandle = (handle: string): string =>
  handle.trim().replace(/^@/, '').toLowerCase()

export const defaultSourceName = (type: string, handle: string): string =>
  `@${normalizeHandle(handle)} (${type})`

/**
 * Sources are canonical: one per (type, handle), shared by all subscribers so
 * each account is only fetched once. Subscribing finds the existing source or,
 * for a brand-new account, creates it.
 *
 * Before a new source is created the account is fetched once to confirm it
 * exists — a mistyped/nonexistent handle (404), a private profile, or a
 * rate-limit throws an APIError here (surfaced as an error toast in the admin)
 * and *nothing* is written, so we never persist a source whose every fetch
 * would fail. The items fetched during that check seed the new source, so a
 * successful subscribe still makes only a single request. Reusing an existing
 * shared source is fast and skips the check — it was already validated by
 * whoever created it.
 */
export async function findOrCreateVerifiedSource(
  payload: Payload,
  type: Source['type'],
  handle: string,
  req?: PayloadRequest,
): Promise<Source> {
  const normalized = normalizeHandle(handle)
  const find = async () =>
    (
      await payload.find({
        collection: 'sources',
        where: { and: [{ type: { equals: type } }, { handle: { equals: normalized } }] },
        limit: 1,
        depth: 0,
        req,
      })
    ).docs[0]

  const existing = await find()
  if (existing) return existing

  // Verify the account is reachable *before* writing anything. Reuse the items
  // this returns to seed the source below, so there's no second request.
  const debug: Record<string, unknown> = {}
  let feed: NormalizedFeed
  try {
    // The adapter only reads handle/type off the source; it isn't persisted.
    // Retry on a fresh proxy IP so a first-time verify isn't blocked by a bad IP.
    const maxAttempts = await getMaxFetchAttempts(payload)
    feed = await getAdapter(type).fetchItems({ type, handle: normalized } as Source, debug, maxAttempts)
  } catch (err) {
    throw new APIError(describeError(err), 400)
  }
  const items = feed.items

  let source: Source
  try {
    source = await payload.create({
      collection: 'sources',
      data: { type, handle: normalized, name: defaultSourceName(type, normalized) },
      depth: 0,
      // We seed the items ourselves below; don't let hooks trigger a refetch.
      context: { skipSourceRefresh: true },
      req,
    })
  } catch (err) {
    // Unique index on (type, handle): lost a creation race — reuse the winner
    // (already validated by whoever won).
    const winner = await find()
    if (winner) return winner
    throw err
  }

  // Seed the items fast — skip the (slow) per-image download+upload so the
  // subscribe request returns promptly. When S3 is on, a background job mirrors
  // the images out of band; the items serve their CDN URLs until then.
  await storeItems(payload, source, items, { mirrorImages: false })
  // Seed the raw CDN profile URL (mirror: false — no download here); the
  // mirrorSourceImages job swaps it for a bucket URL out of band, like it does
  // for the item images.
  const profileFields = await resolveProfileImage(payload, source, feed.profile?.imageUrl, false)
  await recordFetchOutcome(
    payload,
    source.id,
    { status: 'success', itemCount: items.length, debug },
    profileFields,
  )

  if (s3Enabled()) {
    // Durable enqueue, then kick the queue right after the response flushes so
    // mirroring happens within moments without blocking the save. If `after()`
    // isn't usable here the job still persists and drains on the next feed read.
    await payload.jobs.queue({ task: 'mirrorSourceImages', input: { sourceId: source.id } })
    try {
      after(async () => {
        await payload.jobs.run({ limit: 5 }).catch(() => {})
      })
    } catch {
      // Not in a request context that supports after() — leave it for the drain.
    }
  }

  return source
}

/** Garbage-collect a source (and, via its hooks, its cached items) once the
 * last subscription is gone. */
export async function deleteSourceIfOrphaned(
  payload: Payload,
  sourceId: number | string,
  req?: PayloadRequest,
): Promise<void> {
  const { totalDocs } = await payload.count({
    collection: 'subscriptions',
    where: { source: { equals: sourceId } },
    req,
  })
  if (totalDocs === 0) {
    await payload.delete({ collection: 'sources', id: sourceId, req })
  }
}
