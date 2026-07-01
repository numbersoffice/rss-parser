import config from '@payload-config'
import { getPayload } from 'payload'

import { refreshSourceIfStale } from '@/lib/refresh'
import { buildRssXml } from '@/lib/rss'
import { relationId } from '@/lib/sources'
import type { Source } from '@/payload-types'

const MAX_ITEMS = 50

/**
 * GET /feeds/{token} — the RSS feed for one subscription. The token is the
 * subscription's private, unguessable id: deleting the subscription breaks
 * the URL. The underlying source is shared, so it refreshes at most once per
 * TTL no matter how many subscribers poll; on fetch failure the previously
 * cached items keep serving.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const payload = await getPayload({ config })

  const subscriptions = await payload.find({
    collection: 'subscriptions',
    where: { token: { equals: token } },
    limit: 1,
    depth: 0,
  })
  const subscription = subscriptions.docs[0]
  const sourceId = subscription ? relationId(subscription.source) : undefined
  if (!sourceId) {
    return new Response('Feed not found', { status: 404 })
  }

  let source = (await payload
    .findByID({ collection: 'sources', id: sourceId, depth: 0 })
    .catch(() => null)) as Source | null
  if (!source || source.enabled === false) {
    return new Response('Feed not found', { status: 404 })
  }

  await refreshSourceIfStale(payload, source)
  // Re-read so freshly fetched items and status are reflected.
  source = (await payload.findByID({ collection: 'sources', id: source.id, depth: 0 })) as Source

  const items = await payload.find({
    collection: 'feed-items',
    where: { source: { equals: source.id } },
    sort: '-publishedAt',
    limit: MAX_ITEMS,
    depth: 0,
  })

  const feedUrl = new URL(`/feeds/${token}`, request.url).toString()
  const xml = buildRssXml(source, items.docs, feedUrl)

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  })
}
