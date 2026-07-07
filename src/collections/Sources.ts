import type { CollectionConfig } from 'payload'

import { sourceTypeOptions } from '@/adapters/registry'
import { hiddenFromNonAdmins, isAdmin, isLoggedIn } from '@/lib/access'
import { relationId } from '@/lib/relations'
import { refreshSource } from '@/lib/refresh'
import { defaultSourceName, normalizeHandle } from '@/lib/sources'

/**
 * Canonical feeds: one document per (type, handle), shared by every
 * subscriber so an account is only fetched once. Created and garbage-
 * collected automatically as users subscribe/unsubscribe — admins rarely
 * need to touch these.
 */
export const Sources: CollectionConfig = {
  slug: 'sources',
  admin: {
    useAsTitle: 'name',
    hidden: hiddenFromNonAdmins,
    defaultColumns: ['name', 'type', 'handle', 'enabled', 'lastFetchStatus', 'lastFetchedAt'],
    description:
      'Shared, one per followed account — created and removed automatically as users subscribe',
  },
  access: {
    // Authenticated read so the source relationship on subscriptions can populate.
    read: isLoggedIn,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  indexes: [{ fields: ['type', 'handle'], unique: true }],
  endpoints: [
    {
      // POST /api/sources/:id/refresh — force a fetch regardless of TTL
      path: '/:id/refresh',
      method: 'post',
      handler: async (req) => {
        if (req.user?.role !== 'admin') {
          return Response.json({ error: 'Forbidden' }, { status: req.user ? 403 : 401 })
        }
        const id = req.routeParams?.id as string
        const result = await refreshSource(req.payload, id)
        return Response.json(result, { status: result.status === 'error' ? 502 : 200 })
      },
    },
  ],
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: { description: 'Becomes the RSS channel title. Defaults to the handle.' },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'instagram',
      options: sourceTypeOptions,
      admin: { description: 'Which platform this source pulls from' },
    },
    {
      name: 'handle',
      type: 'text',
      required: true,
      admin: { description: 'Account to follow, e.g. the Instagram username (without @)' },
    },
    {
      name: 'enabled',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        position: 'sidebar',
        description: 'Kill-switch: disabled sources stop fetching and their feeds return 404',
      },
    },
    {
      name: 'refreshIntervalMinutes',
      type: 'number',
      defaultValue: 60,
      min: 5,
      admin: {
        position: 'sidebar',
        description: 'How long fetched items are considered fresh before the feed re-fetches',
      },
    },
    {
      type: 'collapsible',
      label: 'Profile picture',
      admin: {
        initCollapsed: true,
        description: 'The account avatar, served as the RSS channel image — managed automatically',
      },
      fields: [
        {
          name: 'profileImageUrl',
          type: 'text',
          admin: {
            readOnly: true,
            description:
              'URL served as the feed image — the stored copy when one exists, otherwise the platform CDN',
          },
        },
        {
          name: 'profileImage',
          type: 'upload',
          relationTo: 'media',
          admin: { readOnly: true, description: 'Stored copy of the profile picture' },
        },
      ],
    },
    {
      type: 'collapsible',
      label: 'Last fetch',
      admin: { initCollapsed: true },
      fields: [
        {
          name: 'health',
          type: 'ui',
          admin: {
            components: {
              Field: '@/components/SourceHealthBar#SourceHealthBar',
            },
          },
        },
        {
          name: 'lastFetchedAt',
          type: 'date',
          admin: { readOnly: true, date: { pickerAppearance: 'dayAndTime' } },
        },
        {
          name: 'lastFetchStatus',
          type: 'select',
          options: ['success', 'error'],
          admin: { readOnly: true },
        },
        {
          name: 'lastFetchError',
          type: 'textarea',
          admin: { readOnly: true },
        },
        {
          name: 'lastFetchDebug',
          type: 'json',
          admin: {
            readOnly: true,
            description:
              'Diagnostics from the last fetch: proxy/exit IP, HTTP status, timing, and any throttling headers. Useful for troubleshooting proxy and blocking issues.',
          },
        },
      ],
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data, operation }) => {
        if (!data) return data
        if (typeof data.handle === 'string') data.handle = normalizeHandle(data.handle)
        if (operation === 'create' && !data.name && data.type && data.handle) {
          data.name = defaultSourceName(data.type, data.handle)
        }
        return data
      },
    ],
    afterChange: [
      // Populate the feed right away when a source is created or re-pointed,
      // so the admin sees items (or an error) without waiting for a reader poll.
      async ({ doc, previousDoc, operation, req, context }) => {
        if (context.skipSourceRefresh) return
        const targetChanged =
          operation === 'create' ||
          doc.handle !== previousDoc?.handle ||
          doc.type !== previousDoc?.type
        if (doc.enabled && targetChanged) {
          await refreshSource(req.payload, doc.id)
        }
      },
    ],
    beforeDelete: [
      // Cascade before the row goes: subscriptions and feed-items reference the
      // source with NOT NULL foreign keys, so they must be gone first.
      async ({ id, req }) => {
        await req.payload.delete({
          collection: 'subscriptions',
          where: { source: { equals: id } },
          // Their afterDelete hooks must not GC this source — it's already going.
          context: { cascadeFromSource: true },
          req,
        })
        await req.payload.delete({
          collection: 'feed-items',
          where: { source: { equals: id } },
          req,
        })
        // Request logs reference the source too; drop them so they don't outlive
        // it (the source relationship is nullable, so they'd otherwise orphan).
        await req.payload.delete({
          collection: 'request-logs',
          where: { source: { equals: id } },
          req,
        })
      },
    ],
    afterDelete: [
      // Clean up the source's stored profile picture from S3. Feed-item images
      // are handled by FeedItems.afterDelete via the beforeDelete cascade above;
      // the profile image is owned by the source, so it's cleaned up here.
      // Never fail the source deletion over S3 trouble (e.g. rotated credentials).
      async ({ doc, req }) => {
        const mediaId = relationId(doc.profileImage)
        if (!mediaId) return
        try {
          await req.payload.delete({ collection: 'media', id: mediaId, depth: 0, req })
        } catch (err) {
          req.payload.logger.warn(
            `Failed to delete profile image ${mediaId} for source ${doc.id}: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      },
    ],
  },
}
