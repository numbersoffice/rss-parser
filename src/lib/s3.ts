/**
 * S3-compatible object storage (Hetzner Object Storage) for feed item images.
 * Configured entirely through env vars filled in at deploy time; when they are
 * absent (e.g. local dev) the storage plugin is not registered and feed items
 * keep serving the platform's own CDN URLs.
 */

const trimmedEndpoint = (): string => (process.env.S3_ENDPOINT ?? '').replace(/\/+$/, '')

export const s3Enabled = (): boolean =>
  Boolean(
    process.env.S3_ENDPOINT &&
      process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY,
  )

/**
 * Public path-style URL of an object in the bucket. Pairs with
 * `forcePathStyle: true` on the S3 client so uploads and public URLs agree;
 * the bucket must allow anonymous read.
 */
export const publicS3Url = (filename: string): string =>
  `${trimmedEndpoint()}/${process.env.S3_BUCKET}/${encodeURIComponent(filename)}`

/** Whether a stored image URL already points at our bucket (vs. a platform CDN). */
export const isPublicS3Url = (url: string): boolean =>
  s3Enabled() && url.startsWith(`${trimmedEndpoint()}/${process.env.S3_BUCKET}/`)
