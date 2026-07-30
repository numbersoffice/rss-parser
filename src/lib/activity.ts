const DAY_MS = 86_400_000

/**
 * How many new posts a feed receives per day, and the day bucketing that feeds
 * it. Kept pure and free of database access so the arithmetic — which is easy to
 * get subtly wrong — can be unit-tested directly.
 */

/**
 * The calendar day of a timestamp as `YYYY-MM-DD`, in UTC.
 *
 * UTC rather than local time: the old Payload build used local days because it
 * had a nightly cron at local midnight to line up with, but this scheduler runs
 * on intervals, so local time would only buy DST bugs. The fixed width is
 * load-bearing — the prune compares days lexicographically, which is only a
 * correct date compare while every key is exactly ten characters.
 */
export function dayKey(at: number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10)
}

/** The first day still inside the retention window, including today. */
export function windowStartDay(windowDays: number, now: number = Date.now()): string {
  return dayKey(now - (Math.max(1, windowDays) - 1) * DAY_MS)
}

export interface Average {
  /** New posts per day over the observed period. */
  perDay: number
  /** Posts counted, for the tooltip. */
  posts: number
  /** Days the average is over, for the tooltip. */
  days: number
}

/**
 * Average new posts per day for one feed.
 *
 * The denominator is **elapsed days observed**, not the number of days that
 * happened to have posts. That distinction is the whole point: the previous
 * implementation divided by its row count, so a feed that posted 20 times on one
 * day and nothing for a week scored 20/day and outranked a feed posting 15 every
 * single day. Days with zero posts have to count, or it isn't an average.
 *
 * Returns `null` when the feed has never been fetched successfully — there is no
 * observation period yet, so any number would be invented.
 *
 * The denominator is clamped to `[1, windowDays]`:
 *
 * - The **floor of one day** keeps a young feed honest. Without it, a feed added
 *   two hours ago that picked up a single post would report `12/day`.
 * - The **ceiling** matches what the window actually retains: counting days we
 *   no longer have rows for would drag every long-lived feed's average toward
 *   zero.
 */
export function averagePerDay(
  posts: number,
  firstSuccessAt: number | null,
  windowDays: number,
  now: number = Date.now(),
): Average | null {
  if (firstSuccessAt === null) return null

  const window = Math.max(1, windowDays)
  // Only count time we still hold data for: the window's own span bounds it.
  const observedFrom = Math.max(firstSuccessAt, now - window * DAY_MS)
  const elapsedDays = (now - observedFrom) / DAY_MS
  const days = Math.min(window, Math.max(1, elapsedDays))

  return { perDay: posts / days, posts, days }
}

/**
 * Render an average for display. One decimal below ten, whole numbers above —
 * the old widget rounded everything, which made every feed posting less than
 * once a day read as a flat "0" and look dead.
 */
export function formatPerDay(perDay: number): string {
  if (perDay === 0) return '0'
  if (perDay < 0.05) return '<0.1'
  if (perDay < 10) return perDay.toFixed(1)
  return String(Math.round(perDay))
}
