import type { CollectionConfig } from 'payload'

import { sourceTypeOptions } from '@/adapters/registry'
import { refreshSource } from '@/lib/refresh'

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const Sources: CollectionConfig = {
  slug: 'sources',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'type', 'handle', 'enabled', 'lastFetchStatus', 'lastFetchedAt'],
    description: 'Each source becomes an RSS feed at /feeds/{slug}',
  },
  endpoints: [
    {
      // POST /api/sources/:id/refresh — force a fetch regardless of TTL
      path: '/:id/refresh',
      method: 'post',
      handler: async (req) => {
        if (!req.user) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
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
      admin: { description: 'Display name — becomes the RSS channel title' },
    },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Used in the feed URL. Generated from the name if left empty.',
      },
      hooks: {
        beforeValidate: [
          ({ value, data }) => value || (data?.name ? slugify(data.name) : value),
        ],
      },
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
      admin: { position: 'sidebar' },
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
      name: 'feedUrl',
      type: 'text',
      virtual: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Subscribe to this URL in your RSS reader',
      },
      hooks: {
        afterRead: [
          ({ siblingData }) =>
            siblingData?.slug
              ? `${process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3000'}/feeds/${siblingData.slug}`
              : undefined,
        ],
      },
    },
    {
      type: 'collapsible',
      label: 'Last fetch',
      admin: { initCollapsed: true },
      fields: [
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
      ],
    },
  ],
  hooks: {
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
    afterDelete: [
      async ({ id, req }) => {
        await req.payload.delete({
          collection: 'feed-items',
          where: { source: { equals: id } },
        })
      },
    ],
  },
}
