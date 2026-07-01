import type { Payload, PayloadRequest } from 'payload'

import type { Source } from '@/payload-types'

export const normalizeHandle = (handle: string): string =>
  handle.trim().replace(/^@/, '').toLowerCase()

export const defaultSourceName = (type: string, handle: string): string =>
  `@${normalizeHandle(handle)} (${type})`

/** Payload relationship values are ids at depth 0 and docs at depth 1+. */
export const relationId = (value: unknown): number | string | undefined => {
  if (value == null) return undefined
  if (typeof value === 'object') return (value as { id?: number | string }).id
  return value as number | string
}

/**
 * Sources are canonical: one per (type, handle), shared by all subscribers so
 * each account is only fetched once. Subscribing finds the existing source or
 * creates it.
 */
export async function findOrCreateSource(
  payload: Payload,
  type: Source['type'],
  handle: string,
  req?: PayloadRequest,
): Promise<Source> {
  const normalized = normalizeHandle(handle)
  const find = async () =>
    (
      await payload.find({
        collection: 'sources',
        where: { and: [{ type: { equals: type } }, { handle: { equals: normalized } }] },
        limit: 1,
        depth: 0,
        req,
      })
    ).docs[0]

  const existing = await find()
  if (existing) return existing

  try {
    return await payload.create({
      collection: 'sources',
      data: { type, handle: normalized, name: defaultSourceName(type, normalized) },
      depth: 0,
      // The subscription's afterChange hook triggers the first fetch.
      context: { skipSourceRefresh: true },
      req,
    })
  } catch (err) {
    // Unique index on (type, handle): lost a creation race — reuse the winner.
    const winner = await find()
    if (winner) return winner
    throw err
  }
}

/** Garbage-collect a source (and, via its hooks, its cached items) once the
 * last subscription is gone. */
export async function deleteSourceIfOrphaned(
  payload: Payload,
  sourceId: number | string,
  req?: PayloadRequest,
): Promise<void> {
  const { totalDocs } = await payload.count({
    collection: 'subscriptions',
    where: { source: { equals: sourceId } },
    req,
  })
  if (totalDocs === 0) {
    await payload.delete({ collection: 'sources', id: sourceId, req })
  }
}
