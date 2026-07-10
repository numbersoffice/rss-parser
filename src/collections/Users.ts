import { randomBytes } from 'crypto'
import type { CollectionConfig } from 'payload'
import { ValidationError } from 'payload'

import {
  adminFieldCondition,
  hiddenFromNonAdmins,
  isAdmin,
  isAdminField,
  isAdminOrSelf,
} from '@/lib/access'
import { isDisposableEmailDomain } from '@/lib/disposableEmail'
import { emailLayout } from '@/lib/emailTemplates'
import { EMAIL_RE } from '@/lib/registration'

const serverUrl = () => process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3000'

/** How long an email-change confirmation link stays valid. */
const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000 // 1 hour

/** Passed from the users beforeChange hook (which mints the token) to afterChange
 * (which sends the confirmation mail) via req.context. */
type EmailChangeConfirmation = { to: string; token: string }

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
    // Self-service is back on: users manage their own password (and, via the
    // verified flow below, their email). Role stays locked to admins by the
    // `role` field access + the `delete data.role` guard in beforeChange.
    update: isAdminOrSelf,
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [
      async ({ data, operation, originalDoc, req }) => {
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
          return data
        }

        // --- updates ---
        if (req.user?.role !== 'admin') {
          delete data.role
        }

        // Email-change verification. Any human-initiated update (self OR admin)
        // that changes the email is diverted: the address is left untouched and
        // parked in `pendingEmail` behind a confirmation link, so the account
        // keeps its current email until the new one is confirmed. System calls
        // (the confirm route — Local API, no req.user) are NOT diverted, which
        // is how the confirmed address actually gets applied.
        if (req.user && typeof data.email === 'string' && originalDoc) {
          const newEmail = data.email.trim().toLowerCase()
          const current = (originalDoc.email ?? '').toLowerCase()
          if (newEmail && newEmail !== current) {
            const fail = (message: string) => {
              throw new ValidationError(
                { collection: 'users', errors: [{ path: 'email', message }] },
                req.t,
              )
            }
            if (!EMAIL_RE.test(newEmail)) fail('Enter a valid email address.')
            if (isDisposableEmailDomain(newEmail)) {
              fail(
                "Anonymous or disposable email addresses aren't supported. Use a permanent address.",
              )
            }
            // Reject an address already taken (or pending) by another account.
            const { totalDocs } = await req.payload.count({
              collection: 'users',
              where: {
                and: [
                  { id: { not_equals: originalDoc.id } },
                  {
                    or: [{ email: { equals: newEmail } }, { pendingEmail: { equals: newEmail } }],
                  },
                ],
              },
              overrideAccess: true,
              req,
            })
            if (totalDocs > 0) fail('That email address is already in use.')

            // Divert: keep the current email, park the new one behind a token.
            data.email = originalDoc.email
            data.pendingEmail = newEmail
            data.emailChangeToken = randomBytes(32).toString('hex')
            data.emailChangeTokenExpiry = new Date(Date.now() + EMAIL_CHANGE_TTL_MS).toISOString()
            req.context.emailChangeConfirmation = {
              to: newEmail,
              token: data.emailChangeToken,
            } satisfies EmailChangeConfirmation
          }
        }
        return data
      },
    ],
    afterChange: [
      // Send the "confirm your new email" link to the pending address. Runs
      // after the pending-change fields are committed (see beforeChange).
      async ({ req }) => {
        const conf = req.context.emailChangeConfirmation as EmailChangeConfirmation | undefined
        if (!conf) return
        // Guard against a double-send if the hook chain re-runs.
        delete req.context.emailChangeConfirmation
        try {
          await req.payload.sendEmail({
            to: conf.to,
            subject: 'Confirm your new email — ~/rss-parser',
            html: emailLayout({
              heading: 'Confirm your new email',
              intro:
                'You asked to change the email on your ~/rss-parser account to this address. ' +
                'Click below to confirm — until you do, your current email stays active. ' +
                'This link expires in an hour.',
              cta: {
                label: 'Confirm email',
                url: `${serverUrl()}/verify-email-change?token=${conf.token}`,
              },
            }),
          })
        } catch (err) {
          req.payload.logger.error({ err }, 'failed to send email-change confirmation')
        }
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
    // Outcome banner for the email-change confirmation link (account view).
    {
      name: 'emailChangeNotice',
      type: 'ui',
      admin: {
        components: {
          Field: '/components/EmailChangeNotice#EmailChangeNotice',
        },
      },
    },
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
        description:
          'Admins manage users and shared sources; users manage their own subscriptions.',
      },
    },
    // Email address awaiting confirmation. Populated by the beforeChange
    // diversion; cleared by the confirm route once the link is clicked. Shown
    // read-only (only when set) so the account view surfaces the pending state.
    {
      name: 'pendingEmail',
      type: 'text',
      access: { create: () => false, update: () => false },
      admin: {
        // position: 'sidebar',
        readOnly: true,
        condition: (data) => Boolean(data?.pendingEmail),
        components: {
          // Custom Field: read-only value + description with an inline "Cancel"
          // link to abort the pending change.
          Field: '/components/PendingEmailField#PendingEmailField',
        },
      },
    },
    // Log out button in the account-view sidebar. Non-admins have the nav
    // sidebar — and its built-in logout button — hidden by RoleStyles, so this
    // is their way out; harmless for admins, who also keep the nav button.
    {
      name: 'logout',
      type: 'ui',
      admin: {
        position: 'sidebar',
        components: {
          Field: '/components/LogoutField#LogoutField',
        },
      },
    },
    // Single-use token + expiry backing the confirmation link. Never exposed to
    // clients (hidden from the API); the confirm route reads them via
    // overrideAccess.
    {
      name: 'emailChangeToken',
      type: 'text',
      access: { read: () => false, create: () => false, update: () => false },
      admin: { hidden: true },
    },
    {
      name: 'emailChangeTokenExpiry',
      type: 'date',
      access: { read: () => false, create: () => false, update: () => false },
      admin: { hidden: true },
    },
  ],
}
