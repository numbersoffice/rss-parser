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

  const link = landingUrl(source, feedUrl)
  // Channel image: the account's profile picture (the mirrored bucket URL once
  // stored, otherwise the platform CDN URL). Emitted through several channel
  // elements because no single one is honoured everywhere: the plain RSS 2.0
  // <image> is dimension-capped (max 144×400) so readers that respect the spec
  // skip our square avatar, and most modern readers instead look for the feed
  // icon in a namespaced element — iTunes' <itunes:image> (the de-facto standard
  // for channel artwork) or Feedly's <webfeeds:icon>. Emitting all three lets
  // each client pick whichever it understands.
  const image = source.profileImageUrl ? channelImage(source.profileImageUrl, source.name, link) : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:webfeeds="http://webfeeds.org/rss/1.0">
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

/**
 * Render the channel-level profile picture as the three widely-recognised feed
 * icon elements (see the call site for why one isn't enough). `imageUrl` is the
 * stable bucket URL once mirrored, otherwise the platform CDN URL.
 */
function channelImage(imageUrl: string, name: string, link: string): string {
  const url = escapeXml(imageUrl)
  return (
    `    <image>
      <url>${url}</url>
      <title>${escapeXml(name)}</title>
      <link>${escapeXml(link)}</link>
    </image>
    <itunes:image href="${url}" />
    <webfeeds:icon>${url}</webfeeds:icon>\n`
  )
}

/**
 * The channel <link> — the feed's "home page" — points at our own per-feed
 * landing page (`/f/{type}/{handle}`) rather than the account on the origin
 * platform. This is deliberate: RSS readers that derive a feed's sidebar icon
 * by scraping its home page (NetNewsWire, among others) prefer that page's
 * favicon/apple-touch-icon over the feed's declared <image>/webfeeds:icon. When
 * <link> pointed straight at e.g. instagram.com, they scraped Instagram's own
 * glyph. The landing page instead serves the account's profile picture as its
 * apple-touch-icon (see the (frontend)/f route), so the reader shows the avatar.
 * The landing page itself links out to the platform account. Derives the origin
 * from the already-absolute feedUrl; falls back to the platform URL if that or
 * the handle is somehow unavailable.
 */
function landingUrl(source: Source, feedUrl: string): string {
  const handle = (source.handle ?? '').trim().replace(/^@/, '')
  try {
    const origin = new URL(feedUrl).origin
    if (!handle) throw new Error('no handle')
    return `${origin}/f/${encodeURIComponent(source.type)}/${encodeURIComponent(handle)}`
  } catch {
    return sourceLink(source, feedUrl)
  }
}

function sourceLink(source: Source, fallback: string): string {
  try {
    return getAdapter(source.type).sourceUrl?.(source) ?? fallback
  } catch {
    return fallback
  }
}
