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
const dispatchers = new Map<string, ProxyAgent>()

function dispatcherFor(proxyUrl: string): ProxyAgent {
  let agent = dispatchers.get(proxyUrl)
  if (!agent) {
    agent = new ProxyAgent(proxyUrl)
    dispatchers.set(proxyUrl, agent)
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
