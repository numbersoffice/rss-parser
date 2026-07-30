import assert from 'node:assert/strict'
import { test } from 'node:test'

import { averagePerDay, dayKey, formatPerDay, windowStartDay } from './activity.js'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 6, 30, 12, 0, 0)

test('day keys are UTC and fixed width, so lexicographic compare is a date compare', () => {
  assert.equal(dayKey(Date.UTC(2026, 6, 30, 23, 59, 59)), '2026-07-30')
  assert.equal(dayKey(Date.UTC(2026, 0, 1, 0, 0, 0)), '2026-01-01')
  assert.equal(dayKey(NOW).length, 10)
  // The prune relies on this ordering holding across month and year edges.
  assert.ok(dayKey(Date.UTC(2025, 11, 31)) < dayKey(Date.UTC(2026, 0, 1)))
  assert.ok(dayKey(Date.UTC(2026, 0, 9)) < dayKey(Date.UTC(2026, 0, 10)))
})

test('the window includes today, so N days means N distinct keys', () => {
  // 30 days ending today = today minus 29.
  assert.equal(windowStartDay(30, NOW), '2026-07-01')
  assert.equal(windowStartDay(1, NOW), '2026-07-30')
})

test('a feed that has never been fetched has no average', () => {
  assert.equal(averagePerDay(0, null, 30, NOW), null)
})

test('a young feed is floored at one day rather than extrapolated', () => {
  // Observed for two hours with one new post. Dividing by the true elapsed time
  // would claim 12/day.
  const avg = averagePerDay(1, NOW - 2 * 3_600_000, 30, NOW)
  assert.equal(avg?.perDay, 1)
  assert.equal(avg?.days, 1)
})

test('averages over elapsed days, counting days with no posts', () => {
  // 20 posts, all on one day, but observed for ten. The old implementation
  // divided by the number of days that had rows and would have said 20/day.
  const avg = averagePerDay(20, NOW - 10 * DAY, 30, NOW)
  assert.equal(avg?.perDay, 2)
  assert.equal(avg?.days, 10)
})

test('a steady feed beats a one-day spike with the same window', () => {
  const spike = averagePerDay(20, NOW - 10 * DAY, 30, NOW)!
  const steady = averagePerDay(150, NOW - 10 * DAY, 30, NOW)!
  assert.ok(steady.perDay > spike.perDay)
})

test('the denominator is capped at the window, not the feed age', () => {
  // Watched for a year, but only 30 days of counts are retained.
  const avg = averagePerDay(60, NOW - 365 * DAY, 30, NOW)
  assert.equal(avg?.days, 30)
  assert.equal(avg?.perDay, 2)
})

test('no posts over a real observation period is a legitimate zero', () => {
  const avg = averagePerDay(0, NOW - 14 * DAY, 30, NOW)
  assert.equal(avg?.perDay, 0)
  assert.equal(avg?.days, 14)
})

test('formats small rates without collapsing them to zero', () => {
  // A feed posting twice a month is 0.07/day — the old widget rounded that to
  // "0" and made every low-volume feed look dead.
  assert.equal(formatPerDay(0), '0')
  assert.equal(formatPerDay(0.07), '0.1')
  // Only a rate that would render as "0.0" gets the explicit "some, but few"
  // form; a real zero and a near-zero must not look the same.
  assert.equal(formatPerDay(0.02), '<0.1')
  assert.equal(formatPerDay(0.4), '0.4')
  assert.equal(formatPerDay(3.44), '3.4')
  assert.equal(formatPerDay(9.96), '10.0')
  assert.equal(formatPerDay(24.3), '24')
})
