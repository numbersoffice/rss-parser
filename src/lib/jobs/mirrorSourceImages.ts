import type { TaskConfig } from 'payload'

import { withDbWriteLock } from '@/lib/dbWriteLock'
import { describeError, mirrorImageUrl, resolveProfileImage } from '@/lib/refresh'
import { isPublicS3Url, s3Enabled } from '@/lib/s3'
import type { Source } from '@/payload-types'

/** Mirror at most this many images concurrently — enough to be quick without
 * hammering the metered residential proxy. */
const CONCURRENCY = 4

/**
 * Background task: mirror a source's not-yet-stored images into our bucket.
 *
 * Subscribing seeds a new source's feed-items fast, with the platform's raw CDN
 * URLs and no stored image (see storeItems `{ mirrorImages: false }`), so the
 * save returns without a dozen sequential proxy downloads + S3 uploads. This
 * task, enqueued right after and kicked off promptly, does that mirroring out of
 * band. It only touches items still on a CDN URL, so it's idempotent and safe to
 * re-run (retries, the feed-route drain, or the ordinary refresh backfill).
 */
export const mirrorSourceImagesTask: TaskConfig<'mirrorSourceImages'> = {
  slug: 'mirrorSourceImages',
  inputSchema: [{ name: 'sourceId', type: 'number', required: true }],
  handler: async ({ input, req }) => {
    const { payload } = req
    const sourceId = input.sourceId
    if (!s3Enabled()) return { output: { mirrored: 0 } }

    const source = (await payload
      .findByID({ collection: 'sources', id: sourceId, depth: 0 })
      .catch(() => null)) as Source | null
    if (!source) return { output: { mirrored: 0 } }

    // Items not yet mirrored (no stored image) that still carry a CDN URL.
    const { docs } = await payload.find({
      collection: 'feed-items',
      where: {
        and: [
          { source: { equals: sourceId } },
          { image: { exists: false } },
          { imageUrl: { exists: true } },
        ],
      },
      limit: 100,
      depth: 0,
    })
    const pending = docs.filter((it) => it.imageUrl && !isPublicS3Url(it.imageUrl))

    let mirrored = 0
    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY)
      await Promise.all(
        batch.map(async (it) => {
          try {
            const result = await mirrorImageUrl(payload, source, {
              imageUrl: it.imageUrl!,
              externalId: it.externalId,
              content: it.content ?? '',
            })
            // The download/upload above ran unguarded; only the row write
            // itself takes the lock (see dbWriteLock.ts).
            await withDbWriteLock(() =>
              payload.update({
                collection: 'feed-items',
                id: it.id,
                data: { imageUrl: result.imageUrl, image: result.image, content: result.content },
                depth: 0,
              }),
            )
            mirrored++
          } catch (err) {
            // Leave it on the CDN URL — a later run (or refresh) retries.
            payload.logger.warn(
              `mirrorSourceImages: could not mirror item ${it.id} of source "${source.name}": ${describeError(err)}`,
            )
          }
        }),
      )
    }

    // Also mirror the source's profile picture if it's still on a CDN URL (it
    // was seeded raw at subscribe). resolveProfileImage no-ops once it's stored.
    if (source.profileImageUrl && !isPublicS3Url(source.profileImageUrl)) {
      const profileFields = await resolveProfileImage(payload, source, source.profileImageUrl, true)
      if (profileFields.profileImage) {
        await withDbWriteLock(() =>
          payload.update({
            collection: 'sources',
            id: source.id,
            data: profileFields,
            depth: 0,
            context: { skipSourceRefresh: true },
          }),
        )
      }
    }

    return { output: { mirrored } }
  },
}
