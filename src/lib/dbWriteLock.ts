/**
 * In-process serialization of SQLite writes.
 *
 * libsql's native driver executes statements synchronously on the JS thread,
 * and @libsql/client opens a dedicated connection per transaction. When two
 * writers in THIS process contend for the write lock, the loser spins inside
 * SQLite's busy handler — blocking the event loop — so the holder can never
 * reach its COMMIT: the loser always burns the full busy timeout and then
 * fails with SQLITE_BUSY anyway. No busy timeout can fix that; the only cure
 * is to not contend in the first place.
 *
 * So every recurring writer (the storeItems reconciliation transaction, the
 * image-mirror job's updates, fetch-outcome records) takes this lock around
 * its DB writes. Rule: never hold the lock across network I/O — prepare
 * everything first, lock only for the statements themselves.
 *
 * Contention from OTHER processes (the old container during a rolling deploy,
 * a stray CLI) is handled separately by the client's `timeout` option (see
 * payload.config.ts), which does work cross-process because the holder's
 * event loop keeps running.
 */

/** Tail of the chain of pending write sections. */
let chain: Promise<void> = Promise.resolve()

/** Run `fn` after every previously queued write section has finished, so at
 * most one guarded writer touches the database at a time in this process. */
export async function withDbWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn)
  // Keep the chain alive past failures — the next caller must still run.
  chain = run.then(
    () => {},
    () => {},
  )
  return run
}
