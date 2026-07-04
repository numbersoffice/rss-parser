import type { NormalizedItem, SourceAdapter } from './types'
import type { Source } from '@/payload-types'
import { escapeHtml } from '@/lib/html'
import { outboundFetch, proxyEndpoint, randomSessionId } from '@/lib/proxy'

/**
 * Fetches public Instagram profiles via Instagram's own web API — the same
 * endpoint instagram.com uses to render profile pages. No login needed, but the
 * endpoint returns 401 to requests that don't look like a real logged-out web
 * client: it wants session cookies, a matching CSRF token, and the fingerprint
 * headers Chrome sends. So we first "prime" a guest session (GET instagram.com
 * to collect cookies) and then send the profile request with those cookies plus
 * the CSRF and Sec-Fetch/client-hint headers. Both calls share one sticky proxy
 * session id, so — when a session-capable proxy is configured — they leave from
 * the same IP, which is what the cookie handshake expects.
 *
 * Still unofficial: Instagram may rate-limit or block. Errors surface on the
 * Source document in the admin dashboard, and previously cached items keep
 * serving.
 */

// Public app id of the instagram.com web client — required by the endpoint.
const IG_APP_ID = '936619743392459'

// Constant the web client sends on API calls; pins the endpoint's expectations.
const IG_ASBD_ID = '129477'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// Client-hint headers must agree with USER_AGENT (Chrome 126 on macOS) — a UA
// with no/​mismatched hints is itself a bot tell.
const SEC_CH_UA = '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"'
const CLIENT_HINTS = {
  'sec-ch-ua': SEC_CH_UA,
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
}

/** Parse `Set-Cookie` lines into a name→value jar (first name=value of each). */
function parseSetCookies(lines: string[]): Record<string, string> {
  const jar: Record<string, string> = {}
  for (const line of lines) {
    const pair = line.split(';', 1)[0]
    const eq = pair.indexOf('=')
    if (eq > 0) {
      const name = pair.slice(0, eq).trim()
      const value = pair.slice(eq + 1).trim()
      if (name) jar[name] = value
    }
  }
  return jar
}

/** A 32-char lowercase-hex token, the shape Instagram's csrftoken takes. */
function randomCsrfToken(): string {
  return (randomSessionId() + randomSessionId()).slice(0, 32).padEnd(32, '0')
}

/**
 * Establish a logged-out guest session on the given sticky proxy id: GET
 * instagram.com and harvest its cookies (csrftoken, mid, datr, ig_did). Failure
 * here is non-fatal — we fall back to a self-issued CSRF token (the endpoint
 * only checks the cookie and header match), so the profile request still runs.
 */
async function primeSession(
  session: string,
  debug: Record<string, unknown>,
): Promise<{ cookies: Record<string, string>; wwwClaim: string | null }> {
  try {
    const res = await outboundFetch(
      'https://www.instagram.com/',
      {
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          ...CLIENT_HINTS,
          'sec-fetch-dest': 'document',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-site': 'none',
          'sec-fetch-user': '?1',
          'upgrade-insecure-requests': '1',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      },
      { session },
    )
    const setCookies =
      (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
    const cookies = parseSetCookies(setCookies)
    debug.primeStatus = res.status
    debug.primeCookies = Object.keys(cookies)
    return { cookies, wwwClaim: res.headers.get('x-ig-set-www-claim') }
  } catch (err) {
    debug.primeError = err instanceof Error ? err.message : String(err)
    return { cookies: {}, wwwClaim: null }
  }
}

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

    // One sticky proxy session shared by the prime and the profile request so
    // both leave from the same IP (a no-op when the proxy isn't session-aware).
    const session = randomSessionId()
    const { cookies, wwwClaim } = await primeSession(session, debug)

    // CSRF double-submit: the endpoint only checks the x-csrftoken header equals
    // the csrftoken cookie. Prefer the primed cookie; self-issue one otherwise.
    const csrfToken = cookies.csrftoken ?? randomCsrfToken()
    cookies.csrftoken = csrfToken
    const cookieHeader = Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ')

    const startedAt = Date.now()
    const res = await outboundFetch(
      endpoint,
      {
        headers: {
          'user-agent': USER_AGENT,
          'x-ig-app-id': IG_APP_ID,
          'x-asbd-id': IG_ASBD_ID,
          'x-csrftoken': csrfToken,
          'x-requested-with': 'XMLHttpRequest',
          ...(wwwClaim ? { 'x-ig-www-claim': wwwClaim } : {}),
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
          accept: '*/*',
          'accept-language': 'en-US,en;q=0.9',
          ...CLIENT_HINTS,
          'sec-fetch-site': 'same-origin',
          'sec-fetch-mode': 'cors',
          'sec-fetch-dest': 'empty',
          referer: `https://www.instagram.com/${username}/`,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      },
      { session },
    )
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
