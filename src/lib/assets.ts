import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { assetsDir, assetUrl, config, tmpDir } from '../config.js'
import { describeError } from './errors.js'
import { log } from '../log.js'
import { outboundFetch } from './proxy.js'

/**
 * Local asset store — the replacement for the S3 bucket the Payload build used.
 *
 * Platform image URLs (Instagram's CDN) are signed, expire after a few days, and
 * are origin-restricted, so not every feed reader can load them. So the first
 * time we see a post we download its image once and serve it from our own
 * /assets, then put that stable URL in the feed.
 */

export interface StoredAsset {
  /** Filename under data/assets — the "already mirrored" marker in the DB. */
  filename: string
  /** Absolute public URL, as embedded in feed content. */
  url: string
  bytes: number
  mime: string
}

/**
 * One extra gallery image mirrored for a carousel post, as stored in the item's
 * `gallery` JSON column. The cover stays in the item's own asset columns; this
 * covers the second image onward.
 */
export interface GalleryAsset {
  /** Filename under data/assets. */
  asset: string
  bytes: number
  mime: string
  /** The CDN URL this file was mirrored from, so a later refresh can rewrite it
   * in the content and recognise the child as already mirrored. */
  imageUrl: string
}

/**
 * Asset filenames referenced by an item's `gallery` JSON column. Tolerant of
 * null/legacy/malformed values — a bad blob simply yields no names, so the
 * orphan sweep and delete cascade never throw on one.
 */
export function galleryAssetNames(json: string | null | undefined): string[] {
  return parseGallery(json).map((entry) => entry.asset)
}

/** Parse a `gallery` JSON column into records, defensively. */
export function parseGallery(json: string | null | undefined): GalleryAsset[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is GalleryAsset =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as GalleryAsset).asset === 'string',
    )
  } catch {
    return []
  }
}

/**
 * Extension for a stored image. This matters more than it looks: `express.static`
 * derives Content-Type from the file extension, so a webp body saved as `.jpg`
 * is served as `image/jpeg` and some readers refuse to render it. (The S3 build
 * got away with a hardcoded `.jpg` because it stored the mimetype separately.)
 * Instagram serves both jpeg and webp.
 */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/avif': '.avif',
}

const extensionFor = (mime: string): string => EXTENSIONS[mime] ?? '.jpg'

/** Reject anything that could escape the assets directory or a URL path. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,80}$/

export function isSafeAssetName(name: string): boolean {
  return SAFE_SEGMENT.test(name) && name !== '.' && name !== '..'
}

export const assetPath = (filename: string): string => path.join(assetsDir, filename)

/**
 * Download an image and store it under data/assets, returning the stable public
 * URL. Throws on failure so callers can decide how to degrade — every caller
 * degrades to the raw CDN URL and retries on a later refresh.
 *
 * Writes to a temp file and renames into place, so a crashed or truncated
 * download is never visible under /assets.
 */
export async function storeImage(url: string, baseName: string): Promise<StoredAsset> {
  const res = await fetchImage(url)
  if (!res.ok) {
    throw new Error(`image request returned ${res.status}`)
  }

  const mime = res.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || 'image/jpeg'
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > config.maxImageBytes) {
    throw new Error(`image is ${declared} bytes, over the ${config.maxImageBytes} limit`)
  }

  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.byteLength > config.maxImageBytes) {
    throw new Error(`image is ${bytes.byteLength} bytes, over the ${config.maxImageBytes} limit`)
  }
  if (bytes.byteLength === 0) {
    throw new Error('image response was empty')
  }

  const filename = `${baseName}${extensionFor(mime)}`
  if (!isSafeAssetName(filename)) {
    throw new Error(`refusing to write unsafe asset name "${filename}"`)
  }

  const target = assetPath(filename)
  // A retried mirror can land on a name that already exists (same post, same
  // content-type). Measure what's being replaced so the running total swaps the
  // sizes instead of counting the file twice.
  const replaced = await fileSize(target)

  const temp = path.join(tmpDir, randomBytes(12).toString('hex'))
  await fs.writeFile(temp, bytes)
  await fs.rename(temp, target)

  if (replaced === null) {
    usage.files++
    usage.bytes += bytes.byteLength
  } else {
    usage.bytes += bytes.byteLength - replaced
  }

  return { filename, url: assetUrl(filename), bytes: bytes.byteLength, mime }
}

/** Size of a file, or null if it isn't there. */
async function fileSize(file: string): Promise<number | null> {
  try {
    const stat = await fs.stat(file)
    return stat.isFile() ? stat.size : null
  } catch {
    return null
  }
}

/**
 * Fetch an image, honouring `config.imageFetch`. Images are the bulk of our
 * outbound bytes, and the CDN generally serves signed URLs to any IP, so the
 * default tries direct first and only falls back to the metered proxy.
 */
async function fetchImage(url: string): Promise<Response> {
  const timeout = () => AbortSignal.timeout(20_000)

  if (config.imageFetch === 'proxy') {
    return outboundFetch(url, { signal: timeout() })
  }
  if (config.imageFetch === 'direct') {
    return fetch(url, { signal: timeout() })
  }

  try {
    const res = await fetch(url, { signal: timeout() })
    if (res.ok) {
      log.debug('image fetched', { via: 'direct' })
      return res
    }
    log.debug('image direct fetch rejected, retrying via proxy', { status: res.status })
  } catch (err) {
    log.debug('image direct fetch failed, retrying via proxy', { error: describeError(err) })
  }
  log.debug('image fetched', { via: 'proxy' })
  return outboundFetch(url, { signal: timeout() })
}

/**
 * Stable asset base name for a post image, keyed by (source, post, index).
 * `index` 0/undefined yields the historical `${sourceId}-${externalId}` name —
 * the gallery cover, so existing single-image files keep their filenames — and
 * each further carousel child appends `-${index}`.
 */
export const postAssetName = (sourceId: number, externalId: string, index = 0): string => {
  const base = `${sourceId}-${sanitize(externalId)}`
  return index > 0 ? `${base}-${index}` : base
}

/**
 * Profile pictures are content-hashed rather than named after the source, so the
 * URL is genuinely immutable and a changed avatar gets a new filename instead of
 * silently serving a stale cached image.
 */
export const profileAssetName = (sourceId: number, url: string): string =>
  `${sourceId}-profile-${createHash('sha256').update(url).digest('hex').slice(0, 8)}`

const sanitize = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '') || 'x'

/** Remove stored files. Best-effort: a missing file is already the goal. */
export async function unlinkAssets(filenames: Iterable<string>): Promise<number> {
  let removed = 0
  for (const filename of filenames) {
    if (!isSafeAssetName(filename)) continue
    const file = assetPath(filename)
    // Measure before removing — afterwards the size is gone with the file.
    const size = await fileSize(file)
    try {
      await fs.unlink(file)
      removed++
      if (size !== null) {
        usage.files--
        usage.bytes -= size
      }
    } catch (err) {
      if ((err as { code?: string }).code !== 'ENOENT') {
        log.debug('could not unlink asset', { filename, error: describeError(err) })
      }
    }
  }
  return removed
}

export interface AssetUsage {
  files: number
  bytes: number
}

/**
 * How much disk the mirrored images take, maintained as a running total.
 *
 * Only two things change this directory — a refresh storing an image and a
 * delete removing one — and both go through this module, so the total is
 * adjusted at those two points and nowhere else. Reading it never touches the
 * filesystem, which keeps the index page's cost independent of how many images
 * are stored.
 *
 * It counts what is actually on disk rather than summing the `asset_bytes`
 * recorded against posts: profile pictures carry no byte count, and orphans
 * awaiting the next sweep occupy real space even though no row points at them.
 */
const usage: AssetUsage = { files: 0, bytes: 0 }

/** The current total. Synchronous — it is already in memory. */
export function assetUsage(): AssetUsage {
  return { ...usage }
}

/**
 * Walk the directory and reset the running total to the truth.
 *
 * Called once at boot, since the total lives in memory and starts at zero, and
 * again from the daily sweep — which is the backstop for any drift, e.g. a file
 * removed out from under us or an unlink that failed after its size was already
 * deducted. Between those, the incremental adjustments carry it.
 */
export async function recomputeAssetUsage(): Promise<AssetUsage> {
  let files = 0
  let bytes = 0
  try {
    for (const entry of await fs.readdir(assetsDir, { withFileTypes: true })) {
      // Nothing here creates subdirectories — names are sanitised so they can't
      // contain a separator — but this is a mounted volume, and adding a
      // directory's own size to an image total would just be wrong.
      if (!entry.isFile()) continue
      const size = await fileSize(path.join(assetsDir, entry.name))
      if (size === null) continue // swept between the readdir and the stat
      files++
      bytes += size
    }
  } catch (err) {
    log.warn('could not measure asset usage', { error: describeError(err) })
    return { ...usage }
  }

  usage.files = files
  usage.bytes = bytes
  return { ...usage }
}

/** Leftover temp files from a crashed download. */
export async function clearTmp(): Promise<void> {
  try {
    for (const entry of await fs.readdir(tmpDir)) {
      await fs.unlink(path.join(tmpDir, entry)).catch(() => {})
    }
  } catch {
    // Directory missing is fine — initDb creates it.
  }
}
