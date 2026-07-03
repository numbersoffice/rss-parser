import { fetch as undiciFetch, ProxyAgent } from 'undici'

/**
 * fetch for outbound adapter traffic (e.g. Instagram). When OUTBOUND_PROXY_URL
 * is set, requests are tunneled through that HTTP proxy — e.g. a residential
 * proxy so Instagram doesn't see a datacenter IP:
 *
 *   OUTBOUND_PROXY_URL=http://user:pass_country-us@residential.fleetproxy.io:12321
 *
 * Node's built-in fetch ignores HTTP_PROXY/HTTPS_PROXY, so this goes through
 * undici's ProxyAgent instead. Only adapters should use this; app-internal
 * requests must not consume metered proxy bandwidth.
 */

let dispatcher: ProxyAgent | undefined

export const outboundFetch: typeof fetch = async (input, init) => {
  const proxyUrl = process.env.OUTBOUND_PROXY_URL
  if (!proxyUrl) {
    return fetch(input, init)
  }
  dispatcher ??= new ProxyAgent(proxyUrl)
  const res = await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher,
  })
  return res as unknown as Response
}

/** The proxy host:port currently in use, with any credentials stripped, or
 * null when running direct. Safe to store/display — never exposes the
 * username or password embedded in OUTBOUND_PROXY_URL. */
export function proxyEndpoint(): string | null {
  const proxyUrl = process.env.OUTBOUND_PROXY_URL
  if (!proxyUrl) return null
  try {
    return new URL(proxyUrl).host
  } catch {
    return proxyUrl.replace(/\/\/[^@]*@/, '//') // best-effort scrub if unparseable
  }
}
