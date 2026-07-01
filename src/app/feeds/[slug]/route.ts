import config from '@payload-config'
import { getPayload } from 'payload'

import { refreshSourceIfStale } from '@/lib/refresh'
import { buildRssXml } from '@/lib/rss'
import type { Source } from '@/payload-types'

const MAX_ITEMS = 50

/**
 * GET /feeds/{slug} — the RSS feed for a source. Refreshes from the source
 * platform when the cache is older than the source's TTL; on fetch failure
 * the previously cached items keep serving.
 */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const payload = await getPayload({ config })

  const sources = await payload.find({
    collection: 'sources',
    where: { and: [{ slug: { equals: slug } }, { enabled: { equals: true } }] },
    limit: 1,
    depth: 0,
  })
  let source = sources.docs[0] as Source | undefined
  if (!source) {
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

  const feedUrl = new URL(`/feeds/${slug}`, request.url).toString()
  const xml = buildRssXml(source, items.docs, feedUrl)

  return new Response(xml, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  })
}
