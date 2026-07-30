import { prefixForType } from './adapters/registry.js'
import { config } from './config.js'
import type { ItemRow, SourceRow } from './db.js'
import { type Average, formatPerDay } from './lib/activity.js'
import type { AssetUsage } from './lib/assets.js'
import { escapeHtml } from './lib/html.js'
import { feedUrlFor, landingUrl, sourceLink } from './lib/rss.js'

/**
 * The two HTML pages, as template strings. No template engine and no client-side
 * framework: one status page and one tiny landing page don't justify either.
 */

/*
 * Deliberately low-fi, as the pre-rewrite landing page was: one system monospace
 * stack, no webfonts, no external requests. Black on white paper, default browser
 * link blue as the only accent. Rows are separated by whitespace alone — no rules,
 * borders, or boxes.
 */
const STYLES = `
  :root {
    --bg: #ffffff; --fg: #000000; --muted: #8a8a8a; --line: #eeeeee;
    --accent: #0000ee; --visited: #551a8b; --bad: #cc0000;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  }
  * { box-sizing: border-box; }
  html { background: var(--bg); -webkit-font-smoothing: antialiased; }
  body {
    margin: 0; padding: 3rem 1.25rem 2rem; background: var(--bg); color: var(--fg);
    font: 15px/1.7 var(--mono);
  }
  main { max-width: 44rem; margin: 0 auto; }
  h1 { font-size: 20px; font-weight: 700; margin: 0 0 .3rem; }
  .sub { color: var(--muted); margin: 0 0 2rem; font-size: 13px; }
  code, .mono { font-family: var(--mono); font-size: .82rem; }
  a { color: var(--accent); }
  a:visited { color: var(--visited); }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  ul { list-style: none; margin: 1.25rem 0; padding: 0; }
  li { padding: .9rem 0; display: grid; gap: .45rem; }
  .row { display: flex; flex-wrap: wrap; align-items: center; gap: .55rem; }
  .handle { font-weight: 700; }
  .avatar {
    width: 34px; height: 34px; object-fit: cover;
    background: var(--line); flex: none;
  }
  .feed {
    display: block; overflow-x: auto; white-space: nowrap; font-size: 13px;
  }
  .meta { color: var(--muted); font-size: 13px; }
  .badge { font-size: 12px; }
  .badge::before { content: "["; }
  .badge::after { content: "]"; }
  .badge.ok { color: var(--accent); }
  .badge.bad { color: var(--bad); }
  .badge.wait { color: var(--muted); }
  .rate { font-size: 12px; color: var(--muted); cursor: help; }
  .err { color: var(--bad); font-size: 13px; word-break: break-word; }
  footer { margin-top: 3.5rem; color: var(--muted); font-size: 13px; }
  .empty { padding: 1.5rem 0; }
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

/** Byte sizes at a glance — powers of 1024, one decimal from MB up. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function until(ms: number): string {
  const minutes = Math.round((ms - Date.now()) / 60_000)
  if (minutes <= 0) return 'due now'
  if (minutes < 60) return `in ${minutes}m`
  return `in ${Math.round(minutes / 60)}h`
}

/**
 * How many new posts a feed gets per day. Carries the underlying figures in a
 * tooltip so the number can be sanity-checked without opening the database, and
 * renders nothing at all for a feed that hasn't been fetched yet — there is no
 * observation period to average over.
 */
function perDayBadge(average: Average | null | undefined): string {
  if (!average) return ''
  const days = Math.round(average.days)
  const title = `${average.posts} new post${average.posts === 1 ? '' : 's'} over ${days} day${days === 1 ? '' : 's'}`
  return `<span class="rate" title="${escapeHtml(title)}">${formatPerDay(average.perDay)}/day</span>`
}

function statusBadge(source: SourceRow): string {
  if (source.permanent_error) return '<span class="badge bad">broken</span>'
  if (source.last_fetch_status === 'error') return '<span class="badge bad">failing</span>'
  if (source.last_fetch_status === 'success') return '<span class="badge ok">ok</span>'
  return '<span class="badge wait">pending</span>'
}

/** The single page listing every published feed. */
export function renderIndex(
  sources: SourceRow[],
  counts: Map<number, number>,
  averages: Map<number, Average | null>,
  usage: AssetUsage,
): string {
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
      ${perDayBadge(averages.get(source.id))}
      <span class="meta">${count} post${count === 1 ? '' : 's'} · updated ${escapeHtml(ago(source.last_fetched_at))} · next ${escapeHtml(until(source.next_fetch_at))}</span>
    </div>
    <a class="feed mono" href="${escapeHtml(feedUrl)}">${escapeHtml(feedUrl)}</a>
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
    <div class="meta"><a href="${escapeHtml(landingUrl(source))}">about</a></div>
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
<p class="sub">${sources.length} Instagram account${sources.length === 1 ? '' : 's'} published as RSS. The list comes from <a href="https://github.com/numbersoffice/rss-parser/blob/main/accounts.txt"><code>accounts.txt</code></a>.</p>
${body}
<footer>Refreshed every ${config.refreshIntervalMinutes} minutes, keeping the newest ${config.maxItemsPerFeed} posts per feed.<br />
Mirrored images: <strong>${formatBytes(usage.bytes)}</strong> across ${usage.files} file${usage.files === 1 ? '' : 's'}.</footer>`,
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
export function renderLanding(
  source: SourceRow,
  items: ItemRow[],
  average: Average | null,
): string {
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
<p class="sub">Instagram posts by <a href="${escapeHtml(sourceLink(source))}">@${escapeHtml(source.handle)}</a>, as RSS.${
      average
        ? ` Averaging <strong>${formatPerDay(average.perDay)}</strong> new posts per day.`
        : ''
    }</p>
<a class="feed mono" href="${escapeHtml(feedUrlFor(source))}">${escapeHtml(feedUrlFor(source))}</a>
${items.length ? `<ul style="margin-top:1.5rem">\n${recent}\n</ul>` : '<p class="meta" style="margin-top:1.5rem">No posts cached yet.</p>'}
<footer><a href="${escapeHtml(config.publicBaseUrl)}/">All feeds</a></footer>`,
  )
}
