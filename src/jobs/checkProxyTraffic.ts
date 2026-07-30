import type { ProxyTraffic } from '../lib/proxyTraffic.js'
import { refreshProxyTraffic } from '../lib/proxyTraffic.js'
import { describeError } from '../lib/errors.js'
import type { JobResult } from './scheduler.js'

const BYTES_PER_GB = 1024 ** 3

/**
 * Scheduled poll of the proxy provider's remaining traffic (see
 * lib/proxyTraffic). Skipped silently when no API key is configured; a failed
 * poll is reported as a job error but leaves the last good figure cached.
 */
export async function checkProxyTraffic(): Promise<JobResult> {
  let traffic: ProxyTraffic | null
  try {
    traffic = await refreshProxyTraffic()
  } catch (err) {
    return { status: 'error', fields: { error: describeError(err) } }
  }
  if (!traffic) return { skipped: true }
  return {
    fields: {
      remaining: `${(traffic.remainingBytes / BYTES_PER_GB).toFixed(1)} GB`,
      limit: `${(traffic.limitBytes / BYTES_PER_GB).toFixed(0)} GB`,
    },
  }
}
