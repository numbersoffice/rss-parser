import type { CollectionConfig } from 'payload'

import { hiddenFromNonAdmins, isAdmin } from '@/lib/access'
import { recordDailyActivity } from '@/lib/activity'
import { relationId } from '@/lib/relations'

/**
 * Normalized cache of fetched posts. Populated by the refresh logic
 * (src/lib/refresh.ts) — treat as read-only in the admin.
 */
export const FeedItems: CollectionConfig = {
  slug: 'feed-items',
  access: {
    read: isAdmin,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  admin: {
    useAsTitle: 'title',
    hidden: hiddenFromNonAdmins,
    defaultColumns: ['title', 'source', 'publishedAt'],
    description: 'Fetched posts, kept in sync automatically — no need to edit these',
  },
  hooks: {
    // Every created item counts toward its source's daily activity row
    // (the most-active-sources widget). Counting here — the single place items
    // come into existence — rather than in the refresh logic means no create
    // path can be missed or double-counted. Creates that shouldn't count pass
    // `context.skipActivity` (the subscribe-time seed, which backfills a whole
    // feed at once).
    afterChange: [
      async ({ doc, operation, req, context }) => {
        if (operation !== 'create' || context.skipActivity) return
        const sourceId = relationId(doc.source)
        if (typeof sourceId === 'number') {
          await recordDailyActivity(req.payload, sourceId, 1, req)
        }
      },
    ],
    // Also fires per-doc for the bulk delete in Sources.beforeDelete, so a
    // source's stored images are cleaned up when it is garbage-collected.
    // Never fail the item deletion over S3 trouble (e.g. rotated credentials).
    afterDelete: [
      async ({ doc, req }) => {
        const mediaId = relationId(doc.image)
        if (!mediaId) return
        try {
          await req.payload.delete({ collection: 'media', id: mediaId, depth: 0, req })
        } catch (err) {
          req.payload.logger.warn(
            `Failed to delete stored image ${mediaId} for feed item ${doc.id}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      },
    ],
  },
  indexes: [
    {
      fields: ['source', 'externalId'],
      unique: true,
    },
  ],
  fields: [
    {
      name: 'source',
      type: 'relationship',
      relationTo: 'sources',
      required: true,
      index: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'externalId',
      type: 'text',
      required: true,
      admin: {
        position: 'sidebar',
        description: 'Id of the post on the source platform, used for deduplication',
      },
    },
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'content',
      type: 'textarea',
      admin: { description: 'HTML body of the RSS entry' },
    },
    {
      name: 'url',
      type: 'text',
      required: true,
      admin: { description: 'Permalink to the original post' },
    },
    {
      name: 'imageUrl',
      type: 'text',
      admin: { description: 'URL served in the feed — the stored copy when one exists, otherwise the platform CDN' },
    },
    {
      name: 'image',
      type: 'upload',
      relationTo: 'media',
      admin: { description: 'Stored copy of the post image; imageUrl serves its public URL' },
    },
    {
      name: 'publishedAt',
      type: 'date',
      required: true,
      index: true,
      admin: { date: { pickerAppearance: 'dayAndTime' } },
    },
  ],
}
