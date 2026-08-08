import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createRefreshQueue, type RefreshCandidate } from './refreshQueue.js'
import type { RefreshResult } from './refresh.js'

const ok: RefreshResult = {
  status: 'success',
  itemCount: 0,
  created: 0,
  updated: 0,
  deleted: 0,
  mirrored: 0,
  httpStatus: 200,
  durationMs: 1,
}

/** A source due for a refresh right now. */
const due = (id: number): RefreshCandidate => ({ id, handle: `h${id}`, next_fetch_at: 0 })

/** Wait for the coordinator's serial chain to drain. */
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test('a due source is refreshed exactly once', async () => {
  const calls: number[] = []
  const queue = createRefreshQueue(async (id) => {
    calls.push(id)
    return ok
  })

  queue.request(due(1))
  await settle()

  assert.deepEqual(calls, [1])
  assert.equal(queue.busy, 0)
})

test('a repeat trigger while in flight is deduped', async () => {
  const calls: number[] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const queue = createRefreshQueue(async (id) => {
    calls.push(id)
    await gate
    return ok
  })

  queue.request(due(1))
  // Still running (blocked on the gate): further triggers for the same id no-op.
  queue.request(due(1))
  queue.request(due(1))
  assert.equal(queue.busy, 1)

  release()
  await settle()

  assert.deepEqual(calls, [1])
  assert.equal(queue.busy, 0)
})

test('a source not yet due is skipped unless forced', async () => {
  const calls: number[] = []
  const queue = createRefreshQueue(async (id) => {
    calls.push(id)
    return ok
  })

  const notDue: RefreshCandidate = { id: 7, handle: 'h7', next_fetch_at: Date.now() + 60_000 }
  queue.request(notDue)
  await settle()
  assert.deepEqual(calls, [], 'due-check gates the trigger')

  queue.request(notDue, true)
  await settle()
  assert.deepEqual(calls, [7], 'force bypasses the due-check')
})

test('two sources triggered together run serially, not concurrently', async () => {
  const events: string[] = []
  let inside = 0
  const queue = createRefreshQueue(async (id) => {
    inside++
    assert.equal(inside, 1, 'never more than one refresh in flight')
    events.push(`start-${id}`)
    await settle()
    events.push(`end-${id}`)
    inside--
    return ok
  })

  queue.request(due(1))
  queue.request(due(2))
  assert.equal(queue.busy, 2)

  // Drain both runs off the chain.
  await settle()
  await settle()
  await settle()

  assert.deepEqual(events, ['start-1', 'end-1', 'start-2', 'end-2'])
  assert.equal(queue.busy, 0)
})
