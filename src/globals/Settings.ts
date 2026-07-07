import type { GlobalConfig } from 'payload'

import { hiddenFromNonAdmins, isAdmin } from '@/lib/access'

/**
 * Platform-wide settings — admin-only, invisible to users. Server components
 * that need a value (e.g. the subscription limit) read it via the Local API,
 * which bypasses access control.
 */
export const Settings: GlobalConfig = {
  slug: 'settings',
  admin: {
    hidden: hiddenFromNonAdmins,
  },
  access: {
    read: isAdmin,
    update: isAdmin,
  },
  fields: [
    {
      name: 'maxSubscriptionsPerUser',
      type: 'number',
      required: true,
      defaultValue: 12,
      min: 0,
      admin: {
        description:
          'How many subscriptions a regular user may have. Lowering it below what a user already has keeps their existing subscriptions but blocks new ones until they are back under the limit. Admins are not limited.',
      },
    },
    {
      name: 'maxFetchAttempts',
      type: 'number',
      required: true,
      defaultValue: 3,
      min: 1,
      admin: {
        description:
          'How many times to try fetching a source before giving up. Instagram returns 401 from a fraction of residential-proxy IPs, so each retry rotates to a fresh IP — 2–3 attempts recovers most transient blocks. Set to 1 to disable retrying.',
      },
    },
  ],
}
