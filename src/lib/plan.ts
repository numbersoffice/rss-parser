import type { NormalizedItem } from '../adapters/types.js'

/**
 * The reconciliation planner — pure, so the most load-bearing logic in the app
 * can be tested without a database, a network or a filesystem.
 *
 * The invariant: after a refresh the stored items are exactly the newest ≤N of
 * `union(fetched, existing)` by publish date. Computing the target set in memory
 * first and only writing the diff is what stops a fetched item that doesn't make
 * the cut — an old pinned post the platform keeps re-serving at the top of the
 * timeline — from being inserted and deleted again on every single cycle.
 *
 * Just as important, and easy to get wrong: items the fetch *didn't* return are
 * kept, not deleted. A short or partial response must never empty a feed.
 */

/** The subset of a stored row the planner needs. */
export interface ExistingItem {
  id: number
  external_id: string
  published_at: number
  asset: string | null
  /** Extra gallery images as a JSON array (see db.ItemRow); carried so a doomed
   * row's carousel files can be unlinked alongside its cover. */
  gallery: string | null
}

export interface ReconcilePlan<E extends ExistingItem> {
  /** Stored items the fetch returned again: refresh their content. */
  updates: { existing: E; fetched: NormalizedItem }[]
  /** Fetched items not stored yet, oldest first so ids follow chronology. */
  creates: NormalizedItem[]
  /** Stored items that fell outside the cap. */
  deletes: E[]
}

export function planReconcile<E extends ExistingItem>(
  existing: E[],
  fetched: NormalizedItem[],
  limit: number,
): ReconcilePlan<E> {
  // Union of fetched and existing, keyed by external id. An entry can carry the
  // stored row, the fetched item, or both.
  interface Entry {
    publishedAt: number
    fetched?: NormalizedItem
    existing?: E
  }
  const union = new Map<string, Entry>()
  for (const row of existing) {
    union.set(row.external_id, { publishedAt: row.published_at, existing: row })
  }
  for (const item of fetched) {
    union.set(item.externalId, {
      publishedAt: item.publishedAt.getTime(),
      fetched: item,
      existing: union.get(item.externalId)?.existing,
    })
  }

  const target = [...union.values()]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, Math.max(0, limit))
  const kept = new Set(
    target.map((entry) => entry.fetched?.externalId ?? entry.existing!.external_id),
  )

  const updates: ReconcilePlan<E>['updates'] = []
  for (const entry of target) {
    if (entry.fetched && entry.existing) {
      updates.push({ existing: entry.existing, fetched: entry.fetched })
    }
  }

  const creates = target
    .filter((entry) => entry.fetched && !entry.existing)
    // Oldest first, so autoincrement ids stay monotonic with post age.
    .sort((a, b) => a.publishedAt - b.publishedAt)
    .map((entry) => entry.fetched!)

  const deletes = existing.filter((row) => !kept.has(row.external_id))

  return { updates, creates, deletes }
}
