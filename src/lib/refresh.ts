import type { Payload } from 'payload'

import { getAdapter } from '@/adapters/registry'
import type { NormalizedItem } from '@/adapters/types'
import { escapeHtml } from '@/lib/html'
import { outboundFetch } from '@/lib/proxy'
import { relationId } from '@/lib/relations'
import { isPublicS3Url, publicS3Url, s3Enabled } from '@/lib/s3'
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
 * Upsert already-fetched items into feed-items, mirroring each item's image
 * into our own bucket so feeds serve stable public URLs (see resolveImage).
 * Split out of {@link refreshSource} so the initial fetch that happens while
 * a source is being created (findOrCreateVerifiedSource) can reuse the items
 * it fetched to validate the account, without a second request.
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

    const image = await resolveImage(payload, source, item, existing.docs[0])
    const data = {
      source: source.id,
      externalId: item.externalId,
      title: item.title,
      content: image.content,
      url: item.url,
      imageUrl: image.imageUrl,
      image: image.image,
      publishedAt: item.publishedAt.toISOString(),
    }

    if (existing.docs.length > 0) {
      await payload.update({ collection: 'feed-items', id: existing.docs[0].id, data, depth: 0 })
    } else {
      await payload.create({ collection: 'feed-items', data, depth: 0 })
    }
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
): Promise<ResolvedImage> {
  const existingImageId = relationId(existing?.image)
  const existingImage = typeof existingImageId === 'number' ? existingImageId : null
  if (!item.imageUrl || !s3Enabled()) {
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
    const res = await outboundFetch(item.imageUrl, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) {
      throw new Error(`image request returned ${res.status}`)
    }
    const bytes = Buffer.from(await res.arrayBuffer())
    const mimetype = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg'
    const media = await payload.create({
      collection: 'media',
      data: {},
      file: {
        data: bytes,
        mimetype,
        name: `${source.id}-${item.externalId}.jpg`,
        size: bytes.byteLength,
      },
      depth: 0,
    })
    // Read the URL off the created doc, not the requested name — Payload
    // suffixes filename collisions.
    const publicUrl = media.url ?? publicS3Url(media.filename ?? '')
    return {
      imageUrl: publicUrl,
      image: media.id,
      content: rewriteImageUrl(item.content, item.imageUrl, publicUrl),
    }
  } catch (err) {
    payload.logger.warn(
      `Could not mirror image for "${item.title}" (source "${source.name}"): ${describeError(err)}`,
    )
    return { imageUrl: item.imageUrl, image: existingImage, content: item.content }
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
