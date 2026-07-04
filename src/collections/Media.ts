import type { CollectionConfig } from 'payload'

import { hiddenFromNonAdmins, isAdmin } from '@/lib/access'

/**
 * Images downloaded for feed items, stored in the S3 bucket via the storage
 * plugin (src/payload.config.ts) — managed automatically by the refresh logic
 * (src/lib/refresh.ts). Payload access control is disabled for the files
 * themselves: documents' `url` points straight at the public bucket, which is
 * what feed readers need. These access rules only govern the admin API.
 */
export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: isAdmin,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  admin: {
    hidden: hiddenFromNonAdmins,
    description: 'Stored copies of feed item images, kept in sync automatically — no need to edit these',
  },
  upload: {
    mimeTypes: ['image/*'],
    crop: false,
    focalPoint: false,
  },
  fields: [],
}
