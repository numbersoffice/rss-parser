import type { Source } from '@/payload-types'

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
   * logic mirrors it into our bucket when S3 storage is configured. */
  imageUrl?: string
  publishedAt: Date
}

/**
 * Account-level metadata about the source itself (as opposed to its posts).
 * Currently just the profile picture, surfaced as the RSS channel image.
 */
export interface NormalizedProfile {
  /** The platform's own profile-picture URL (may be signed/expiring); the
   * refresh logic mirrors it into our bucket like it does post images. */
  imageUrl?: string
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
 * The extension point of the platform. To support a new source type:
 *
 *   1. Create `src/adapters/<type>.ts` implementing this interface.
 *   2. Register it in `src/adapters/registry.ts`.
 *
 * The admin `type` select, caching, refresh, and RSS rendering pick it up
 * automatically.
 */
export interface SourceAdapter {
  type: string
  /** Fetch the latest items for a source, plus optional account-level
   * metadata (the profile picture). Throw on failure — the caller records the
   * error on the source and keeps serving cached items. Record
   * request/response metadata (status, timing, headers) into `debug` as it
   * becomes available — it is stored on the source for troubleshooting even
   * when the fetch throws. */
  fetchItems(source: Source, debug?: Record<string, unknown>): Promise<NormalizedFeed>
  /** Link to the account/page on the source platform, used as the RSS channel link. */
  sourceUrl?(source: Source): string
}
