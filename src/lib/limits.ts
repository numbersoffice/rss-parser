import type { Payload, PayloadRequest } from 'payload'

export const DEFAULT_MAX_SUBSCRIPTIONS = 12

/** The admin-configured per-user subscription cap (settings global). */
export async function getSubscriptionLimit(payload: Payload): Promise<number> {
  const settings = await payload.findGlobal({ slug: 'settings', depth: 0 })
  return settings?.maxSubscriptionsPerUser ?? DEFAULT_MAX_SUBSCRIPTIONS
}

export const DEFAULT_MAX_ITEMS_PER_FEED = 12

/** The admin-configured cap on how many items are kept per feed; the refresh
 * prunes the oldest beyond it (settings global). */
export async function getMaxItemsPerFeed(payload: Payload): Promise<number> {
  const settings = await payload.findGlobal({ slug: 'settings', depth: 0 })
  return settings?.maxItemsPerFeed ?? DEFAULT_MAX_ITEMS_PER_FEED
}

export const DEFAULT_MAX_FETCH_ATTEMPTS = 3

/** The admin-configured number of fetch attempts per source before giving up
 * (settings global). Each retry rotates to a fresh proxy IP — see the adapter. */
export async function getMaxFetchAttempts(payload: Payload): Promise<number> {
  const settings = await payload.findGlobal({ slug: 'settings', depth: 0 })
  return settings?.maxFetchAttempts ?? DEFAULT_MAX_FETCH_ATTEMPTS
}

/** How many subscriptions a user currently has. Pass `req` from inside a
 * hook so the count sees the surrounding transaction. */
export async function countUserSubscriptions(
  payload: Payload,
  userId: string | number,
  req?: PayloadRequest,
): Promise<number> {
  const { totalDocs } = await payload.count({
    collection: 'subscriptions',
    where: { user: { equals: userId } },
    req,
  })
  return totalDocs
}
