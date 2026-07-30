import path from 'node:path'
import express from 'express'

import { typeForPrefix } from './adapters/registry.js'
import { assetsDir, config } from './config.js'
import {
  closeDb,
  countItems,
  countItemsBySource,
  findSource,
  initDb,
  listItemsForFeed,
  listSources,
  postsInWindow,
  postsInWindowBySource,
} from './db.js'
import { type Average, averagePerDay, windowStartDay } from './lib/activity.js'
import { log } from './log.js'
import { syncAccounts } from './jobs/syncAccounts.js'
import { pruneHistory } from './jobs/pruneHistory.js'
import { refreshFeeds } from './jobs/refreshFeeds.js'
import { Scheduler } from './jobs/scheduler.js'
import { sweepAssets } from './jobs/sweepAssets.js'
import { assetUsage, recomputeAssetUsage } from './lib/assets.js'
import { describeError } from './lib/errors.js'
import { proxyEndpoint } from './lib/proxy.js'
import { buildRssXml } from './lib/rss.js'
import { renderIndex, renderLanding } from './views.js'

const DAY_MS = 24 * 60 * 60_000

/** Instagram's own handle rules; also keeps these safe as paths and filenames. */
const VALID_HANDLE = /^[a-z0-9._]{1,30}$/

const app = express()
// Our own ETags are explicit and semantic (see the feed route); express's default
// weak body hash would fight them.
app.set('etag', false)
app.disable('x-powered-by')

// ---------------------------------------------------------------------------

app.get('/healthz', (_req, res) => {
  const stale = scheduler.lastTick > 0 && Date.now() - scheduler.lastTick > 5 * 60_000
  res.set('cache-control', 'no-store')
  res.status(stale ? 503 : 200).json({
    ok: !stale,
    feeds: listSources().length,
    lastTickAt: scheduler.lastTick || null,
  })
})

app.get('/', (_req, res) => {
  const sources = listSources()
  const posts = postsInWindowBySource(windowStartDay(config.activityWindowDays))
  const averages = new Map<number, Average | null>(
    sources.map((source) => [
      source.id,
      averagePerDay(posts.get(source.id) ?? 0, source.first_success_at, config.activityWindowDays),
    ]),
  )
  res.set('cache-control', 'no-store')
  res.type('html').send(renderIndex(sources, countItemsBySource(), averages, assetUsage()))
})

/**
 * The RSS feed. Served purely from SQLite — nothing on the request path fetches
 * from Instagram, which is the biggest structural change from the version this
 * replaces (where the first reader to poll after the TTL expired paid the fetch
 * latency, and simultaneous polls could double-fetch).
 *
 * `:handle.xml` is safe under Express 5's path-to-regexp v8: `.` isn't an
 * identifier character, so this parses as [param, literal ".xml"] and compiles
 * to a greedy `([^/]+)\.xml`, which backtracks correctly for handles that
 * themselves contain dots.
 */
app.get('/feeds/:prefix/:handle.xml', (req, res) => {
  const source = lookup(req.params.prefix, req.params.handle)
  if (!source) {
    res.set('cache-control', 'no-store')
    res.status(404).type('text').send('Feed not found')
    return
  }

  const count = countItems(source.id)
  // Both validators derive from updated_at, which only moves when the feed body
  // actually changes — so a reader polling an unchanged feed costs one indexed
  // query and a 304, and we never build the XML at all. (This is why
  // <lastBuildDate> had to stop being `new Date()`.)
  res.set('etag', `W/"${source.id}-${source.updated_at}-${count}"`)
  res.set('last-modified', new Date(source.updated_at).toUTCString())
  res.set('cache-control', 'public, max-age=300, stale-while-revalidate=600')
  // `req.fresh` reads the validators off the response, so it has to come after
  // the res.set calls above. It also (correctly) reports stale when the request
  // carries `cache-control: no-cache` — worth knowing when testing, because
  // fetch() adds that header automatically to any conditional request.
  if (req.fresh) {
    res.status(304).end()
    return
  }

  const items = listItemsForFeed(source.id, config.maxItemsPerFeed)
  res.type('application/rss+xml; charset=utf-8').send(buildRssXml(source, items))
})

app.get('/f/:prefix/:handle', (req, res, next) => {
  const source = lookup(req.params.prefix, req.params.handle)
  if (!source) return next()
  const posts = postsInWindow(source.id, windowStartDay(config.activityWindowDays))
  const average = averagePerDay(posts, source.first_success_at, config.activityWindowDays)
  res.set('cache-control', 'public, max-age=3600')
  res.type('html').send(renderLanding(source, listItemsForFeed(source.id, 15), average))
})

/**
 * The landing page's icon. Readers scraping the page for a sidebar icon follow
 * this; it redirects to the mirrored avatar, or to a neutral tile while the
 * avatar hasn't been mirrored yet (a broken icon here is worse than a generic
 * one, because some readers cache the failure).
 */
app.get('/f/:prefix/:handle/icon', (req, res, next) => {
  const source = lookup(req.params.prefix, req.params.handle)
  if (!source) return next()
  res.set('cache-control', 'public, max-age=3600')
  res.redirect(302, source.profile_asset ? source.profile_image_url! : '/feed-icon-fallback.png')
})

// Mirrored images. Every asset path is content-stable, so this can be immutable.
app.use(
  '/assets',
  express.static(assetsDir, {
    maxAge: '365d',
    immutable: true,
    index: false,
    redirect: false,
    dotfiles: 'ignore',
    fallthrough: false,
  }),
)

app.use(
  express.static(path.resolve('public'), {
    maxAge: '1d',
    index: false,
    redirect: false,
    dotfiles: 'ignore',
  }),
)

app.use((_req, res) => {
  res.set('cache-control', 'no-store')
  res.status(404).type('text').send('Not found')
})

// ---------------------------------------------------------------------------

/** Resolve a `/feeds/{prefix}/{handle}` pair to a source, or undefined. */
function lookup(prefix: string | undefined, rawHandle: string | undefined) {
  const type = prefix ? typeForPrefix(prefix) : undefined
  if (!type || !rawHandle) return undefined
  const handle = rawHandle.toLowerCase()
  if (!VALID_HANDLE.test(handle)) return undefined
  return findSource(type, handle)
}

const scheduler = new Scheduler([
  { name: 'refresh-feeds', everyMs: config.tickIntervalMs, run: refreshFeeds },
  { name: 'prune-history', everyMs: DAY_MS, run: pruneHistory },
  { name: 'sweep-assets', everyMs: DAY_MS, run: sweepAssets },
])

async function main(): Promise<void> {
  initDb()

  // Reconcile feeds with accounts.txt once, here on the way up. The file is
  // committed, so a change to it is a redeploy, and this fresh process picks it
  // up — there is no periodic re-read.
  await syncAccounts()

  // The asset total is kept in memory and adjusted as images are stored and
  // deleted, so it has to be established once against the directory at startup.
  const usage = await recomputeAssetUsage()

  const server = app.listen(config.port, () => {
    log.info('rss-parser listening', {
      port: config.port,
      url: config.publicBaseUrl,
      feeds: listSources().length,
      assets: `${usage.files} files, ${Math.round(usage.bytes / 1024)} KB`,
      // Never the proxy URL itself — it carries credentials.
      proxy: proxyEndpoint() ?? 'direct',
      images: config.mirrorImages ? config.imageFetch : 'off',
      ttl: `${config.refreshIntervalMinutes}m`,
      keep: config.maxItemsPerFeed,
      accounts: config.accountsFile,
    })
    scheduler.start()
  })

  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    log.info('shutting down', { signal })
    scheduler.stop()
    server.close(() => {
      closeDb()
      process.exit(0)
    })
    // Don't let an in-flight fetch hold the container past Docker's grace period.
    setTimeout(() => {
      closeDb()
      process.exit(0)
    }, 8_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { error: describeError(reason) })
  })
}

void main()
