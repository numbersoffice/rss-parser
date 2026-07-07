/**
 * Decodo Public API — read the residential proxy account's current data usage
 * so the admin dashboard can show remaining GB (see DataUsageWidget).
 *
 * The app already spends metered Decodo residential bandwidth on Instagram
 * fetches (src/lib/proxy.ts, gate.decodo.com). This talks to Decodo's separate
 * management API instead, purely to report usage — so it uses plain `fetch`,
 * NOT `outboundFetch`: an app-internal status call must never be routed through
 * (and billed against) the residential proxy.
 *
 * Auth is Decodo's key scheme: the dashboard API key goes in the `Authorization`
 * header verbatim — no `Basic`/`Bearer` prefix, no base64 (any prefix 401s). The
 * v2 subscriptions endpoint — `GET /v2/subscriptions` — is scoped to the account
 * behind the API key alone, so no account/user id is needed.
 *
 * Config is read from the env directly (matching proxy.ts / limits.ts — the
 * project has no env-validation layer). Everything degrades to `null` when
 * unset or on any error, so the dashboard never breaks because Decodo is
 * missing, slow, or misconfigured.
 */

const API_BASE = 'https://api.decodo.com/v2'
const TIMEOUT_MS = 8000
// Cache usage for 5 minutes so repeated dashboard loads don't hammer the API.
const REVALIDATE_SECONDS = 300

export interface DecodoUsage {
  /** GB consumed in the current billing cycle. */
  usedGb: number
  /** Plan allowance in GB. */
  limitGb: number
  /** Allowance minus usage, floored at 0. */
  remainingGb: number
  /** Cycle/plan end date (ISO date string) when Decodo reports one. */
  validUntil: string | null
}

/** Shape of the fields we read off Decodo's subscription response. Decodo
 * returns the traffic figures as strings. The v2 endpoint reports cycle usage
 * as `traffic`; older docs/responses call it `traffic_per_period`, so we accept
 * either. */
interface DecodoSubscription {
  traffic_limit?: string | number
  traffic?: string | number
  traffic_per_period?: string | number
  valid_until?: string | null
}

/**
 * Current Decodo residential usage, or `null` when it can't be determined
 * (no API key configured, network/timeout error, non-2xx, or unparseable
 * response). Never throws.
 */
export async function getDecodoUsage(): Promise<DecodoUsage | null> {
  const apiKey = process.env.DECODO_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch(`${API_BASE}/subscriptions`, {
      headers: {
        Authorization: apiKey,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      next: { revalidate: REVALIDATE_SECONDS },
    })

    if (!res.ok) {
      console.error(`[decodo] usage request failed: ${res.status} ${res.statusText}`)
      return null
    }

    const sub = pickSubscription(await res.json())
    if (!sub) return null

    const limitGb = Number(sub.traffic_limit)
    const usedGb = Number(sub.traffic ?? sub.traffic_per_period)
    if (!Number.isFinite(limitGb) || !Number.isFinite(usedGb)) {
      console.error('[decodo] usage response missing numeric traffic fields')
      return null
    }

    return {
      usedGb,
      limitGb,
      remainingGb: Math.max(limitGb - usedGb, 0),
      validUntil: sub.valid_until ?? null,
    }
  } catch (err) {
    console.error('[decodo] usage request errored:', err)
    return null
  }
}

/** Decodo may return a single subscription object or an array of them; pick the
 * residential entry (or the first) so callers get one record to read. */
function pickSubscription(body: unknown): DecodoSubscription | null {
  const list = Array.isArray(body) ? body : body ? [body] : []
  const subs = list.filter((s): s is DecodoSubscription => typeof s === 'object' && s !== null)
  if (subs.length === 0) return null
  const residential = subs.find(
    (s) => (s as { service_type?: string }).service_type === 'residential_proxies',
  )
  return residential ?? subs[0]
}
