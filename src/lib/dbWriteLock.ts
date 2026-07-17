/**
 * In-process serialization of grouped SQLite writes.
 *
 * With the adapter's transactions disabled (see payload.config.ts), every
 * write is an autocommit statement on one shared connection, so statements
 * from concurrent tasks cannot contend for the SQLite write lock — but they
 * CAN interleave at every `await`. This lock keeps multi-statement write
 * groups (a feed reconciliation's row diff, a fetch-outcome record) from
 * interleaving with each other, so e.g. two refreshes of the same source
 * can't braid their creates and deletes together.
 *
 * Rule: never hold the lock across network I/O — prepare everything first,
 * lock only for the statements themselves.
 *
 * It also matters if transactions are ever re-enabled: libsql executes
 * statements synchronously, so two in-process connections contending for the
 * write lock deadlock until the busy timeout expires (the waiter spins inside
 * the busy handler, blocking the event loop, so the holder can never commit).
 * Serializing writers is the only cure for that; no timeout can fix it.
 * Contention from OTHER processes (the old container during a rolling deploy,
 * a stray CLI) is handled separately by the client's `timeout` option, which
 * does work cross-process because the holder's event loop keeps running.
 */

/** Tail of the chain of pending write sections. */
let chain: Promise<void> = Promise.resolve()

/** Run `fn` after every previously queued write section has finished, so at
 * most one guarded write group touches the database at a time in this process. */
export async function withDbWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn)
  // Keep the chain alive past failures — the next caller must still run.
  chain = run.then(
    () => {},
    () => {},
  )
  return run
}
