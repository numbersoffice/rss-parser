import config from '@payload-config'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { getAdapter } from '@/adapters/registry'
import { Wordmark } from '@/components/Wordmark'
import type { FeedItem } from '@/payload-types'
import { getSource } from './getSource'
import '../../../styles.css'

export const dynamic = 'force-dynamic'

const RECENT_LIMIT = 15

type Params = { type: string; handle: string }

/** Link to the account on the origin platform (e.g. the Instagram profile). */
function platformUrl(source: NonNullable<Awaited<ReturnType<typeof getSource>>>): string | null {
  try {
    return getAdapter(source.type).sourceUrl?.(source) ?? null
  } catch {
    return null
  }
}

/*
 * The channel <link> of every feed points here rather than at the platform, so
 * an RSS reader deriving the feed's icon scrapes this page — whose apple-touch
 * icon is the account's profile picture (see ./apple-icon) — instead of the
 * platform's own favicon (which is just its logo). The apple-icon route is the
 * load-bearing part; this page is the human-facing counterpart, matching the
 * landing page's low-fi aesthetic.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { type, handle } = await params
  const source = await getSource(type, handle)
  if (!source) return { title: 'Feed not found' }
  return {
    title: source.name,
    description: `${source.type} feed for @${source.handle}`,
    openGraph: source.profileImageUrl
      ? { title: source.name, images: [source.profileImageUrl] }
      : { title: source.name },
  }
}

export default async function FeedLandingPage({ params }: { params: Promise<Params> }) {
  const { type, handle } = await params
  const source = await getSource(type, handle)
  if (!source) notFound()

  const payload = await getPayload({ config })
  const recent = await payload.find({
    collection: 'feed-items',
    where: { source: { equals: source.id } },
    sort: '-publishedAt',
    limit: RECENT_LIMIT,
    depth: 0,
  })
  const items = recent.docs as FeedItem[]
  const accountUrl = platformUrl(source)

  return (
    <div className="page">
      <header className="masthead">
        <a className="wordmark-link" href="/">
          <Wordmark />
        </a>
        <span className="masthead-meta">
          <a href="https://github.com/numbersoffice/rss-parser/tree/main">github</a>
        </span>
      </header>

      <section className="feed-profile">
        {source.profileImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="feed-avatar"
            src={source.profileImageUrl}
            alt={`${source.name} profile picture`}
            width={72}
            height={72}
          />
        )}
        <div className="feed-profile-meta">
          <h1 className="feed-title">{source.name}</h1>
          <p className="feed-sub">
            {source.type} feed · @{source.handle}
          </p>
        </div>
      </section>

      <p>
        This page is the home of an <strong>{source.type}</strong> feed produced by rss-parser.
        Paste your private feed URL into any RSS reader to follow it.
      </p>

      {accountUrl && (
        <p className="cta-row">
          <a className="cta" href={accountUrl} rel="noopener noreferrer">
            view on {source.type} →
          </a>
        </p>
      )}

      <h2 className="section-label"># recent posts</h2>
      {items.length === 0 ? (
        <p>No posts cached yet.</p>
      ) : (
        <ul className="feed-list">
          {items.map((item) => (
            <li key={item.id}>
              <a href={item.url} rel="noopener noreferrer">
                {item.title}
              </a>
              <span className="feed-type">
                {new Date(item.publishedAt).toISOString().slice(0, 10)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <footer className="colophon">no tracking · powered by Payload CMS</footer>
    </div>
  )
}
