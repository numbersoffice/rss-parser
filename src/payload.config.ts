import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import { s3Storage } from '@payloadcms/storage-s3'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { FeedItems } from './collections/FeedItems'
import { Media } from './collections/Media'
import { News } from './collections/News'
import { RequestLogs } from './collections/RequestLogs'
import { SourceActivity } from './collections/SourceActivity'
import { Sources } from './collections/Sources'
import { Subscriptions } from './collections/Subscriptions'
import { Users } from './collections/Users'
import { Settings } from './globals/Settings'
import { mirrorSourceImagesTask } from './lib/jobs/mirrorSourceImages'
import { pruneRequestLogsTask } from './lib/jobs/pruneRequestLogs'
import { pruneSourceActivityTask } from './lib/jobs/pruneSourceActivity'
import {
  PRUNE_UNVERIFIED_CRON,
  PRUNE_UNVERIFIED_QUEUE,
  pruneUnverifiedUsersTask,
} from './lib/jobs/pruneUnverifiedUsers'
import { loggingEmailAdapter } from './lib/email'
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
          minWidth: 'small',
          maxWidth: 'medium',
        },
        {
          slug: 'latest-news',
          label: 'Latest news',
          Component: '/components/NewsWidget#NewsWidget',
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
          label: 'Fetch success rate',
          Component: '/components/FetchTrendWidget#FetchTrendWidget',
          minWidth: 'small',
          maxWidth: 'medium',
        },
        {
          slug: 'frequent-sources',
          label: 'Most active sources',
          Component: '/components/FrequentSourcesWidget#FrequentSourcesWidget',
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
  collections: [Subscriptions, Sources, FeedItems, Media, News, Users, RequestLogs, SourceActivity],
  endpoints: [captchaEndpoint, registerEndpoint],
  globals: [Settings],
  // Background jobs. Mirroring a new source's images to S3 is deferred off the
  // subscribe request into `mirrorSourceImages`, enqueued and kicked off (via
  // Next `after()`) so saves return fast — that path needs no cron.
  //
  // `pruneUnverifiedUsers`, `pruneRequestLogs` and `pruneSourceActivity` are
  // scheduled tasks: `autoRun` ticks the `nightly` queue at midnight (server
  // time), which both queues the tasks (per their own `schedule`) and runs them.
  // One autoRun entry drains the whole queue, so all nightly tasks share it.
  // autoRun runs in-process on the long-lived server (Coolify `next start`), so
  // it must not be used on serverless hosts.
  jobs: {
    tasks: [
      mirrorSourceImagesTask,
      pruneUnverifiedUsersTask,
      pruneRequestLogsTask,
      pruneSourceActivityTask,
    ],
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
      // Busy timeout for EVERY connection the libsql client opens. The
      // adapter-level `busyTimeout` below is a PRAGMA run once on the initial
      // connection — but @libsql/client's local-file driver discards its
      // connection whenever a transaction starts and lazily opens a fresh one,
      // which would otherwise run with busy_timeout=0 and turn any write
      // contention into an instant SQLITE_BUSY. Requires @libsql/client
      // >= 0.17 (pnpm override in package.json; Payload still pins 0.14).
      //
      // This absorbs contention from other PROCESSES (the old container during
      // a rolling deploy, boot-time migrations, a stray CLI). Contention
      // between writers within this process cannot be fixed by any timeout —
      // libsql executes statements synchronously, so a waiter blocks the event
      // loop and the in-process lock holder can never commit; those writers
      // are serialized instead (see src/lib/dbWriteLock.ts).
      timeout: 5000,
    },
    // Transactions are off by default for SQLite; the feed reconciliation
    // (storeItems in src/lib/refresh.ts) relies on them to commit its diff
    // atomically, so feed readers never see a half-updated item set.
    transactionOptions: {},
    // Schema is only auto-pushed in dev; in production the migrations run
    // at startup (instrumentation.ts inits Payload on boot).
    prodMigrations: migrations,
    wal: true,
    busyTimeout: 5000,
  }),
  // Real SMTP in production; a console-logging fallback everywhere else so the
  // transactional links (verify, reset, email-change) are still testable in dev
  // instead of being silently dropped (see src/lib/email.ts).
  email: process.env.SMTP_HOST
    ? nodemailerAdapter({
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
      })
    : loggingEmailAdapter,
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
