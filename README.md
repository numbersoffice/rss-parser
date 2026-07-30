# rss-parser

Publishes public Instagram accounts as RSS feeds. The list of accounts is a text
file in this repo, so adding or removing a feed is a commit.

An Express app with three runtime dependencies, a SQLite file and a directory of
images. It idles at well under 100 MB and does no work on the request path.

```
accounts.txt ──▶ sync-accounts ──▶ sources ──▶ refresh-feeds ──▶ items + assets
                                                                      │
                                          GET /feeds/ig/{handle}.xml ◀─┘
```

## Quick start

```sh
pnpm install
pnpm build
pnpm start                  # http://localhost:3000
```

Open `http://localhost:3000` for the list of published feeds. The first refresh
of each account happens within a minute or two — refreshes are staggered on
purpose (see [Refreshing](#refreshing)).

With Docker:

```sh
cp .env.example .env        # set PUBLIC_BASE_URL, optionally OUTBOUND_PROXY_URL
docker compose up -d
docker compose logs -f      # job and per-account status lines
```

## Adding and removing feeds

`accounts.txt` is the interface. One Instagram username per line; `#` comments
and blank lines are ignored, a leading `@` is optional, and case doesn't matter.

```
nasa
natgeo
@euronews          # the @ is optional
```

- **Add a line** → the feed appears, and its first fetch happens on the next tick.
- **Remove a line** → the feed, its cached posts and every image it mirrored are
  deleted.

Changes are picked up within a minute without a restart. `docker kill -s HUP
<container>` forces an immediate re-read.

If the file is missing, unreadable, or contains no usable usernames, **nothing is
deleted** — the app logs an error and leaves every feed alone. A failed bind
mount or a bad edit should not be able to wipe your feeds, since that's the one
thing here that a re-fetch can't rebuild.

## Feed URLs

```
https://your-host/feeds/ig/nasa.xml
```

Predictable and public: there are no per-subscriber tokens, and every feed is
listed on the index page. Serving them costs nothing but local bandwidth, since
nothing on the request path talks to Instagram.

Each feed also has a small landing page at `/f/ig/{handle}`, which the RSS channel
`<link>` points at. That's deliberate rather than linking to instagram.com: some
readers (NetNewsWire among them) derive a feed's sidebar icon by scraping its home
page, and would otherwise show Instagram's glyph on every feed. The landing page
serves the account's own avatar as its icon.

## How it works

### Refreshing

A single 60-second tick runs four jobs. Each logs one line per run, and a job
still running from a previous tick is skipped rather than overlapped.

| Job             | Every | What it does                                         |
| --------------- | ----- | ---------------------------------------------------- |
| `sync-accounts` | 1 min | Diffs `accounts.txt` against the database            |
| `refresh-feeds` | 1 min | Refreshes up to 3 due accounts, one at a time        |
| `prune-history` | 24 h  | Drops fetch records and day counts past their window |
| `sweep-assets`  | 24 h  | Deletes image files no post references               |

Refreshes are **sequential with a 5-second gap**, never parallel. That's the
whole throttling strategy: it keeps at most one Instagram request in flight,
which is what a metered residential proxy wants and what Instagram's per-IP rate
limiting punishes you for ignoring. Three per minute is 180 accounts/hour of
capacity against a 60-minute refresh interval, so a 50-account list has ample
headroom — and adding 50 accounts at once spreads their first fetch over about 17
minutes instead of firing 50 requests simultaneously.

A failed fetch backs off and retries: 10 → 20 → 40 → 60 minutes for transient
failures, once a day for an account that can't work at all (deleted, renamed,
gone private). Nothing is ever given up on permanently, because private accounts
come back and Instagram occasionally 404s a live profile. A feed that has been
broken for over a day gets a `[SYSTEM]` entry explaining why it stopped, so you
find out in your reader rather than by checking the status page.

Cached posts are never dropped because a fetch failed — the previous items keep
serving.

### Posts and images

Each refresh keeps the newest 12 posts per feed and prunes the rest, deleting
both the post and its mirrored image.

Instagram's image URLs are signed, expire after a few days, and are
origin-restricted, so many readers can't load them at all. So each post's image is
downloaded once into `data/assets/` and the feed serves that stable URL instead.
If a download fails the post still appears, pointing at Instagram's URL, and the
next refresh retries the mirror.

Images are ~95% of the bytes this app pulls, so by default they're fetched
**directly** and only retried through the proxy if that fails — the CDN serves
signed URLs to any IP, while the profile API is the part that actually needs a
residential exit. Set `imageFetch` in `src/config.ts` to `'proxy'` or `'direct'`
to override.

The index page footer shows what `data/assets/` currently occupies. It's a
running total, adjusted at the only two moments the directory changes — an image
being stored and an image being deleted — so reading it never touches the
filesystem and the page's cost doesn't grow with the number of images. It's
established against the directory once at startup, and the daily sweep re-walks
it as a backstop against drift.

It counts what is really on disk rather than adding up the byte counts stored
against posts, so profile pictures and any orphans awaiting the next sweep are
included. Note that it sums apparent file sizes, so `du -sh data/assets` will
report slightly more (each file rounds up to a filesystem block), and it covers
only the images — not the SQLite database alongside them.

### Posts per day

Each feed on the index page carries a small `3.4/day` figure — how many new posts
that account has been producing. It's the number that predicts which feeds are
expensive, since new posts are the only thing that costs outbound bandwidth
(each one is a fetch plus an image download). Hover it for the underlying
figures; the per-feed landing page shows the same number in prose.

New posts are counted into a sparse per-day bucket as they're stored, inside the
same transaction that stores them, so the count can't drift from the posts it
counts. The average divides by **elapsed days observed**, not by the days that
happened to have posts — otherwise a feed that posted 20 times one day and then
went quiet would outrank one posting 15 every day.

Two deliberate exclusions keep it honest:

- A feed's **first fetch doesn't count.** It seeds up to a full feed at once,
  which is a backfill, not a day's posting.
- The denominator is **floored at one day**, so a feed added an hour ago that
  picked up one post reads `1/day` rather than `24/day`.

A feed that has never been fetched shows no figure at all rather than a made-up
zero. The window is `activityWindowDays` in `src/config.ts` (30 days).

### Conditional requests

Feeds carry an `ETag` and `Last-Modified` derived from when the feed's contents
last actually changed — not when it was last fetched. A refresh that finds nothing
new writes nothing and invalidates nothing, so a reader polling every 15 minutes
gets a `304` with no body and no XML rendered. This is the main reason the app
stays cheap under a lot of subscribers.

### Routing fetches through a proxy

Instagram rate-limits and blocks datacenter IPs, which is where most deployments
run. Set `OUTBOUND_PROXY_URL` to route the profile fetches through a residential
proxy:

```sh
OUTBOUND_PROXY_URL=http://user-<USER>-country-us-session-{session}:<PASS>@gate.decodo.com:7000
```

**Sticky sessions.** The adapter primes a logged-out guest session (cookies + CSRF
token) and then makes the profile request, and the two must leave from the same
exit IP. Include the literal token `{session}` anywhere in the URL and it is
substituted per request, so the pair shares one IP; a retry after a block rotates
to a fresh session, and therefore a fresh IP. Each account keeps a stable session
derived from its handle, so two accounts refreshed in sequence never share an exit
IP. With no `{session}` token the proxy just rotates per request — the placeholder
works with any session-capable HTTP proxy.

Credentials are never logged or stored; only the proxy host appears in the boot
line. When unset, fetches go out directly.

## Configuration

Tunable knobs live in [`src/config.ts`](src/config.ts) and are committed, so
changing one is a commit like any other: refresh interval, posts kept per feed,
fetch attempts, refreshes per tick, stagger, retention, backoff.

Only deployment values and secrets come from the environment:

| Variable             | Default                 | Purpose                                                                                                                                                                               |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_BASE_URL`    | `http://localhost:3000` | The public origin. Feed URLs and the image URLs inside feed items are built from it, so behind a reverse proxy it must be set. Changing it rewrites the stored URLs on the next boot. |
| `PORT`               | `3000`                  | Listen port                                                                                                                                                                           |
| `OUTBOUND_PROXY_URL` | —                       | Residential proxy for Instagram traffic (see above)                                                                                                                                   |
| `ACCOUNTS_FILE`      | `./accounts.txt`        | Path to the feed list                                                                                                                                                                 |
| `DATA_DIR`           | `./data`                | SQLite file and mirrored images                                                                                                                                                       |
| `LOG_LEVEL`          | `info`                  | `debug` \| `info` \| `warn` \| `error`                                                                                                                                                |

## Operations

Everything worth watching goes to stdout as one line per event:

```
INFO  rss-parser listening port=3000 url=https://rss.example.com feeds=12 proxy=gate.decodo.com:7000 …
INFO  job job=sync-accounts added=1 handles=+@newaccount feeds=13 took=3ms
INFO  refreshed handle=@nasa http=200 ms=812 items=12 new=2 pruned=2 images=2
WARN  refresh failed handle=@gone http=404 attempt=1 error="Instagram profile @gone not found"
INFO  job job=refresh-feeds ok=2 failed=1 new=2 pruned=2 images=2 took=16.0s
```

- `GET /healthz` returns 200 with feed count and last tick, or 503 if the
  scheduler has been stalled for over 5 minutes. Used by the container healthcheck.
- `data/` holds everything stateful (`rss.db` plus `assets/`) — that's the only
  thing to back up. Keep it on a normal filesystem; SQLite's WAL locking is
  unreliable on NFS/SMB.
- Deleting `data/` is recoverable: the feeds rebuild themselves from
  `accounts.txt` on the next few ticks.

## Architecture

```
accounts.txt          the feed list — the only thing you normally edit
src/
  server.ts           express app, routes, boot and shutdown
  config.ts           every tunable knob
  db.ts               schema, queries, and the refresh write transaction
  log.ts              one-line stdout logger
  views.ts            the index page and the per-feed landing page
  adapters/
    types.ts          SourceAdapter + NormalizedItem — the extension point
    instagram.ts      Instagram's web API, incl. the guest-session handshake
    registry.ts       type → adapter, and the /feeds/{prefix} mapping
  lib/
    plan.ts           the reconciliation planner (pure, unit-tested)
    activity.ts       posts-per-day arithmetic (pure, unit-tested)
    refresh.ts        fetch → plan → mirror → commit
    assets.ts         local image store
    rss.ts            RSS 2.0 rendering
    accounts.ts       accounts.txt parsing
    proxy.ts          optional HTTP proxy with sticky sessions
    errors.ts         flattens error causes into one readable message
  jobs/
    scheduler.ts      the tick loop
    syncAccounts.ts refreshFeeds.ts pruneHistory.ts sweepAssets.ts
```

The reconciliation planner is the one piece with real invariants — the stored
posts must end up as exactly the newest N of what was fetched plus what was
already there, so that a post the platform keeps re-serving isn't inserted and
deleted on every cycle, and a short response never empties a feed. It's pure and
covered by tests:

```sh
pnpm test
```

## Adding another source type

Everything platform-specific is in one adapter file.

1. Create `src/adapters/<type>.ts` implementing `SourceAdapter` from
   `src/adapters/types.ts`: fetch the latest posts and map them to
   `NormalizedItem`s (`externalId`, `title`, `content` HTML, `url`, `imageUrl`,
   `publishedAt`). Throw `PermanentFetchError` for failures no retry can fix and
   `RetryableFetchError` for IP-level blocks.
2. Register it in `src/adapters/registry.ts` and give it a URL prefix in
   `FEED_PREFIXES`.

Refreshing, caching, image mirroring, pruning, error backoff and RSS rendering
all pick it up. The account list would need a way to say which platform a handle
belongs to — today every line in `accounts.txt` is an Instagram username.

## Caveats

- **The Instagram adapter uses Instagram's unofficial web API** — the same
  endpoint instagram.com itself uses. It needs no credentials and works for public
  profiles, but Instagram may rate-limit or block it, especially from datacenter
  IPs. Errors appear on the index page and in the logs; cached posts keep serving.
- Only public profiles work. A private account is reported as such and retried
  daily in case it opens up.
- Feed URLs are unauthenticated and enumerable by design. If that matters, put
  the whole app behind basic auth at the reverse proxy.
