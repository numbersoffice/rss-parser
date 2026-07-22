import { fetch as undiciFetch, ProxyAgent } from 'undici'

/**
 * fetch for outbound adapter traffic (e.g. Instagram). When OUTBOUND_PROXY_URL
 * is set, requests are tunneled through that HTTP proxy — e.g. a residential
 * proxy so Instagram doesn't see a datacenter IP:
 *
 *   OUTBOUND_PROXY_URL=http://user-USER-country-us-session-{session}:PASS@gate.decodo.com:7000
 *
 * Sticky sessions: if the URL contains the literal token `{session}`, callers
 * may pass a session id (see `outboundFetch`'s third arg) that is substituted
 * in per request. The proxy holds one exit IP for a given session id, so a pair
 * of requests sharing an id (e.g. a cookie-prime followed by the real fetch)
 * goes through the same IP; a new id rotates to a new IP. Where `{session}`
 * sits is provider-specific (Decodo carries it in the username); the
 * placeholder keeps this code provider-agnostic. With no placeholder the
 * session id is ignored and traffic rotates as before.
 *
 * Node's built-in fetch ignores HTTP_PROXY/HTTPS_PROXY, so this goes through
 * undici's ProxyAgent instead. Only adapters should use this; app-internal
 * requests must not consume metered proxy bandwidth.
 */

const SESSION_PLACEHOLDER = '{session}'

// One dispatcher per resolved proxy URL. Distinct session ids resolve to
// distinct URLs and thus distinct agents/IPs; requests sharing an id reuse the
// same agent (and connection pool), so a prime+fetch pair stays on one IP.
//
// Retries rotate to a *random* session id (see the Instagram adapter), so each
// retry resolves to a fresh URL. This cache is therefore bounded as an LRU —
// otherwise it would grow without limit, one leaked ProxyAgent (and its
// connection pool) per retry, forever. Stable per-source sessions stay hot and
// are never evicted under normal load; evicted agents are closed so their
// sockets are released. Map iteration order is insertion order, so the first
// key is the least-recently used once we re-insert on hit.
const MAX_DISPATCHERS = 64
const dispatchers = new Map<string, ProxyAgent>()

function dispatcherFor(proxyUrl: string): ProxyAgent {
  const existing = dispatchers.get(proxyUrl)
  if (existing) {
    // Mark most-recently used.
    dispatchers.delete(proxyUrl)
    dispatchers.set(proxyUrl, existing)
    return existing
  }

  const agent = new ProxyAgent(proxyUrl)
  dispatchers.set(proxyUrl, agent)

  if (dispatchers.size > MAX_DISPATCHERS) {
    const oldestKey = dispatchers.keys().next().value as string
    const oldest = dispatchers.get(oldestKey)
    dispatchers.delete(oldestKey)
    // Drain the pool so idle sockets are freed. `close()` lets in-flight
    // requests finish; fire-and-forget since we no longer reference it.
    if (oldest) void oldest.close().catch(() => {})
  }

  return agent
}

interface OutboundOptions {
  /** Sticky-session id, substituted for `{session}` in OUTBOUND_PROXY_URL. */
  session?: string
}

export const outboundFetch = async (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
  options?: OutboundOptions,
): Promise<Response> => {
  const rawUrl = process.env.OUTBOUND_PROXY_URL
  if (!rawUrl) {
    return fetch(input, init)
  }

  // Substitute the session id when the URL opts into sticky sessions; otherwise
  // strip the placeholder if it's somehow present so we never leak it.
  const proxyUrl = rawUrl.includes(SESSION_PLACEHOLDER)
    ? rawUrl.replaceAll(SESSION_PLACEHOLDER, options?.session ?? randomSessionId())
    : rawUrl

  const res = await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: dispatcherFor(proxyUrl),
  })
  return res as unknown as Response
}

/** A random sticky-session id — hex, provider-neutral, safe in a proxy URL. */
export function randomSessionId(): string {
  return Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10)
}

/**
 * A stable sticky-session id for a source, so every fetch for that source leaves
 * from the same proxy session/IP and two sources refreshed at once never share
 * one (which is what triggers Instagram's per-IP 401s). Alphanumeric, so it's
 * safe inside the proxy username where Decodo carries the session token.
 */
export function sessionForSource(id: string | number): string {
  return `src${id}`
}

/** The proxy host:port currently in use, with any credentials and the session
 * placeholder stripped, or null when running direct. Safe to store/display —
 * never exposes the username or password embedded in OUTBOUND_PROXY_URL. */
export function proxyEndpoint(): string | null {
  const proxyUrl = process.env.OUTBOUND_PROXY_URL
  if (!proxyUrl) return null
  try {
    return new URL(proxyUrl.replaceAll(SESSION_PLACEHOLDER, 'x')).host
  } catch {
    return proxyUrl.replace(/\/\/[^@]*@/, '//') // best-effort scrub if unparseable
  }
}
