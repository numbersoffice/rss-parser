/**
 * Warm up Payload when the server boots instead of on the first request.
 * Without this, the first request after a (re)start pays the full init cost
 * and can hit a schema-push race that returns a 500 — which an RSS reader
 * interprets as "no feed here".
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getPayload } = await import('payload')
    const { default: config } = await import('@payload-config')
    await getPayload({ config })
  }
}
