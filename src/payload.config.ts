import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { FeedItems } from './collections/FeedItems'
import { Sources } from './collections/Sources'
import { Subscriptions } from './collections/Subscriptions'
import { Users } from './collections/Users'
import { Settings } from './globals/Settings'
import { captchaEndpoint, registerEndpoint } from './lib/registration'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    components: {
      graphics: {
        Logo: '/components/Wordmark#LoginLogo',
        Icon: '/components/Wordmark#NavIcon',
      },
      views: {
        dashboard: {
          Component: '/components/RoleDashboard#RoleDashboard',
        },
        // Custom admin views skip the auth redirect, so this is the public
        // registration page — styled by the admin like login/forgot-password.
        register: {
          Component: '/components/RegisterView#RegisterView',
          path: '/register',
          exact: true,
          meta: {
            title: 'Create an account',
            openGraph: {
              title: 'Create an account — RSS Parser',
            },
          },
        },
      },
      actions: ['/components/LogoutLink#LogoutLink', '/components/AccountLink#AccountLink'],
      providers: ['/components/RoleStyles#RoleStyles'],
      afterLogin: ['/components/RegisterLink#RegisterLink'],
    },
    dashboard: {
      widgets: [
        {
          slug: 'subscriptions-overview',
          label: 'Subscriptions overview',
          Component: '/components/SubscriptionsWidget#SubscriptionsWidget',
          // minWidth doubles as the size a freshly added widget spawns at
          minWidth: 'small',
          maxWidth: 'medium',
        },
      ],
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: {
      titleSuffix: '— RSS Parser',
      description:
        'Self-hostable tool that turns public Instagram accounts into plain RSS feeds. ' +
        'Add a handle, get a private feed URL, paste it into your reader.',
      openGraph: {
        title: 'RSS Parser — Instagram → RSS',
        description:
          'Self-hostable tool that turns public Instagram accounts into plain RSS feeds. ' +
          'Add a handle, get a private feed URL, paste it into your reader.',
        siteName: 'RSS Parser',
        // stable social-image URL served by src/app/og/route.ts
        images: [
          {
            url: `${process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3000'}/og`,
            width: 1200,
            height: 630,
          },
        ],
      },
    },
  },
  collections: [Subscriptions, Sources, FeedItems, Users],
  endpoints: [captchaEndpoint, registerEndpoint],
  globals: [Settings],
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URL || 'file:./rss-parser.db',
    },
  }),
  ...(process.env.SMTP_HOST
    ? {
        email: nodemailerAdapter({
          defaultFromAddress: process.env.EMAIL_FROM || 'noreply@example.com',
          defaultFromName: 'RSS Parser',
          transportOptions: {
            host: process.env.SMTP_HOST, // email-smtp.<region>.amazonaws.com
            port: 587,
            secure: false, // STARTTLS on 587
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            },
          },
        }),
      }
    : {}),
  plugins: [],
})
