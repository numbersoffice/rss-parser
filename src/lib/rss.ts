import { getAdapter } from '@/adapters/registry'
import type { FeedItem, Source } from '@/payload-types'

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

/** The RSS entry telling a subscriber, in their reader, why a paused feed
 * stopped updating (see buildRssXml). Not persisted — synthesized on render. */
function deactivationNotice(link: string): string {
  return renderItem({
    title: 'This feed was paused to preserve bandwidth',
    link,
    guid: 'deactivated-notice',
    // Newest so it sits at the top for readers that order by date.
    pubDate: new Date(),
    description:
      'This account posts too frequently, so it was deactivated to preserve bandwidth — this is a free tool. ' +
      'No new posts will appear here until it is re-enabled.',
  })
}

/** Render one `<item>` block. Shared by real feed items and the synthetic
 * deactivation notice so both get identical escaping and markup. */
function renderItem(item: {
  title: string
  link: string
  guid: string
  pubDate: Date
  description?: string | null
  imageUrl?: string | null
}): string {
  const parts = [
    `      <title>${escapeXml(item.title)}</title>`,
    `      <link>${escapeXml(item.link)}</link>`,
    `      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>`,
    `      <pubDate>${item.pubDate.toUTCString()}</pubDate>`,
  ]
  if (item.description) {
    parts.push(`      <description>${escapeXml(item.description)}</description>`)
  }
  if (item.imageUrl) {
    parts.push(`      <enclosure url="${escapeXml(item.imageUrl)}" type="image/jpeg" length="0" />`)
  }
  return `    <item>\n${parts.join('\n')}\n    </item>`
}

/** Render a source and its cached items as an RSS 2.0 document. A disabled
 * source still serves a feed, led by a notice explaining the pause. */
export function buildRssXml(source: Source, items: FeedItem[], feedUrl: string): string {
  const link = landingUrl(source, feedUrl)

  const entries = items
    .map((item) =>
      renderItem({
        title: item.title,
        link: item.url,
        guid: item.externalId,
        pubDate: new Date(item.publishedAt),
        description: item.content,
        imageUrl: item.imageUrl,
      }),
    )
  if (source.enabled === false) {
    entries.unshift(deactivationNotice(link))
  }
  const entriesXml = entries.join('\n')
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
${image}${entriesXml}
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
