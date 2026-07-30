/**
 * Remaining traffic on the metered residential proxy, for the status footer.
 *
 * This is the one place the app talks to the proxy *provider's* dashboard API
 * rather than to the proxy itself. Decodo (decodo.com) exposes a subscription
 * endpoint listing the plan's traffic allowance and how much of the current
 * billing period it has burned; the difference is what's still available. It
 * needs a dashboard API key (DECODO_API_TOKEN) that is separate from the proxy
 * credentials in OUTBOUND_PROXY_URL — so the feature is opt-in and stays silent
 * when the key is unset, the same way the proxy itself is optional.
 *
 * The figure is polled on a schedule (see jobs/checkProxyTraffic) and cached
 * here; the footer renders whatever the last poll left. Deliberately not routed
 * through lib/proxy's outboundFetch: this is the app's own request to a billing
 * dashboard, not adapter traffic, and must not consume metered proxy bandwidth.
 */

const SUBSCRIPTIONS_URL = 'https://api.decodo.com/v2/subscriptions'
const BYTES_PER_GB = 1024 ** 3

export interface ProxyTraffic {
  /** Bytes still available in the current billing period. */
  remainingBytes: number
  /** The plan's total allowance for the period, in bytes. */
  limitBytes: number
}

let current: ProxyTraffic | null = null

/** The last polled figure, or null when unconfigured or not yet fetched. */
export function proxyTraffic(): ProxyTraffic | null {
  return current
}

/** The one subscription field we read; Decodo reports the traffic figures in GB. */
interface Subscription {
  service_type?: string
  traffic_limit?: number
  traffic_per_period?: number
}

/**
 * Poll Decodo for the residential plan's remaining traffic and cache it.
 *
 * Returns null when DECODO_API_TOKEN is unset (the job then logs nothing). On a
 * transient API failure it throws and the cached figure is left untouched, so
 * the footer keeps showing the last good number rather than blanking out.
 */
export async function refreshProxyTraffic(): Promise<ProxyTraffic | null> {
  const token = process.env.DECODO_API_TOKEN?.trim()
  if (!token) return null

  const res = await fetch(SUBSCRIPTIONS_URL, {
    headers: { Authorization: token, Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Decodo subscriptions API returned ${res.status}`)
  }

  const subscriptions = (await res.json()) as Subscription[]
  const plan = subscriptions.find((s) => s.service_type === 'residential_proxies')
  if (!plan || typeof plan.traffic_limit !== 'number') {
    throw new Error('no residential_proxies subscription in the Decodo response')
  }

  const limitBytes = plan.traffic_limit * BYTES_PER_GB
  const usedBytes = (plan.traffic_per_period ?? 0) * BYTES_PER_GB
  // Clamp: an over-quota period would otherwise render a negative remainder.
  current = { remainingBytes: Math.max(0, limitBytes - usedBytes), limitBytes }
  return current
}
