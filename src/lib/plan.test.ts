import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { NormalizedItem } from '../adapters/types.js'
import { type ExistingItem, planReconcile } from './plan.js'

const DAY = 86_400_000
const BASE = Date.UTC(2026, 0, 1)

/** A fetched item published `day` days after the base date. */
const fetched = (externalId: string, day: number): NormalizedItem => ({
  externalId,
  title: `post ${externalId}`,
  content: `<p>${externalId}</p>`,
  url: `https://example.com/p/${externalId}/`,
  publishedAt: new Date(BASE + day * DAY),
})

/** A stored row published `day` days after the base date. */
const stored = (id: number, externalId: string, day: number): ExistingItem => ({
  id,
  external_id: externalId,
  published_at: BASE + day * DAY,
  asset: `${id}.jpg`,
  gallery: null,
})

test('seeds an empty feed, oldest first so ids follow chronology', () => {
  const plan = planReconcile([], [fetched('c', 3), fetched('a', 1), fetched('b', 2)], 12)
  assert.deepEqual(
    plan.creates.map((i) => i.externalId),
    ['a', 'b', 'c'],
  )
  assert.equal(plan.updates.length, 0)
  assert.equal(plan.deletes.length, 0)
})

test('refreshes items the fetch returned again without recreating them', () => {
  const plan = planReconcile(
    [stored(1, 'a', 1), stored(2, 'b', 2)],
    [fetched('a', 1), fetched('b', 2)],
    12,
  )
  assert.equal(plan.creates.length, 0)
  assert.equal(plan.deletes.length, 0)
  assert.deepEqual(
    plan.updates.map((u) => u.existing.id),
    [2, 1],
  )
})

test('keeps stored items the fetch did not return', () => {
  // The critical invariant: a short or partial response must never empty a feed.
  const existing = [stored(1, 'a', 1), stored(2, 'b', 2), stored(3, 'c', 3)]
  const plan = planReconcile(existing, [fetched('c', 3)], 12)
  assert.deepEqual(plan.deletes, [])
  assert.equal(plan.creates.length, 0)
  assert.deepEqual(
    plan.updates.map((u) => u.existing.id),
    [3],
  )
})

test('never inserts a fetched item that falls outside the cap', () => {
  // An old pinned post the platform keeps serving at the top of the timeline.
  // Naive upsert-then-prune would insert and delete it on every single cycle,
  // mirroring its image each time.
  const existing = [stored(1, 'new1', 10), stored(2, 'new2', 11)]
  const plan = planReconcile(
    existing,
    [fetched('new1', 10), fetched('new2', 11), fetched('pinned', 1)],
    2,
  )
  assert.equal(plan.creates.length, 0)
  assert.equal(plan.deletes.length, 0)
  assert.equal(plan.updates.length, 2)
})

test('prunes the oldest stored items when new ones push past the cap', () => {
  const existing = [stored(1, 'a', 1), stored(2, 'b', 2), stored(3, 'c', 3)]
  const plan = planReconcile(existing, [fetched('d', 4), fetched('e', 5)], 3)
  assert.deepEqual(
    plan.creates.map((i) => i.externalId),
    ['d', 'e'],
  )
  assert.deepEqual(
    plan.deletes.map((d) => d.external_id),
    ['a', 'b'],
  )
})

test('holds exactly the cap at the boundary', () => {
  const existing = [stored(1, 'a', 1), stored(2, 'b', 2)]
  const plan = planReconcile(existing, [fetched('c', 3)], 3)
  assert.equal(existing.length + plan.creates.length - plan.deletes.length, 3)
  assert.equal(plan.deletes.length, 0)
})

test('lowering the cap prunes down to it', () => {
  const existing = [stored(1, 'a', 1), stored(2, 'b', 2), stored(3, 'c', 3), stored(4, 'd', 4)]
  const plan = planReconcile(existing, [], 2)
  assert.deepEqual(
    plan.deletes.map((d) => d.external_id),
    ['a', 'b'],
  )
  assert.equal(plan.creates.length, 0)
})

test('an empty fetch changes nothing when the feed is already at the cap', () => {
  const existing = [stored(1, 'a', 1), stored(2, 'b', 2)]
  const plan = planReconcile(existing, [], 12)
  assert.equal(plan.creates.length, 0)
  assert.equal(plan.updates.length, 0)
  assert.equal(plan.deletes.length, 0)
})

test('deduplicates a post that appears twice in one response', () => {
  const plan = planReconcile([], [fetched('a', 1), fetched('a', 1)], 12)
  assert.equal(plan.creates.length, 1)
})
