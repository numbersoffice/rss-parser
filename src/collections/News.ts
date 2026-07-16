import { revalidatePath } from 'next/cache'
import type { CollectionConfig } from 'payload'

import { hiddenFromNonAdmins, isAdmin } from '@/lib/access'

/** URL-safe slug from a title: lowercase, alphanumerics, single dashes. */
const slugify = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/**
 * Purge the statically rendered news pages. Hooks can also fire outside a
 * Next request scope (payload CLI, jobs), where revalidatePath throws —
 * never fail a save over cache invalidation.
 */
const revalidateNews = (slugs: Array<string | null | undefined>) => {
  try {
    revalidatePath('/news')
    for (const slug of slugs) if (slug) revalidatePath(`/news/${slug}`)
  } catch {
    // outside a Next request scope — nothing to invalidate
  }
}

export const News: CollectionConfig = {
  slug: 'news',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'publishedAt'],
    hidden: hiddenFromNonAdmins,
    description: 'Posts shown on /news — public, written by admins.',
  },
  access: {
    read: () => true,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  defaultSort: '-publishedAt',
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'URL path segment — generated from the title when left empty.',
      },
    },
    {
      name: 'publishedAt',
      type: 'date',
      required: true,
      defaultValue: () => new Date().toISOString(),
      admin: {
        position: 'sidebar',
        date: { pickerAppearance: 'dayAndTime' },
      },
    },
    {
      name: 'excerpt',
      type: 'textarea',
      admin: {
        description:
          'Teaser for the homepage and meta description. Falls back to the first words of the post.',
      },
    },
    {
      name: 'content',
      type: 'richText',
      required: true,
    },
  ],
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (!data) return data
        const source = typeof data.slug === 'string' && data.slug.trim() ? data.slug : data.title
        if (typeof source === 'string' && source.trim()) data.slug = slugify(source)
        return data
      },
    ],
    afterChange: [
      ({ doc, previousDoc }) => {
        // include the old slug so a rename purges the stale path too
        revalidateNews([doc.slug, previousDoc?.slug])
      },
    ],
    afterDelete: [({ doc }) => revalidateNews([doc.slug])],
  },
}
