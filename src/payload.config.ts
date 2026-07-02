import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { FeedItems } from './collections/FeedItems'
import { Sources } from './collections/Sources'
import { Subscriptions } from './collections/Subscriptions'
import { Users } from './collections/Users'
import { Settings } from './globals/Settings'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
  admin: {
    user: Users.slug,
    avatar: {
      Component: '/components/AccountAvatar#AccountAvatar',
    },
    components: {
      graphics: {
        Logo: '/components/Wordmark#LoginLogo',
        Icon: '/components/Wordmark#NavIcon',
      },
      providers: ['/components/RoleStyles#RoleStyles'],
      views: {
        dashboard: {
          Component: '/components/RoleDashboard#RoleDashboard',
        },
      },
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
  },
  collections: [Subscriptions, Sources, FeedItems, Users],
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
  plugins: [],
})
