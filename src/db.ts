import fs from 'node:fs'
import Database from 'better-sqlite3'

import { assetsDir, config, dbFile, tmpDir } from './config.js'
import { dayKey } from './lib/activity.js'
import { galleryAssetNames } from './lib/assets.js'
import { log } from './log.js'

/**
 * The whole persistence layer: schema, prepared statements, and every query the
 * app runs. There is no migration framework — the schema is created with
 * `IF NOT EXISTS` at boot, which is all a four-table database needs.
 *
 * `better-sqlite3` is synchronous and this is a single process, so transactions
 * are safe here. (The Payload build this replaced had to disable them: libsql's
 * async driver plus Payload's transaction wrapper deadlocked into deterministic
 * SQLITE_BUSY failures. That constraint is gone — and the library refuses to let
 * a transaction body await anything, which turns "do all network I/O before the
 * write phase" from a convention into an enforced one.)
 */

export interface SourceRow {
  id: number
  type: string
  handle: string
  /** RSS channel title — the account's display name once fetched. */
  name: string
  /** RSS channel description — the account bio once fetched. */
  description: string | null
  /** Absolute URL: our own /assets/… once mirrored, else the platform CDN URL. */
  profile_image_url: string | null
  /** Filename under data/assets. Non-null is the "already mirrored" test. */
  profile_asset: string | null
  /** When this account is next due a fetch. The scheduling column. */
  next_fetch_at: number
  last_fetched_at: number | null
  last_success_at: number | null
  /**
   * The first fetch that returned posts — when we started observing this feed.
   * It is the origin of the posts-per-day denominator, so that a feed added
   * yesterday isn't averaged over the whole retention window.
   */
  first_success_at: number | null
  last_fetch_status: 'success' | 'error' | null
  last_fetch_error: string | null
  last_fetch_http_status: number | null
  last_fetch_duration_ms: number | null
  consecutive_failures: number
  /** Non-retryable reason the account can't be fetched (private, gone), else null. */
  permanent_error: string | null
  permanent_error_kind: string | null
  permanent_error_at: number | null
  /**
   * Bumped only when the feed body actually changes. This is what makes cheap
   * conditional requests possible: it drives both the ETag and the RSS
   * `<lastBuildDate>`, so a reader polling an unchanged feed gets a 304 and we
   * never even build the XML.
   */
  updated_at: number
  created_at: number
}

export interface ItemRow {
  id: number
  source_id: number
  external_id: string
  title: string
  content: string
  url: string
  image_url: string | null
  asset: string | null
  asset_bytes: number | null
  asset_mime: string | null
  /** Extra gallery images (second onward) as a JSON array of GalleryAsset, or
   * null for a single-image post. The cover stays in the asset columns above. */
  gallery: string | null
  published_at: number
}

/** The fields a refresh writes for one item. */
export interface ItemData {
  external_id: string
  title: string
  content: string
  url: string
  image_url: string | null
  asset: string | null
  asset_bytes: number | null
  asset_mime: string | null
  gallery: string | null
  published_at: number
}

export interface FetchLogEntry {
  source_id: number
  fetch_id: string
  attempt: number
  status: 'success' | 'error'
  error: string | null
  http_status: number | null
  duration_ms: number | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'instagram',
  handle TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  profile_image_url TEXT,
  profile_asset TEXT,
  next_fetch_at INTEGER NOT NULL,
  last_fetched_at INTEGER,
  last_success_at INTEGER,
  first_success_at INTEGER,
  last_fetch_status TEXT CHECK (last_fetch_status IN ('success', 'error')),
  last_fetch_error TEXT,
  last_fetch_http_status INTEGER,
  last_fetch_duration_ms INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  permanent_error TEXT,
  permanent_error_kind TEXT,
  permanent_error_at INTEGER,
  updated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (type, handle)
);

CREATE INDEX IF NOT EXISTS sources_next_fetch ON sources (next_fetch_at);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  url TEXT NOT NULL,
  image_url TEXT,
  asset TEXT,
  asset_bytes INTEGER,
  asset_mime TEXT,
  gallery TEXT,
  published_at INTEGER NOT NULL,
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS items_source_published ON items (source_id, published_at DESC);

CREATE TABLE IF NOT EXISTS fetch_log (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL,
  fetch_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  http_status INTEGER,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS fetch_log_created ON fetch_log (created_at);

-- New posts seen per feed per day. Sparse: a day with no new posts gets no row,
-- so the averaging has to take its denominator from elapsed time rather than
-- from how many rows exist (see lib/activity.ts).
CREATE TABLE IF NOT EXISTS daily_posts (
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (source_id, day)
);

CREATE INDEX IF NOT EXISTS daily_posts_day ON daily_posts (day);

CREATE TABLE IF NOT EXISTS job_runs (
  name TEXT PRIMARY KEY,
  last_run_at INTEGER NOT NULL,
  last_status TEXT,
  last_ms INTEGER
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

let database: Database.Database | undefined

/**
 * Open (creating if needed) the database, apply the schema, and reconcile the
 * stored asset URLs with the configured origin. Call once at boot.
 */
export function initDb(): Database.Database {
  if (database) return database

  fs.mkdirSync(assetsDir, { recursive: true })
  fs.mkdirSync(tmpDir, { recursive: true })
  const db = new Database(dbFile)

  // WAL so a reader serving a feed never blocks the refresh writing one.
  db.pragma('journal_mode = WAL')
  // Safe under WAL: the worst case is losing the last transaction, never
  // corruption — and everything here is re-fetchable anyway.
  db.pragma('synchronous = NORMAL')
  db.pragma('busy_timeout = 5000')
  db.pragma('foreign_keys = ON')
  db.pragma('temp_store = MEMORY')
  db.pragma('cache_size = -4000') // 4 MB; the database is a few MB at most
  db.exec(SCHEMA)

  database = db
  addMissingColumns()
  rewriteBaseUrlIfChanged()
  return db
}

/**
 * `CREATE TABLE IF NOT EXISTS` is a no-op on a database that already exists, so
 * a column added to SCHEMA after the fact would never appear on a live install.
 * Adding them explicitly keeps the schema evolvable without a migration
 * framework — for a handful of tables that is the whole of what one would buy.
 *
 * Only additive, nullable columns belong here. Anything that needs backfilling
 * or rewriting is a different problem and should be written as such.
 */
function addMissingColumns(): void {
  const columns: [table: string, column: string, decl: string][] = [
    ['sources', 'first_success_at', 'INTEGER'],
    ['items', 'gallery', 'TEXT'],
  ]
  for (const [table, column, decl] of columns) {
    const existing = database!
      .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => row.name)
    if (existing.includes(column)) continue
    database!.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`)
    log.info('added missing column', { table, column })
  }
}

/** Flush the WAL and close cleanly. Called on SIGTERM/SIGINT. */
export function closeDb(): void {
  if (!database) return
  try {
    database.pragma('optimize')
    database.pragma('wal_checkpoint(TRUNCATE)')
    database.close()
  } finally {
    database = undefined
  }
}

export function optimizeDb(): void {
  db().pragma('optimize')
}

function db(): Database.Database {
  if (!database) throw new Error('Database not initialised — call initDb() first')
  return database
}

// --- meta ------------------------------------------------------------------

function getMeta(key: string): string | undefined {
  return db().prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?').get(key)
    ?.value
}

function setMeta(key: string, value: string): void {
  db()
    .prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value)
}

/**
 * Item content HTML has to carry absolute image URLs (feed readers can't resolve
 * relative ones), which means the configured origin is baked into stored rows.
 * If it changes — a new domain, or just moving from localhost to production —
 * rewrite the stored URLs once rather than serving dead links or re-downloading
 * every image through the metered proxy.
 */
function rewriteBaseUrlIfChanged(): void {
  const stored = getMeta('public_base_url')
  const current = config.publicBaseUrl
  if (stored === current) return
  if (stored === undefined) {
    setMeta('public_base_url', current)
    return
  }

  const from = `${stored}/assets/`
  const to = `${current}/assets/`
  const changed = db().transaction(() => {
    const items = db()
      .prepare(
        `UPDATE items
            SET content = replace(content, ?, ?),
                image_url = replace(image_url, ?, ?)
          WHERE instr(content, ?) > 0 OR instr(coalesce(image_url, ''), ?) > 0`,
      )
      .run(from, to, from, to, from, from)
    const sources = db()
      .prepare(
        `UPDATE sources SET profile_image_url = replace(profile_image_url, ?, ?)
          WHERE instr(coalesce(profile_image_url, ''), ?) > 0`,
      )
      .run(from, to, from)
    // Feed bodies changed, so every ETag must too.
    if (items.changes > 0 || sources.changes > 0) {
      db().prepare('UPDATE sources SET updated_at = ?').run(Date.now())
    }
    setMeta('public_base_url', current)
    return { items: items.changes, sources: sources.changes }
  })()

  log.info('rewrote stored asset URLs for new origin', {
    from: stored,
    to: current,
    items: changed.items,
    sources: changed.sources,
  })
}

// --- sources ---------------------------------------------------------------

export function listSources(): SourceRow[] {
  return db().prepare<[], SourceRow>('SELECT * FROM sources ORDER BY handle').all()
}

export function findSource(type: string, handle: string): SourceRow | undefined {
  return db()
    .prepare<[string, string], SourceRow>('SELECT * FROM sources WHERE type = ? AND handle = ?')
    .get(type, handle)
}

export function getSource(id: number): SourceRow | undefined {
  return db().prepare<[number], SourceRow>('SELECT * FROM sources WHERE id = ?').get(id)
}

/** A brand-new account is due immediately — it has no items to serve yet. */
export function insertSource(type: string, handle: string): SourceRow {
  const now = Date.now()
  const info = db()
    .prepare(
      `INSERT INTO sources (type, handle, name, next_fetch_at, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(type, handle, `@${handle}`, now, now, now)
  return getSource(Number(info.lastInsertRowid))!
}

/**
 * Delete a source and its items, returning every asset filename that is now
 * unreferenced so the caller can unlink the files. Rows go first and files
 * second, so a crash in between leaves orphan files (which sweep-assets
 * reclaims) rather than rows pointing at missing images.
 */
export function deleteSource(id: number): string[] {
  const assets = db()
    .prepare<[number], { asset: string }>(
      'SELECT asset FROM items WHERE source_id = ? AND asset IS NOT NULL',
    )
    .all(id)
    .map((row) => row.asset)
  // Carousel children too, so removing an account unlinks its whole gallery.
  for (const row of db()
    .prepare<[number], { gallery: string }>(
      'SELECT gallery FROM items WHERE source_id = ? AND gallery IS NOT NULL',
    )
    .all(id)) {
    assets.push(...galleryAssetNames(row.gallery))
  }
  const source = getSource(id)
  if (source?.profile_asset) assets.push(source.profile_asset)

  db().transaction(() => {
    // Explicit, so the cascade doesn't depend on the foreign_keys pragma.
    db().prepare('DELETE FROM items WHERE source_id = ?').run(id)
    db().prepare('DELETE FROM fetch_log WHERE source_id = ?').run(id)
    db().prepare('DELETE FROM daily_posts WHERE source_id = ?').run(id)
    db().prepare('DELETE FROM sources WHERE id = ?').run(id)
  })()

  return assets
}

/** Accounts due a fetch, most overdue first. */
export function dueSources(limit: number): SourceRow[] {
  return db()
    .prepare<[number], SourceRow>(
      `SELECT * FROM sources WHERE next_fetch_at <= ?
        ORDER BY next_fetch_at ASC
        LIMIT ${Math.max(1, Math.trunc(limit))}`,
    )
    .all(Date.now())
}

// --- items -----------------------------------------------------------------

export function listItems(sourceId: number): ItemRow[] {
  return db()
    .prepare<[number], ItemRow>(
      'SELECT * FROM items WHERE source_id = ? ORDER BY published_at DESC',
    )
    .all(sourceId)
}

export function listItemsForFeed(sourceId: number, limit: number): ItemRow[] {
  return db()
    .prepare<[number, number], ItemRow>(
      'SELECT * FROM items WHERE source_id = ? ORDER BY published_at DESC LIMIT ?',
    )
    .all(sourceId, limit)
}

export function countItemsBySource(): Map<number, number> {
  const rows = db()
    .prepare<[], { source_id: number; count: number }>(
      'SELECT source_id, COUNT(*) AS count FROM items GROUP BY source_id',
    )
    .all()
  return new Map(rows.map((row) => [row.source_id, row.count]))
}

export function countItems(sourceId: number): number {
  return (
    db()
      .prepare<[number], { count: number }>(
        'SELECT COUNT(*) AS count FROM items WHERE source_id = ?',
      )
      .get(sourceId)?.count ?? 0
  )
}

// --- the refresh write phase ------------------------------------------------

export interface SourceOutcome {
  status: 'success' | 'error'
  error: string | null
  httpStatus: number | null
  durationMs: number | null
  nextFetchAt: number
  consecutiveFailures: number
  permanentError: string | null
  permanentErrorKind: string | null
  /** Present only when the fetch resolved one, so a failure never blanks it. */
  name?: string
  description?: string | null
  profileImageUrl?: string | null
  profileAsset?: string | null
  /** True when the feed body changed and every cached ETag must be invalidated. */
  bumpUpdatedAt: boolean
  /**
   * New posts to attribute to today. Zero on a failure, and zero for the first
   * successful fetch of a feed — that one seeds a whole feed at once, which is a
   * backfill rather than a day's posting (see refresh.ts).
   */
  newPosts: number
}

/**
 * Apply one refresh — the item diff, the source's new state, and the per-attempt
 * fetch log — as a single synchronous transaction. A reader polling the feed
 * can therefore never observe a partially applied item set.
 */
export function commitRefresh(
  sourceId: number,
  diff: { updates: { id: number; data: ItemData }[]; deletes: number[]; creates: ItemData[] },
  outcome: SourceOutcome,
  attempts: FetchLogEntry[],
): void {
  const update = db().prepare(
    `UPDATE items SET title = @title, content = @content, url = @url,
       image_url = @image_url, asset = @asset, asset_bytes = @asset_bytes,
       asset_mime = @asset_mime, gallery = @gallery, published_at = @published_at
     WHERE id = @id`,
  )
  const remove = db().prepare('DELETE FROM items WHERE id = ?')
  const create = db().prepare(
    `INSERT INTO items (source_id, external_id, title, content, url, image_url,
       asset, asset_bytes, asset_mime, gallery, published_at)
     VALUES (@source_id, @external_id, @title, @content, @url, @image_url,
       @asset, @asset_bytes, @asset_mime, @gallery, @published_at)`,
  )
  const logAttempt = db().prepare(
    `INSERT INTO fetch_log (source_id, fetch_id, attempt, status, error, http_status, duration_ms, created_at)
     VALUES (@source_id, @fetch_id, @attempt, @status, @error, @http_status, @duration_ms, @created_at)`,
  )
  // A single atomic statement, unlike the read-then-write upsert this replaces:
  // two refreshes landing on the same day can't lose an increment between them.
  const countPosts = db().prepare(
    `INSERT INTO daily_posts (source_id, day, count) VALUES (?, ?, ?)
     ON CONFLICT (source_id, day) DO UPDATE SET count = count + excluded.count`,
  )

  const now = Date.now()
  const setsProfile = outcome.profileImageUrl !== undefined
  const setsName = outcome.name !== undefined
  const updateSource = db().prepare(
    `UPDATE sources SET
       last_fetched_at = @now,
       last_fetch_status = @status,
       last_fetch_error = @error,
       last_fetch_http_status = @httpStatus,
       last_fetch_duration_ms = @durationMs,
       next_fetch_at = @nextFetchAt,
       consecutive_failures = @consecutiveFailures,
       permanent_error = @permanentError,
       permanent_error_kind = @permanentErrorKind,
       permanent_error_at = CASE
         WHEN @permanentError IS NULL THEN NULL
         WHEN permanent_error_at IS NULL THEN @now
         ELSE permanent_error_at END,
       last_success_at = CASE WHEN @status = 'success' THEN @now ELSE last_success_at END,
       first_success_at = CASE
         WHEN @status = 'success' AND first_success_at IS NULL THEN @now
         ELSE first_success_at END,
       updated_at = CASE WHEN @bump = 1 THEN @now ELSE updated_at END
       ${setsName ? ', name = @name, description = @description' : ''}
       ${setsProfile ? ', profile_image_url = @profileImageUrl, profile_asset = @profileAsset' : ''}
     WHERE id = @id`,
  )

  db().transaction(() => {
    for (const { id, data } of diff.updates) update.run({ ...data, id })
    for (const id of diff.deletes) remove.run(id)
    for (const data of diff.creates) create.run({ ...data, source_id: sourceId })

    updateSource.run({
      id: sourceId,
      now,
      status: outcome.status,
      error: outcome.error,
      httpStatus: outcome.httpStatus,
      durationMs: outcome.durationMs,
      nextFetchAt: outcome.nextFetchAt,
      consecutiveFailures: outcome.consecutiveFailures,
      permanentError: outcome.permanentError,
      permanentErrorKind: outcome.permanentErrorKind,
      bump: outcome.bumpUpdatedAt ? 1 : 0,
      ...(setsName ? { name: outcome.name, description: outcome.description ?? null } : {}),
      ...(setsProfile
        ? {
            profileImageUrl: outcome.profileImageUrl ?? null,
            profileAsset: outcome.profileAsset ?? null,
          }
        : {}),
    })

    for (const attempt of attempts) logAttempt.run({ ...attempt, created_at: now })

    // Riding the same transaction as the item inserts means the count can never
    // drift from the rows it counts.
    if (outcome.newPosts > 0) countPosts.run(sourceId, dayKey(now), outcome.newPosts)
  })()
}

// --- daily post counts -----------------------------------------------------

/** New posts per source since `fromDay` (inclusive), for the index page. */
export function postsInWindowBySource(fromDay: string): Map<number, number> {
  const rows = db()
    .prepare<[string], { source_id: number; total: number }>(
      'SELECT source_id, SUM(count) AS total FROM daily_posts WHERE day >= ? GROUP BY source_id',
    )
    .all(fromDay)
  return new Map(rows.map((row) => [row.source_id, row.total]))
}

/** New posts for one source since `fromDay` (inclusive). */
export function postsInWindow(sourceId: number, fromDay: string): number {
  return (
    db()
      .prepare<[number, string], { total: number | null }>(
        'SELECT SUM(count) AS total FROM daily_posts WHERE source_id = ? AND day >= ?',
      )
      .get(sourceId, fromDay)?.total ?? 0
  )
}

/** Drop day buckets that have fallen out of the retention window. `day` is a
 * fixed-width YYYY-MM-DD string, so a lexicographic compare is a date compare. */
export function pruneDailyPostsBefore(fromDay: string): number {
  return db().prepare('DELETE FROM daily_posts WHERE day < ?').run(fromDay).changes
}

// --- fetch log -------------------------------------------------------------

export function pruneFetchLogBefore(cutoff: number): number {
  return db().prepare('DELETE FROM fetch_log WHERE created_at < ?').run(cutoff).changes
}

// --- job bookkeeping -------------------------------------------------------

/**
 * Job schedules are persisted rather than kept in memory: with an in-memory
 * timestamp, a container that restarts every few hours would run the "daily"
 * jobs every few hours.
 */
export function lastJobRun(name: string): number | undefined {
  return db()
    .prepare<[string], { last_run_at: number }>('SELECT last_run_at FROM job_runs WHERE name = ?')
    .get(name)?.last_run_at
}

export function recordJobRun(name: string, status: string, ms: number): void {
  db()
    .prepare(
      `INSERT INTO job_runs (name, last_run_at, last_status, last_ms) VALUES (?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET
         last_run_at = excluded.last_run_at,
         last_status = excluded.last_status,
         last_ms = excluded.last_ms`,
    )
    .run(name, Date.now(), status, Math.round(ms))
}

// --- assets ----------------------------------------------------------------

/** Every asset filename any row still references, for the orphan sweep. */
export function referencedAssets(): Set<string> {
  const items = db()
    .prepare<[], { asset: string }>('SELECT asset FROM items WHERE asset IS NOT NULL')
    .all()
  // Gallery children live in a JSON column, so they can't be filtered in SQL —
  // pull every non-null blob and expand it. Kept separate from the cover query
  // so a legacy/empty gallery adds nothing.
  const galleries = db()
    .prepare<[], { gallery: string }>('SELECT gallery FROM items WHERE gallery IS NOT NULL')
    .all()
  const profiles = db()
    .prepare<[], { profile_asset: string }>(
      'SELECT profile_asset FROM sources WHERE profile_asset IS NOT NULL',
    )
    .all()
  return new Set([
    ...items.map((r) => r.asset),
    ...galleries.flatMap((r) => galleryAssetNames(r.gallery)),
    ...profiles.map((r) => r.profile_asset),
  ])
}
