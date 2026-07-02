import { randomBytes } from 'node:crypto'

import { APIError, type CollectionConfig } from 'payload'

import { sourceTypeOptions } from '@/adapters/registry'
import { adminFieldCondition, isAdminField, isAdminOrOwner, isLoggedIn } from '@/lib/access'
import { refreshSource } from '@/lib/refresh'
import {
  deleteSourceIfOrphaned,
  findOrCreateSource,
  normalizeHandle,
  relationId,
} from '@/lib/sources'

/**
 * A user's personal link to a shared source, with its own private feed URL.
 * Subscribing to an account someone else already follows reuses the existing
 * source; deleting the last subscription garbage-collects it.
 */
export const Subscriptions: CollectionConfig = {
  slug: 'subscriptions',
  admin: {
    useAsTitle: 'handle',
    defaultColumns: ['handle', 'type', 'feedUrl', 'createdAt'],
    description:
      'Your feeds. Each subscription has its own private feed URL — deleting the subscription breaks the URL.',
    hideAPIURL: true,
  },
  access: {
    create: isLoggedIn,
    read: isAdminOrOwner,
    update: isAdminOrOwner,
    delete: isAdminOrOwner,
  },
  indexes: [{ fields: ['user', 'source'], unique: true }],
  fields: [
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'instagram',
      options: sourceTypeOptions,
      access: { update: isAdminField },
      admin: { description: 'Which platform to follow' },
    },
    {
      name: 'handle',
      type: 'text',
      required: true,
      access: { update: isAdminField },
      admin: {
        description:
          'Account to follow, e.g. the Instagram username (without @). To follow a different account, delete this subscription and add a new one.',
      },
    },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      defaultValue: ({ user }) => user?.id,
      access: { update: isAdminField },
      admin: { position: 'sidebar', condition: adminFieldCondition },
    },
    {
      name: 'source',
      type: 'relationship',
      relationTo: 'sources',
      required: true,
      index: true,
      admin: {
        position: 'sidebar',
        readOnly: true,
        condition: adminFieldCondition,
        description: 'Shared source — resolved automatically from type + handle',
      },
    },
    {
      name: 'token',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { readOnly: true, position: 'sidebar', hidden: true },
    },
    {
      name: 'feedUrl',
      type: 'text',
      virtual: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Subscribe to this URL in your RSS reader. Private to this subscription.',
        components: {
          Field: '@/components/FeedUrlField#FeedUrlField',
        },
      },
      hooks: {
        afterRead: [
          ({ siblingData }) =>
            siblingData?.token
              ? `${process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3000'}/feeds/${siblingData.token}`
              : undefined,
        ],
      },
    },
  ],
  hooks: {
    beforeValidate: [
      async ({ data, operation, originalDoc, req }) => {
        if (!data) return data
        if (!req.user) throw new APIError('You must be logged in to subscribe', 401)

        if (req.user.role !== 'admin') {
          data.user = req.user.id
          if (operation === 'update' && originalDoc) {
            // Type/handle are immutable for users — delete & re-add instead.
            data.type = originalDoc.type
            data.handle = originalDoc.handle
          }
        }

        if (operation === 'create' && !data.token) {
          data.token = randomBytes(16).toString('hex')
        }

        const type = data.type ?? originalDoc?.type
        const handle = data.handle ?? originalDoc?.handle
        if (!type || !handle) return data // field validation reports what's missing

        data.handle = normalizeHandle(handle)
        const source = await findOrCreateSource(req.payload, type, data.handle, req)
        data.source = source.id

        const owner = relationId(data.user) ?? relationId(originalDoc?.user)
        const duplicate = await req.payload.find({
          collection: 'subscriptions',
          where: {
            and: [
              { user: { equals: owner } },
              { source: { equals: source.id } },
              ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
            ],
          },
          limit: 1,
          depth: 0,
          req,
        })
        if (duplicate.docs.length > 0) {
          throw new APIError(`Already subscribed to @${data.handle}`, 400)
        }

        return data
      },
    ],
    afterChange: [
      async ({ doc, previousDoc, operation, req }) => {
        // First subscriber to a source triggers its initial fetch.
        const sourceId = relationId(doc.source)
        if (sourceId) {
          const source = await req.payload.findByID({
            collection: 'sources',
            id: sourceId,
            depth: 0,
          })
          if (!source.lastFetchedAt) await refreshSource(req.payload, sourceId)
        }
        // Admin re-pointed the subscription: GC the old source if now orphaned.
        if (operation === 'update') {
          const previousId = relationId(previousDoc?.source)
          if (previousId && previousId !== sourceId) {
            await deleteSourceIfOrphaned(req.payload, previousId, req)
          }
        }
      },
    ],
    afterDelete: [
      async ({ doc, req, context }) => {
        if (context.cascadeFromSource) return
        const sourceId = relationId(doc.source)
        if (sourceId) await deleteSourceIfOrphaned(req.payload, sourceId, req)
      },
    ],
  },
}
