import type { CollectionConfig } from 'payload'

import { hiddenFromNonAdmins, isAdmin } from '@/lib/access'

/**
 * One row per adapter fetch attempt, written by `recordFetchOutcome`
 * (src/lib/refresh.ts) alongside the source's `lastFetch*` fields. Unlike
 * those — which only ever hold the latest outcome — these accumulate a short
 * history so we can chart success/failure trends over time.
 *
 * Retention is one week: `pruneRequestLogs` (src/lib/jobs/pruneRequestLogs.ts)
 * trims older rows nightly, and Sources' beforeDelete cascade removes a
 * source's logs when it goes. Admin-only and hidden from the nav — this is an
 * operational readout, never referenced by user-facing docs.
 */
export const RequestLogs: CollectionConfig = {
  slug: 'request-logs',
  admin: {
    useAsTitle: 'source',
    hidden: hiddenFromNonAdmins,
    defaultColumns: ['source', 'status', 'httpStatus', 'createdAt'],
    description:
      'One row per adapter fetch attempt, used for health trends — created and pruned automatically (kept for a week)',
    components: {
      beforeListTable: ['/components/RequestLogCleanupNotice#RequestLogCleanupNotice'],
    },
  },
  access: {
    read: isAdmin,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    {
      name: 'source',
      type: 'relationship',
      relationTo: 'sources',
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'fetchId',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description:
          'Groups the attempts of one refresh: a fetch that retries writes one row per attempt, all sharing this id, so the health readout can collapse them into a single session.',
      },
    },
    {
      name: 'status',
      type: 'select',
      options: ['success', 'error'],
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'error',
      type: 'textarea',
      admin: { readOnly: true },
    },
    {
      name: 'httpStatus',
      type: 'number',
      admin: { readOnly: true, description: 'HTTP status of the fetch, when the adapter reported one' },
    },
    {
      name: 'durationMs',
      type: 'number',
      admin: { readOnly: true, description: 'Fetch duration in milliseconds, when reported' },
    },
  ],
}
