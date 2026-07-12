import type { CollectionConfig } from 'payload'

import { hiddenFromNonAdmins, isAdmin } from '@/lib/access'

/**
 * One row per source per calendar day, holding how many *new* feed items that
 * source's refreshes created that day (written by `recordDailyActivity` in
 * src/lib/refresh.ts, only on the refresh path — the subscribe-time backfill is
 * deliberately excluded). Days with no new items get no row, so the table stays
 * sparse.
 *
 * This is the activity signal behind the "Most active sources" dashboard widget:
 * new items are what cost proxy bandwidth (each is a fetch + image mirror), so
 * counting them directly is more accurate than inferring cadence from
 * feed-items' (capped, pruned) publish times.
 *
 * Retention is one week: `pruneSourceActivity` (src/lib/jobs/pruneSourceActivity.ts)
 * trims older rows nightly, and Sources' beforeDelete cascade removes a source's
 * rows when it goes. Admin-only and hidden from the nav — an operational readout,
 * never referenced by user-facing docs.
 */
export const SourceActivity: CollectionConfig = {
  slug: 'source-activity',
  admin: {
    useAsTitle: 'source',
    hidden: hiddenFromNonAdmins,
    defaultColumns: ['source', 'day', 'count', 'updatedAt'],
    description:
      'New feed items per source per day, powering the most-active-sources widget — created and pruned automatically (kept for a week)',
    components: {
      beforeListTable: ['/components/SourceActivityCleanupNotice#SourceActivityCleanupNotice'],
    },
  },
  access: {
    read: isAdmin,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  indexes: [
    // One row per source per day: the upsert in recordDailyActivity relies on
    // this being unique.
    {
      fields: ['source', 'day'],
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
      admin: { readOnly: true },
    },
    {
      name: 'day',
      type: 'text',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'Calendar day (YYYY-MM-DD, server timezone) this count is for',
      },
    },
    {
      name: 'count',
      type: 'number',
      required: true,
      admin: {
        readOnly: true,
        description: 'New feed items created for this source on this day',
      },
    },
  ],
}
