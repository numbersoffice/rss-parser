import type { CollectionConfig } from 'payload'

import { hiddenFromNonAdmins, isAdmin, isAdminField, isAdminOrSelf } from '@/lib/access'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'role'],
    hidden: hiddenFromNonAdmins,
  },
  auth: true,
  access: {
    read: isAdminOrSelf,
    create: isAdmin,
    update: isAdminOrSelf,
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [
      async ({ data, operation, req }) => {
        if (!data) return data
        if (operation === 'create') {
          // The very first account (the /admin setup screen) becomes the admin.
          const { totalDocs } = await req.payload.count({ collection: 'users' })
          if (totalDocs === 0) {
            data.role = 'admin'
          } else if (req.user && req.user.role !== 'admin') {
            // Only admins assign roles; Local API (system) calls are trusted.
            data.role = 'user'
          }
        } else if (req.user?.role !== 'admin') {
          delete data.role
        }
        return data
      },
    ],
    beforeDelete: [
      // Subscriptions reference the user with a NOT NULL foreign key — remove
      // them first (which also GCs sources nobody else follows).
      async ({ id, req }) => {
        await req.payload.delete({
          collection: 'subscriptions',
          where: { user: { equals: id } },
          req,
        })
      },
    ],
  },
  fields: [
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'user',
      options: [
        { label: 'User', value: 'user' },
        { label: 'Admin', value: 'admin' },
      ],
      saveToJWT: true,
      access: { update: isAdminField },
      admin: {
        position: 'sidebar',
        description: 'Admins manage users and shared sources; users manage their own subscriptions.',
      },
    },
  ],
}
