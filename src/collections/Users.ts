import type { CollectionConfig } from 'payload'

import {
  adminFieldCondition,
  hiddenFromNonAdmins,
  isAdmin,
  isAdminField,
  isAdminOrSelf,
} from '@/lib/access'
import { emailLayout } from '@/lib/emailTemplates'

const serverUrl = () => process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3000'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'role'],
    hidden: hiddenFromNonAdmins,
    components: {
      // Admin-only line above the list: when the unverified-account cleanup
      // last ran and when it runs next (the component no-ops for non-admins).
      beforeListTable: ['/components/UnverifiedCleanupNotice#UnverifiedCleanupNotice'],
    },
  },
  // Self-registered accounts must confirm they own the email address before
  // they can log in. Built-in verification blocks login until `_verified` is
  // true, so an unverified user has no session and the whole admin panel is
  // gated. The very first user (admin setup screen) and admin-created users are
  // auto-verified (see beforeChange + Payload's registerFirstUser).
  auth: {
    verify: {
      generateEmailSubject: () => 'Verify your email — ~/rss-parser',
      generateEmailHTML: ({ token }) =>
        emailLayout({
          heading: 'Confirm your email',
          intro:
            'Thanks for signing up. Click below to verify your email address and finish creating your account.',
          cta: { label: 'Verify email', url: `${serverUrl()}/verify?token=${token}` },
        }),
    },
    forgotPassword: {
      generateEmailSubject: () => 'Reset your password — ~/rss-parser',
      generateEmailHTML: (args) =>
        emailLayout({
          heading: 'Reset your password',
          intro:
            'We received a request to reset your password. Click below to choose a new one. This link expires shortly.',
          cta: {
            label: 'Reset password',
            url: `${serverUrl()}/admin/reset/${args?.token ?? ''}`,
          },
        }),
    },
  },
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
            // First account is the admin and is trusted (there's no one to send
            // the verification email to yet); auto-verify so it isn't locked out.
            data.role = 'admin'
            data._verified = true
          } else if (req.user && req.user.role !== 'admin') {
            // Only admins assign roles; Local API (system) calls are trusted.
            data.role = 'user'
          }
          // Accounts an admin creates in the panel are trusted — skip the email
          // verification step. Self-registration (the /api/register endpoint,
          // overrideAccess with no req.user) stays unverified so the
          // confirmation email is sent.
          if (req.user?.role === 'admin') {
            data._verified = true
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
        condition: adminFieldCondition,
        description: 'Admins manage users and shared sources; users manage their own subscriptions.',
      },
    },
  ],
}
