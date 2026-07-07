/**
 * Warm up Payload when the server boots instead of on the first request.
 * Without this, the first request after a (re)start pays the full init cost
 * and can hit a schema-push race that returns a 500 — which an RSS reader
 * interprets as "no feed here".
 *
 * `cron: true` is required to start the jobs `autoRun` crons (see
 * payload.config.ts `jobs.autoRun`). It defaults to false, and the Next.js
 * request handlers call getPayload without it, so this boot-time init is the
 * only place the nightly scheduler gets turned on. Without it the
 * `pruneUnverifiedUsers` schedule never ticks — no users are pruned and the
 * admin "Last cleanup" notice stays on "not yet".
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getPayload } = await import('payload')
    const { default: config } = await import('@payload-config')
    await getPayload({ config, cron: true })
  }
}
