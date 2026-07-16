import type { WidgetServerProps } from 'payload'

import Link from 'next/link'

import { newsTeaser } from '@/lib/news'

/**
 * Dashboard widget: the most recent news post — title, date and teaser — with
 * links to the post itself and the full /news page. News posts are public, so
 * no role guard is needed.
 *
 * Registered under admin.dashboard.widgets in payload.config.ts (admins add it
 * from the dashboard editor) and part of the fixed user dashboard
 * (src/components/RoleDashboard.tsx).
 */
export async function NewsWidget(props: WidgetServerProps) {
  const { payload } = props.req

  const { docs } = await payload.find({
    collection: 'news',
    sort: '-publishedAt',
    limit: 1,
    depth: 0,
  })
  const post = docs[0]

  return (
    <div className="news-widget">
      <div className="news-widget__header">
        <span className="news-widget__title">News</span>
        <Link className="news-widget__link" href="/news" prefetch={false}>
          All posts →
        </Link>
      </div>

      {post ? (
        <article className="news-widget__post">
          <Link className="news-widget__post-title" href={`/news/${post.slug}`} prefetch={false}>
            {post.title}
          </Link>
          <time className="news-widget__date" dateTime={post.publishedAt}>
            {formatDate(post.publishedAt)}
          </time>
          <p className="news-widget__teaser">{newsTeaser(post)}</p>
        </article>
      ) : (
        <p className="news-widget__empty">Nothing here yet.</p>
      )}
    </div>
  )
}

/** Render an ISO date as a short, locale-stable "Jul 7, 2026". */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
