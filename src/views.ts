import { prefixForType } from './adapters/registry.js'
import { config } from './config.js'
import type { ItemRow, SourceRow } from './db.js'
import { escapeHtml } from './lib/html.js'
import { feedUrlFor, landingUrl, sourceLink } from './lib/rss.js'

/**
 * The two HTML pages, as template strings. No template engine and no client-side
 * framework: one status page and one tiny landing page don't justify either.
 */

const STYLES = `
  :root {
    color-scheme: light dark;
    --bg: #fbfbfa; --fg: #1a1a1a; --muted: #6b6b6b; --line: #e4e4e1;
    --card: #ffffff; --accent: #b4530a; --ok: #2f7a3d; --bad: #b3261e;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #16161a; --fg: #e8e8e6; --muted: #9a9a96; --line: #2c2c33;
      --card: #1d1d22; --accent: #f0913f; --ok: #6cc286; --bad: #f2837c;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2.5rem 1.25rem 4rem; background: var(--bg); color: var(--fg);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 54rem; margin: 0 auto; }
  h1 { font-size: 1.35rem; margin: 0 0 .3rem; letter-spacing: -.01em; }
  .sub { color: var(--muted); margin: 0 0 2rem; font-size: .9rem; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem; }
  a { color: var(--accent); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: .6rem; }
  li {
    background: var(--card); border: 1px solid var(--line); border-radius: 9px;
    padding: .8rem .95rem; display: grid; gap: .45rem;
  }
  .row { display: flex; flex-wrap: wrap; align-items: baseline; gap: .55rem; }
  .handle { font-weight: 600; }
  .avatar {
    width: 30px; height: 30px; border-radius: 50%; object-fit: cover;
    background: var(--line); flex: none;
  }
  .feed {
    display: block; overflow-x: auto; white-space: nowrap;
    background: color-mix(in srgb, var(--fg) 5%, transparent);
    border-radius: 5px; padding: .32rem .5rem;
  }
  .meta { color: var(--muted); font-size: .8rem; }
  .badge { font-size: .72rem; padding: .1rem .42rem; border-radius: 4px; border: 1px solid; }
  .badge.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
  .badge.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, transparent); }
  .badge.wait { color: var(--muted); border-color: var(--line); }
  .err { color: var(--bad); font-size: .8rem; word-break: break-word; }
  footer { margin-top: 2.5rem; color: var(--muted); font-size: .8rem; }
  .empty { background: var(--card); border: 1px dashed var(--line); border-radius: 9px; padding: 1.5rem; }
`

const layout = (title: string, head: string, body: string): string =>
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
${head}</head>
<body>
<main>
${body}
</main>
</body>
</html>
`

/** Coarse relative time, good enough for "how stale is this feed". */
function ago(ms: number | null): string {
  if (!ms) return 'never'
  const seconds = Math.round((Date.now() - ms) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function until(ms: number): string {
  const minutes = Math.round((ms - Date.now()) / 60_000)
  if (minutes <= 0) return 'due now'
  if (minutes < 60) return `in ${minutes}m`
  return `in ${Math.round(minutes / 60)}h`
}

function statusBadge(source: SourceRow): string {
  if (source.permanent_error) return '<span class="badge bad">broken</span>'
  if (source.last_fetch_status === 'error') return '<span class="badge bad">failing</span>'
  if (source.last_fetch_status === 'success') return '<span class="badge ok">ok</span>'
  return '<span class="badge wait">pending</span>'
}

/** The single page listing every published feed. */
export function renderIndex(sources: SourceRow[], counts: Map<number, number>): string {
  const items = sources
    .map((source) => {
      const feedUrl = feedUrlFor(source)
      const count = counts.get(source.id) ?? 0
      const avatar = source.profile_image_url
        ? `<img class="avatar" src="${escapeHtml(source.profile_image_url)}" alt="" />`
        : '<span class="avatar"></span>'
      const error =
        source.permanent_error ??
        (source.last_fetch_status === 'error' ? source.last_fetch_error : null)

      return `  <li>
    <div class="row">
      ${avatar}
      <span class="handle">@${escapeHtml(source.handle)}</span>
      ${statusBadge(source)}
      <span class="meta">${count} post${count === 1 ? '' : 's'} · updated ${escapeHtml(ago(source.last_fetched_at))} · next ${escapeHtml(until(source.next_fetch_at))}</span>
    </div>
    <a class="feed mono" href="${escapeHtml(feedUrl)}">${escapeHtml(feedUrl)}</a>
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
    <div class="meta"><a href="${escapeHtml(landingUrl(source))}">about</a> · <a href="${escapeHtml(sourceLink(source))}">on instagram</a></div>
  </li>`
    })
    .join('\n')

  const body = sources.length
    ? `<ul>\n${items}\n</ul>`
    : `<div class="empty">No feeds yet. Add an Instagram username to <code>accounts.txt</code>, one per line — it is picked up within a minute.</div>`

  return layout(
    'Feeds — rss-parser',
    '',
    `<h1>Feeds</h1>
<p class="sub">${sources.length} Instagram account${sources.length === 1 ? '' : 's'} published as RSS. The list comes from <code>accounts.txt</code>.</p>
${body}
<footer>Refreshed every ${config.refreshIntervalMinutes} minutes, keeping the newest ${config.maxItemsPerFeed} posts per feed.</footer>`,
  )
}

/**
 * The per-feed landing page. It exists for one reason: RSS readers that derive a
 * feed's sidebar icon by scraping its home page (NetNewsWire among them) prefer
 * that page's favicon over the feed's declared image. Pointing the channel
 * <link> here instead of at instagram.com is what stops them showing Instagram's
 * glyph for every feed.
 *
 * Unlike the Next.js version, the icon <link> tags have to be written out
 * explicitly — there is no file-convention magic injecting them.
 */
export function renderLanding(source: SourceRow, items: ItemRow[]): string {
  const icon = `${config.publicBaseUrl}/f/${prefixForType(source.type)}/${encodeURIComponent(source.handle)}/icon`
  const head =
    `<link rel="icon" href="${escapeHtml(icon)}" sizes="any" />\n` +
    `<link rel="apple-touch-icon" sizes="180x180" href="${escapeHtml(icon)}" />\n` +
    `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(source.name)}" href="${escapeHtml(feedUrlFor(source))}" />\n`

  const recent = items
    .map(
      (item) =>
        `  <li><div class="row"><span class="meta mono">${new Date(item.published_at).toISOString().slice(0, 10)}</span> <a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></div></li>`,
    )
    .join('\n')

  return layout(
    source.name,
    head,
    `<h1>${escapeHtml(source.name)}</h1>
<p class="sub">Instagram posts by <a href="${escapeHtml(sourceLink(source))}">@${escapeHtml(source.handle)}</a>, as RSS.</p>
<a class="feed mono" href="${escapeHtml(feedUrlFor(source))}">${escapeHtml(feedUrlFor(source))}</a>
${items.length ? `<ul style="margin-top:1.5rem">\n${recent}\n</ul>` : '<p class="meta" style="margin-top:1.5rem">No posts cached yet.</p>'}
<footer><a href="${escapeHtml(config.publicBaseUrl)}/">All feeds</a></footer>`,
  )
}
