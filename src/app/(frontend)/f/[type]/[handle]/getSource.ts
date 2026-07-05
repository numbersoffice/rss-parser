import config from '@payload-config'
import { getPayload } from 'payload'

import { normalizeHandle } from '@/lib/sources'
import type { Source } from '@/payload-types'

/**
 * Look up the shared source behind a landing page URL (`/f/{type}/{handle}`).
 * Shared by the page, its metadata, and the icon route, so all three describe
 * the same account. Returns null for unknown or disabled sources — the page
 * turns that into a 404. Reads bypass Payload access control (Local API,
 * overrideAccess defaults on): these pages are intentionally public, the
 * account handle is already public on the platform, and no private data is
 * exposed.
 */
export async function getSource(type: string, handle: string): Promise<Source | null> {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'sources',
    where: {
      and: [{ type: { equals: type } }, { handle: { equals: normalizeHandle(handle) } }],
    },
    limit: 1,
    depth: 0,
  })
  const source = docs[0] as Source | undefined
  if (!source || source.enabled === false) return null
  return source
}
