/**
 * A feed item in the shape the RSS layer understands, regardless of
 * which platform it came from.
 */
export interface NormalizedItem {
  /** Stable id on the source platform — used to dedupe/upsert. */
  externalId: string
  title: string
  /** HTML body of the RSS entry. */
  content: string
  /** Permalink to the original post. */
  url: string
  /** The platform's own image URL (may be signed/expiring); the refresh
   * logic mirrors it into our own asset directory. For a gallery this is the
   * cover (the first of `images`), so the single RSS enclosure still resolves. */
  imageUrl?: string
  /** Every image URL in the post, in order — length 1 for a normal post, more
   * for a gallery/carousel. `images[0]` equals `imageUrl`. The refresh layer
   * mirrors the cover into the item's asset columns and the rest into `gallery`;
   * the content HTML already embeds one `<img>` per entry. Absent means the
   * post carries no image (e.g. a bare caption). */
  images?: string[]
  publishedAt: Date
}

/**
 * Account-level metadata about the source itself (as opposed to its posts).
 * Currently just the profile picture, surfaced as the RSS channel image.
 */
export interface NormalizedProfile {
  /** The platform's own profile-picture URL (may be signed/expiring); the
   * refresh logic mirrors it locally like it does post images. */
  imageUrl?: string
  /** Display name for the RSS channel title, e.g. "NASA (@nasa)". */
  title?: string
  /** Account bio, used as the RSS channel description. */
  description?: string
}

/**
 * What an adapter returns for one fetch: the posts plus optional account-level
 * metadata (the profile picture). Split from a bare item array so a single
 * request can surface both.
 */
export interface NormalizedFeed {
  items: NormalizedItem[]
  profile?: NormalizedProfile
}

/**
 * The outcome of a single fetch attempt. An adapter that retries surfaces one
 * of these per try (on `debug.attempts`) so the refresh layer can record each
 * attempt as its own fetch-log row — retries then count as regular requests.
 */
export interface AttemptRecord {
  status: 'success' | 'error'
  httpStatus: number | null
  durationMs: number | null
  error: string | null
}

/**
 * All an adapter needs to know about an account. Deliberately narrower than the
 * database row, so adapters stay independent of the persistence layer.
 */
export interface AdapterSource {
  id: number
  type: string
  handle: string
}

/**
 * A fetch failure that retrying might recover — an IP-level block (401/403/429),
 * a 5xx, or a login-wall response. The adapter retries these itself on a fresh
 * proxy exit IP; if every attempt fails the refresh layer schedules a short
 * backoff, since the account itself is presumably fine.
 */
export class RetryableFetchError extends Error {}

/**
 * A fetch failure no retry can fix: the account doesn't exist, is private, or
 * the handle is unusable. The adapter gives up immediately and the refresh layer
 * backs off to once a day — never permanently, because accounts come back from
 * private and renames, and Meta occasionally 404s a live profile.
 *
 * These live here rather than inside the adapter so the refresh layer can tell
 * the two cases apart with `instanceof` and pick the right backoff.
 */
export class PermanentFetchError extends Error {
  /** Short machine-readable reason, used as the guid of the in-feed notice. */
  constructor(
    message: string,
    readonly kind: 'notfound' | 'private' | 'handle',
  ) {
    super(message)
  }
}

/**
 * The extension point of the platform. To support a new source type:
 *
 *   1. Create `src/adapters/<type>.ts` implementing this interface.
 *   2. Register it in `src/adapters/registry.ts`.
 *
 * Fetching, caching, image mirroring and RSS rendering then pick it up
 * automatically; only the feed route's URL prefix needs a line.
 */
export interface SourceAdapter {
  type: string
  /** Fetch the latest items for a source, plus optional account-level
   * metadata (the profile picture). Throw on failure — the caller records the
   * error on the source and keeps serving cached items. Record
   * request/response metadata (status, timing, headers) into `debug` as it
   * becomes available — it is logged even when the fetch throws. `maxAttempts`
   * (default 1) bounds retries for transient, IP-level blocks; each retry
   * should rotate the proxy exit IP. */
  fetchItems(
    source: AdapterSource,
    debug?: Record<string, unknown>,
    maxAttempts?: number,
  ): Promise<NormalizedFeed>
  /** Link to the account/page on the source platform. */
  sourceUrl?(source: AdapterSource): string
}
