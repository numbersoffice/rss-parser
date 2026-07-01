import type { CollectionConfig } from 'payload'

/**
 * Normalized cache of fetched posts. Populated by the refresh logic
 * (src/lib/refresh.ts) — treat as read-only in the admin.
 */
export const FeedItems: CollectionConfig = {
  slug: 'feed-items',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'source', 'publishedAt'],
    description: 'Fetched posts, kept in sync automatically — no need to edit these',
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
