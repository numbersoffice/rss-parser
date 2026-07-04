# RSS Parser

Turn Instagram feeds (and, in the future, other sources) into RSS feeds you can subscribe to in your RSS reader. Built on [Payload CMS](https://payloadcms.com) — the Payload admin dashboard **is** the tool: subscriptions are managed there, no separate frontend needed. Multi-user with shared, deduplicated fetching.

## Quick start

```sh
pnpm install
cp .env.example .env   # set a real PAYLOAD_SECRET
pnpm dev
```

Open [http://localhost:3000/admin](http://localhost:3000/admin) and create the first account — **the first user automatically becomes the admin**. Data lives in a local SQLite file (`rss-parser.db`), nothing else to set up.

## Usage

1. In the dashboard, go to **Subscriptions → Create New**.
2. Keep type `Instagram` and enter the Instagram username as the handle (e.g. `nasa`).
3. Save. The sidebar shows your private **Feed URL** — subscribe to it in your RSS reader.

The homepage at `/` lists your subscriptions with their feed links when you're logged in.

## How it works

### Roles

- **user** (default): sees only the Subscriptions collection and manages their own.
- **admin**: additionally manages Users, the shared Sources, and cached Feed Items. Roles are assigned by admins on the user profile.

### Shared sources, deduplicated fetching

Behind every subscription is a canonical **Source** — one per platform account, no matter how many people follow it. Subscribing to an account someone already follows silently reuses the existing source, so each account is fetched exactly once per refresh interval.

### Per-subscription feed URLs

Each subscription gets its own unguessable URL: `/feeds/{token}`. Deleting the subscription breaks the URL — your reader shows the feed as gone, and nobody who had the URL can keep reading through your instance.

### CRUD semantics

- A subscription's **type/handle are immutable** for users: to follow a different account, delete the subscription and add a new one (admins can edit anything).
- **Deleting** a subscription affects only you; other subscribers to the same source are untouched.
- When the **last** subscription to a source is deleted, the source and its cached items are garbage-collected automatically. Deleting a user cascades the same way.

### Refreshing

- When a reader polls a feed URL, the shared source re-fetches if its cache is older than the **refresh interval** (default 60 min, admin-configurable per source).
- The first subscriber to a new account triggers an immediate fetch.
- Admins can force a fetch with `POST /api/sources/{id}/refresh`.
- If a fetch fails (rate limit, private account, …), the error shows on the source under **Last fetch** and the feed keeps serving the previously cached items.

### Routing fetches through a proxy

Instagram (and similar sources) often rate-limit or block requests coming from datacenter/VPS IPs, which is where most deployments run. To work around this, outbound adapter traffic can be routed through an HTTP proxy — typically a **residential proxy**, so the source sees an ordinary consumer IP rather than a datacenter one.

Set `OUTBOUND_PROXY_URL` in `.env` to your proxy endpoint (credentials can be embedded in the URL). The default is [Decodo](https://decodo.com) residential, where targeting and session parameters are carried in the username:

```sh
OUTBOUND_PROXY_URL=http://user-<DECODO_USERNAME>-country-us-session-{session}:<DECODO_PASSWORD>@gate.decodo.com:7000
```

**Sticky sessions.** The Instagram adapter primes a logged-out guest session (cookies + CSRF token) and then makes the profile request, and the two must leave from the same IP. Include the literal token `{session}` anywhere in the URL and it is replaced with a fresh id per fetch, so both calls share one exit IP while different fetches still rotate. With no `{session}` token the proxy just rotates per request — the placeholder works with any session-capable HTTP proxy.

When unset, fetches go out directly. Only adapter traffic uses the proxy — the app's own requests never consume proxy bandwidth. For troubleshooting, each source records the HTTP status and timing of its last fetch (plus whether the guest-session prime succeeded) under **Last fetch** (credentials are never stored or displayed).

## Architecture

```
src/
  collections/
    Subscriptions.ts  per-user: type + handle + private feed token
    Sources.ts        canonical, shared, one per (type, handle) — admin-only
    FeedItems.ts      normalized cache of fetched posts — admin-only
    Users.ts          auth + role (user/admin)
  adapters/
    types.ts          SourceAdapter interface + NormalizedItem — the extension point
    registry.ts       maps source type → adapter
    instagram.ts      Instagram adapter
  lib/
    access.ts         role-based access helpers
    sources.ts        find-or-create dedupe + orphan garbage collection
    refresh.ts        fetch via adapter, upsert into feed-items, record status
    proxy.ts          optional HTTP proxy for outbound adapter fetches
    rss.ts            render RSS 2.0 XML
  app/
    feeds/[token]/    per-subscription RSS endpoint
    (payload)/        Payload admin + REST API (scaffolded)
```

## Adding a new source type

Everything platform-specific lives in one adapter file. To add e.g. YouTube:

1. Create `src/adapters/youtube.ts` implementing `SourceAdapter` from `src/adapters/types.ts`: fetch the latest posts and map them to `NormalizedItem`s (`externalId`, `title`, `content` HTML, `url`, `imageUrl`, `publishedAt`).
2. Register it in `src/adapters/registry.ts` (one line).

That's it — the `type` dropdown, source dedupe, caching, TTL refresh, error reporting, and RSS rendering all pick it up automatically.

## Caveats

- **The Instagram adapter uses Instagram's unofficial web API** (the same endpoint instagram.com itself uses). It needs no credentials and works for public profiles, but Instagram may rate-limit or block it — especially from datacenter/VPS IPs (see [Routing fetches through a proxy](#routing-fetches-through-a-proxy)). Errors appear on the source; cached items keep serving. The adapter is isolated, so it can be swapped for the official Graph API or an [RSS-Bridge](https://github.com/RSS-Bridge/rss-bridge) proxy without touching anything else.
- Instagram image URLs are signed and expire after a while; older entries in your reader may lose their images. The permalink in each entry always works.
- Feed URLs are unauthenticated by design (RSS readers can't log in) but unguessable. Treat them like private links.
- Set `PAYLOAD_PUBLIC_SERVER_URL` in `.env` to your deployed URL so the feed URLs shown in the dashboard are correct.

## Possible extensions

- Scheduled background refresh via [Payload's jobs queue](https://payloadcms.com/docs/jobs-queue/overview) instead of refresh-on-poll.
- More adapters (YouTube, Mastodon, newsletters, …) — see above.
- Mirroring images into Payload's media library so entries don't lose images when Instagram's signed URLs expire.
- Self-registration (Payload auth supports it) if you ever want to open the instance to others without creating accounts by hand.
