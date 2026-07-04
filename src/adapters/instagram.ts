import type { NormalizedItem, SourceAdapter } from './types'
import type { Source } from '@/payload-types'
import { escapeHtml } from '@/lib/html'
import { outboundFetch, proxyEndpoint } from '@/lib/proxy'

/**
 * Fetches public Instagram profiles via Instagram's own web API — the same
 * endpoint instagram.com uses to render profile pages. No credentials needed,
 * but it is unofficial: Instagram may rate-limit or block requests
 * (especially from datacenter IPs). Errors surface on the Source document
 * in the admin dashboard, and previously cached items keep serving.
 */

// Public app id of the instagram.com web client — required by the endpoint.
const IG_APP_ID = '936619743392459'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

interface IgTimelineMedia {
  id: string
  shortcode: string
  taken_at_timestamp: number
  display_url?: string
  is_video?: boolean
  edge_media_to_caption?: { edges?: Array<{ node?: { text?: string } }> }
}

function firstLine(text: string, maxLength = 120): string {
  const line = text.split('\n')[0].trim()
  return line.length > maxLength ? `${line.slice(0, maxLength - 1)}…` : line
}

/** Snapshot a subset of response headers (those present) for the debug record. */
function pickHeaders(headers: Headers, names: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of names) {
    const value = headers.get(name)
    if (value !== null) out[name] = value
  }
  return out
}

function toItem(media: IgTimelineMedia, username: string): NormalizedItem {
  const caption = media.edge_media_to_caption?.edges?.[0]?.node?.text ?? ''
  const url = `https://www.instagram.com/p/${media.shortcode}/`

  const parts: string[] = []
  if (media.display_url) {
    parts.push(`<p><a href="${escapeHtml(url)}"><img src="${escapeHtml(media.display_url)}" alt="" /></a></p>`)
  }
  if (caption) {
    parts.push(`<p>${escapeHtml(caption).replaceAll('\n', '<br />')}</p>`)
  }

  return {
    externalId: media.id,
    title: caption ? firstLine(caption) : `${media.is_video ? 'Video' : 'Post'} by @${username}`,
    content: parts.join('\n') || `<p>Post by @${username}</p>`,
    url,
    imageUrl: media.display_url,
    publishedAt: new Date(media.taken_at_timestamp * 1000),
  }
}

export const instagramAdapter: SourceAdapter = {
  type: 'instagram',

  sourceUrl(source: Source): string {
    return `https://www.instagram.com/${(source.handle ?? '').trim().replace(/^@/, '')}/`
  },

  async fetchItems(source: Source, debug: Record<string, unknown> = {}): Promise<NormalizedItem[]> {
    const proxy = proxyEndpoint()
    debug.proxied = proxy !== null
    debug.proxy = proxy ?? 'direct'

    const username = source.handle?.trim().replace(/^@/, '')
    if (!username) {
      throw new Error('Source has no Instagram handle configured')
    }

    const endpoint = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`
    debug.endpoint = endpoint

    const startedAt = Date.now()
    const res = await outboundFetch(endpoint, {
      headers: {
        'user-agent': USER_AGENT,
        'x-ig-app-id': IG_APP_ID,
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.9',
        referer: `https://www.instagram.com/${username}/`,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    debug.durationMs = Date.now() - startedAt
    debug.httpStatus = res.status
    debug.contentType = res.headers.get('content-type') ?? ''
    // Headers Instagram sets when throttling or challenging a client — the
    // clearest signal of whether a failure is IP-level blocking vs. a bad handle.
    debug.responseHeaders = pickHeaders(res.headers, [
      'retry-after',
      'x-ratelimit-remaining',
      'www-authenticate',
      'x-fb-rlafr',
      'location',
    ])

    if (res.status === 404) {
      throw new Error(`Instagram profile @${username} not found`)
    }
    if (!res.ok) {
      throw new Error(`Instagram responded with ${res.status} — likely rate-limited or blocked, try again later`)
    }

    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      throw new Error('Instagram returned a non-JSON response (probably a login wall) — try again later')
    }

    const body = (await res.json()) as {
      data?: { user?: { is_private?: boolean; edge_owner_to_timeline_media?: { edges?: Array<{ node: IgTimelineMedia }> } } }
    }

    const user = body.data?.user
    if (!user) {
      throw new Error(`Instagram profile @${username} not found`)
    }
    if (user.is_private) {
      throw new Error(`Instagram profile @${username} is private — only public profiles can be converted`)
    }

    const edges = user.edge_owner_to_timeline_media?.edges ?? []
    debug.itemCount = edges.length
    return edges.map(({ node }) => toItem(node, username))
  },
}
