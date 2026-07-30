import { getAdapter, prefixForType } from '../adapters/registry.js'
import { config } from '../config.js'
import type { ItemRow, SourceRow } from '../db.js'
import { escapeHtml } from './html.js'

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

/** Render one `<item>` block. Shared by real items and the synthetic notice, so
 * both get identical escaping and markup. */
function renderItem(item: {
  title: string
  link: string
  guid: string
  pubDate: Date
  description?: string | null
  /** Raw HTML emitted in a CDATA block instead of entity-escaped. Takes
   * precedence over `description`. Hand-authored markup only. */
  descriptionHtml?: string | null
  imageUrl?: string | null
  imageType?: string | null
  imageBytes?: number | null
}): string {
  const parts = [
    `      <title>${escapeXml(item.title)}</title>`,
    `      <link>${escapeXml(item.link)}</link>`,
    `      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>`,
    `      <pubDate>${item.pubDate.toUTCString()}</pubDate>`,
  ]
  if (item.descriptionHtml) {
    // Guard the CDATA terminator so embedded `]]>` can't close the block early.
    const safe = item.descriptionHtml.replaceAll(']]>', ']]]]><![CDATA[>')
    parts.push(`      <description><![CDATA[${safe}]]></description>`)
  } else if (item.description) {
    parts.push(`      <description>${escapeXml(item.description)}</description>`)
  }
  if (item.imageUrl) {
    // Real type and length, now that we serve the bytes ourselves — the S3 build
    // had to hardcode image/jpeg and 0.
    const type = item.imageType ?? 'image/jpeg'
    const length = item.imageBytes ?? 0
    parts.push(
      `      <enclosure url="${escapeXml(item.imageUrl)}" type="${escapeXml(type)}" length="${length}" />`,
    )
  }
  return `    <item>\n${parts.join('\n')}\n    </item>`
}

/**
 * An in-feed notice that this feed has stopped updating, so the reason shows up
 * in the reader rather than only on the status page. Emitted only once a
 * permanently-failing account has also gone a full day without a success, so a
 * transient 404 blip doesn't announce itself.
 *
 * `pubDate` is anchored to when the problem started, not `new Date()` — a
 * synthetic item whose date moves on every poll makes some readers re-notify.
 */
function stoppedNotice(source: SourceRow, link: string): string {
  const since = source.last_success_at
    ? `Last successful update: ${new Date(source.last_success_at).toUTCString()}.`
    : 'This feed has never updated successfully.'
  return renderItem({
    title: '[SYSTEM] This feed has stopped updating',
    link,
    guid: `system-${source.permanent_error_kind ?? 'error'}`,
    pubDate: new Date(source.permanent_error_at ?? Date.now()),
    descriptionHtml:
      `<p>${escapeHtml(source.permanent_error ?? 'This account could not be fetched.')}</p>` +
      `<p>${escapeHtml(since)} Retrying once a day.</p>`,
  })
}

/** Whether the feed should carry the stopped-updating notice. */
function isStopped(source: SourceRow): boolean {
  if (!source.permanent_error) return false
  const lastSuccess = source.last_success_at ?? source.created_at
  return Date.now() - lastSuccess > 24 * 60 * 60_000
}

/** Render a source and its cached items as an RSS 2.0 document. */
export function buildRssXml(source: SourceRow, items: ItemRow[]): string {
  const feedUrl = feedUrlFor(source)
  const link = landingUrl(source)

  const entries = items.map((item) =>
    renderItem({
      title: item.title,
      link: item.url,
      guid: item.external_id,
      pubDate: new Date(item.published_at),
      description: item.content,
      imageUrl: item.image_url,
      imageType: item.asset_mime,
      imageBytes: item.asset_bytes,
    }),
  )
  if (isStopped(source)) entries.unshift(stoppedNotice(source, link))
  const entriesXml = entries.join('\n')

  // Channel image: the account's profile picture (our own mirrored URL once
  // stored, otherwise the platform CDN URL). Emitted through several channel
  // elements because no single one is honoured everywhere: the plain RSS 2.0
  // <image> is dimension-capped (max 144×400) so readers that respect the spec
  // skip our square avatar, and most modern readers instead look for the feed
  // icon in a namespaced element — iTunes' <itunes:image> (the de-facto standard
  // for channel artwork) or Feedly's <webfeeds:icon>. Emitting all three lets
  // each client pick whichever it understands.
  const image = source.profile_image_url
    ? channelImage(source.profile_image_url, source.name, link)
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:webfeeds="http://webfeeds.org/rss/1.0">
  <channel>
    <title>${escapeXml(source.name)}</title>
    <link>${escapeXml(link)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(source.description ?? `${source.type} feed for @${source.handle}`)}</description>
    <lastBuildDate>${new Date(source.updated_at).toUTCString()}</lastBuildDate>
${image}${entriesXml}
  </channel>
</rss>
`
}

/**
 * Render the channel-level profile picture as the three widely-recognised feed
 * icon elements (see the call site for why one isn't enough). `imageUrl` is our
 * own mirrored URL once stored, otherwise the platform CDN URL.
 */
function channelImage(imageUrl: string, name: string, link: string): string {
  const url = escapeXml(imageUrl)
  return `    <image>
      <url>${url}</url>
      <title>${escapeXml(name)}</title>
      <link>${escapeXml(link)}</link>
    </image>
    <itunes:image href="${url}" />
    <webfeeds:icon>${url}</webfeeds:icon>\n`
}

/** The public URL of a source's feed. */
export function feedUrlFor(source: SourceRow): string {
  return `${config.publicBaseUrl}/feeds/${prefixForType(source.type)}/${encodeURIComponent(source.handle)}.xml`
}

/**
 * The channel <link> — the feed's "home page" — points at our own per-feed
 * landing page (`/f/{prefix}/{handle}`) rather than the account on the origin
 * platform. This is deliberate: RSS readers that derive a feed's sidebar icon
 * by scraping its home page (NetNewsWire, among others) prefer that page's
 * favicon/apple-touch-icon over the feed's declared <image>/webfeeds:icon. When
 * <link> pointed straight at e.g. instagram.com, they scraped Instagram's own
 * glyph. The landing page instead serves the account's profile picture as its
 * apple-touch-icon (see server.ts), so the reader shows the avatar. The landing
 * page itself links out to the platform account.
 */
export function landingUrl(source: SourceRow): string {
  const handle = source.handle.trim()
  if (!handle) return sourceLink(source)
  return `${config.publicBaseUrl}/f/${prefixForType(source.type)}/${encodeURIComponent(handle)}`
}

/** The account's page on the origin platform. */
export function sourceLink(source: SourceRow): string {
  try {
    return getAdapter(source.type).sourceUrl?.(source) ?? config.publicBaseUrl
  } catch {
    return config.publicBaseUrl
  }
}
