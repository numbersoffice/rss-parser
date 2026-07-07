import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import { s3Storage } from '@payloadcms/storage-s3'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { FeedItems } from './collections/FeedItems'
import { Media } from './collections/Media'
import { Sources } from './collections/Sources'
import { Subscriptions } from './collections/Subscriptions'
import { Users } from './collections/Users'
import { Settings } from './globals/Settings'
import { mirrorSourceImagesTask } from './lib/jobs/mirrorSourceImages'
import {
  PRUNE_UNVERIFIED_CRON,
  PRUNE_UNVERIFIED_QUEUE,
  pruneUnverifiedUsersTask,
} from './lib/jobs/pruneUnverifiedUsers'
import { captchaEndpoint, registerEndpoint } from './lib/registration'
import { publicS3Url, s3Enabled } from './lib/s3'
import { migrations } from './migrations'

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
        // "Check your email" page shown after registration, before the account
        // is verified (see RegisterForm's onSuccess redirect).
        verifyPending: {
          Component: '/components/VerifyPendingView#VerifyPendingView',
          path: '/verify-pending',
          exact: true,
          meta: {
            title: 'Verify your email',
          },
        },
      },
      actions: ['/components/LogoutLink#LogoutLink', '/components/AccountLink#AccountLink'],
      providers: ['/components/RoleStyles#RoleStyles'],
      // Banner reflecting the verification-link outcome (?verified / ?verifyError).
      beforeLogin: ['/components/VerifyNotice#VerifyNotice'],
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
        {
          slug: 'decodo-data-usage',
          label: 'Residential data usage',
          Component: '/components/DataUsageWidget#DataUsageWidget',
          minWidth: 'small',
          maxWidth: 'medium',
        },
        {
          slug: 'fetch-errors',
          label: 'Fetch errors',
          Component: '/components/FetchErrorsWidget#FetchErrorsWidget',
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
  collections: [Subscriptions, Sources, FeedItems, Media, Users],
  endpoints: [captchaEndpoint, registerEndpoint],
  globals: [Settings],
  // Background jobs. Mirroring a new source's images to S3 is deferred off the
  // subscribe request into `mirrorSourceImages`, enqueued and kicked off (via
  // Next `after()`) so saves return fast — that path needs no cron.
  //
  // `pruneUnverifiedUsers` is a scheduled task: `autoRun` ticks the `nightly`
  // queue at midnight (server time), which both queues the task (per its own
  // `schedule`) and runs it. autoRun runs in-process on the long-lived server
  // (Coolify `next start`), so it must not be used on serverless hosts.
  jobs: {
    tasks: [mirrorSourceImagesTask, pruneUnverifiedUsersTask],
    autoRun: [{ cron: PRUNE_UNVERIFIED_CRON, queue: PRUNE_UNVERIFIED_QUEUE }],
    // Runs are triggered in-process (never via the public HTTP endpoint), so
    // lock the endpoint down.
    access: { run: () => false },
  },
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: sqliteAdapter({
    client: {
      url: process.env.DATABASE_URL || 'file:./rss-parser.db',
    },
    // Schema is only auto-pushed in dev; in production the migrations run
    // at startup (instrumentation.ts inits Payload on boot).
    prodMigrations: migrations,
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
  // Feed item images are mirrored into an S3-compatible bucket (Hetzner Object
  // Storage) so feeds serve stable public URLs instead of the platform's
  // signed, origin-restricted CDN URLs. Without the env vars (local dev) the
  // plugin is inert and the raw CDN URLs are served instead. It must be
  // registered even then — it always contributes its client component to the
  // admin importMap, and `generate:importmap` runs without the S3 env vars,
  // so gating the registration itself would ship an importMap that is missing
  // the component wherever the env vars *are* set.
  plugins: [
    s3Storage({
      enabled: s3Enabled(),
      collections: {
        media: {
          // Files are read straight from the public bucket, never proxied
          // through Payload — the whole point is client-reachable URLs.
          disablePayloadAccessControl: true,
          generateFileURL: ({ filename }) => publicS3Url(filename),
        },
      },
      // Fallbacks only satisfy the types: when disabled the plugin never
      // constructs an S3 client, so the values go unused.
      bucket: process.env.S3_BUCKET ?? '',
      config: {
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION || 'auto',
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
        },
        forcePathStyle: true,
      },
    }),
  ],
})
