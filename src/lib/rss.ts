import { getAdapter } from '@/adapters/registry'
import type { FeedItem, Source } from '@/payload-types'

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

/** Render a source and its cached items as an RSS 2.0 document. */
export function buildRssXml(source: Source, items: FeedItem[], feedUrl: string): string {
  const entries = items
    .map((item) => {
      const parts = [
        `      <title>${escapeXml(item.title)}</title>`,
        `      <link>${escapeXml(item.url)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(item.externalId)}</guid>`,
        `      <pubDate>${new Date(item.publishedAt).toUTCString()}</pubDate>`,
      ]
      if (item.content) {
        parts.push(`      <description>${escapeXml(item.content)}</description>`)
      }
      if (item.imageUrl) {
        parts.push(`      <enclosure url="${escapeXml(item.imageUrl)}" type="image/jpeg" length="0" />`)
      }
      return `    <item>\n${parts.join('\n')}\n    </item>`
    })
    .join('\n')

  const link = sourceLink(source, feedUrl)
  // Channel image: the account's profile picture (the mirrored bucket URL once
  // stored, otherwise the platform CDN URL). RSS 2.0 requires url/title/link.
  const image = source.profileImageUrl
    ? `    <image>
      <url>${escapeXml(source.profileImageUrl)}</url>
      <title>${escapeXml(source.name)}</title>
      <link>${escapeXml(link)}</link>
    </image>\n`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(source.name)}</title>
    <link>${escapeXml(link)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(`${source.type} feed for ${source.handle}`)}</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${image}${entries}
  </channel>
</rss>
`
}

function sourceLink(source: Source, fallback: string): string {
  try {
    return getAdapter(source.type).sourceUrl?.(source) ?? fallback
  } catch {
    return fallback
  }
}
