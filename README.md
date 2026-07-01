# RSS Parser

Turn Instagram feeds (and, in the future, other sources) into RSS feeds you can subscribe to in your RSS reader. Built on [Payload CMS](https://payloadcms.com) — the Payload admin dashboard **is** the tool: sources are managed there, no separate frontend needed.

## Quick start

```sh
pnpm install
cp .env.example .env   # set a real PAYLOAD_SECRET
pnpm dev
```

Open [http://localhost:3000/admin](http://localhost:3000/admin), create your admin user, and you're in. Data lives in a local SQLite file (`rss-parser.db`) — nothing else to set up.

## Usage

1. In the dashboard, go to **Sources → Create New**.
2. Give it a name (e.g. "NASA"), keep type `Instagram`, and enter the Instagram username as the handle (e.g. `nasa`).
3. Save. The latest posts are fetched immediately — check the **Feed URL** in the sidebar and the **Last fetch** status.
4. Subscribe to the feed URL in your RSS reader: `http://localhost:3000/feeds/{slug}`

The homepage at `/` lists all enabled feeds with their subscribe links.

### How refreshing works

- When your RSS reader polls a feed, the app re-fetches from the source if the cached items are older than the source's **refresh interval** (default 60 min, configurable per source).
- Saving a source with a new handle re-fetches immediately.
- You can force a refresh with `POST /api/sources/{id}/refresh` (authenticated).
- If a fetch fails (rate limit, private account, …), the error shows on the source under **Last fetch**, and the feed keeps serving the previously cached items.

## Architecture

```
src/
  collections/
    Sources.ts        one doc per feed — the thing you manage in the dashboard
    FeedItems.ts      normalized cache of fetched posts (managed automatically)
    Users.ts          admin auth
  adapters/
    types.ts          SourceAdapter interface + NormalizedItem — the extension point
    registry.ts       maps source type → adapter
    instagram.ts      Instagram adapter
  lib/
    refresh.ts        fetch via adapter, upsert into feed-items, record status
    rss.ts            render RSS 2.0 XML
  app/
    feeds/[slug]/     public RSS endpoint
    (payload)/        Payload admin + REST API (scaffolded)
```

## Adding a new source type

Everything platform-specific lives in one adapter file. To add e.g. YouTube:

1. Create `src/adapters/youtube.ts` implementing `SourceAdapter` from `src/adapters/types.ts`: fetch the latest posts and map them to `NormalizedItem`s (`externalId`, `title`, `content` HTML, `url`, `imageUrl`, `publishedAt`).
2. Register it in `src/adapters/registry.ts` (one line).

That's it — the `type` dropdown in the dashboard, caching, TTL refresh, error reporting, and RSS rendering all pick it up automatically.

## Caveats

- **The Instagram adapter uses Instagram's unofficial web API** (the same endpoint instagram.com itself uses). It needs no credentials and works for public profiles, but Instagram may rate-limit or block it — especially from datacenter/VPS IPs. If that happens, errors appear on the source and cached items keep serving. The adapter is isolated, so it can be swapped for the official Graph API or an [RSS-Bridge](https://github.com/RSS-Bridge/rss-bridge) proxy without touching anything else.
- Instagram image URLs are signed and expire after a while; older entries in your reader may lose their images. The permalink in each entry always works.
- **Feeds are public** (RSS readers can't log in). If you deploy this somewhere public, keep the URL private or put it behind a reverse-proxy with basic auth.
- Set `PAYLOAD_PUBLIC_SERVER_URL` in `.env` to your deployed URL so the feed URLs shown in the dashboard are correct.

## Possible extensions

- Scheduled background refresh via [Payload's jobs queue](https://payloadcms.com/docs/jobs-queue/overview) instead of refresh-on-poll.
- More adapters (YouTube, Mastodon, newsletters, …) — see above.
- Mirroring images into Payload's media library so entries don't lose images when Instagram's signed URLs expire.
