import type { Payload } from 'payload'

import { dayKey } from '@/lib/day'
import { describeError } from '@/lib/refresh'

/**
 * Upsert a source's daily activity row with the number of new feed items just
 * created: add to the existing row for today, or create one. Called from
 * FeedItems' afterChange hook for every created item (unless the create passed
 * `context.skipActivity`, e.g. the subscribe-time seed), so days without new
 * items stay absent (and the collection stays sparse). Never throws — item
 * creation must not fail over bookkeeping, so a failure only logs.
 */
export async function recordDailyActivity(
  payload: Payload,
  sourceId: number,
  newCount: number,
): Promise<void> {
  if (newCount <= 0) return
  const day = dayKey()
  try {
    const existing = await payload.find({
      collection: 'source-activity',
      where: { and: [{ source: { equals: sourceId } }, { day: { equals: day } }] },
      limit: 1,
      depth: 0,
    })
    if (existing.docs.length > 0) {
      const row = existing.docs[0]
      await payload.update({
        collection: 'source-activity',
        id: row.id,
        data: { count: (row.count ?? 0) + newCount },
        depth: 0,
      })
    } else {
      await payload.create({
        collection: 'source-activity',
        data: { source: sourceId, day, count: newCount },
        depth: 0,
      })
    }
  } catch (err) {
    payload.logger.warn(
      `Could not record daily activity for source ${sourceId}: ${describeError(err)}`,
    )
  }
}
