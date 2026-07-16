import config from '@payload-config'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getPayload } from 'payload'
import React from 'react'

import { Wordmark } from '@/components/Wordmark'
import { newsTeaser } from '@/lib/news'
import type { News } from '@/payload-types'
import '../styles.css'

const description = 'Product news and release notes for rss-parser.'

export const metadata: Metadata = {
  title: 'News',
  description,
  openGraph: { title: 'News — RSS Parser', description, url: '/news' },
}

/**
 * All posts, newest first. Guarded so `next build` on a fresh host (no news
 * table yet — prod migrations run at boot, after build) still prerenders;
 * the afterChange hook on the collection revalidates this page at runtime.
 */
async function getPosts(): Promise<News[]> {
  try {
    const payload = await getPayload({ config })
    const { docs } = await payload.find({
      collection: 'news',
      sort: '-publishedAt',
      limit: 100,
      depth: 0,
    })
    return docs
  } catch {
    return []
  }
}

export default async function NewsPage() {
  const posts = await getPosts()

  return (
    <div className="page">
      <header className="masthead">
        <Link className="wordmark-link" href="/">
          <Wordmark />
        </Link>
        <span className="masthead-meta">
          <a href="https://github.com/numbersoffice/rss-parser/tree/main">github</a>
        </span>
      </header>

      <h2 className="section-label"># news</h2>
      {posts.length === 0 ? (
        <p>Nothing here yet.</p>
      ) : (
        <ul className="news-list">
          {posts.map((post) => (
            <li key={post.id}>
              <Link href={`/news/${post.slug}`}>{post.title}</Link>
              <span className="news-date">
                {new Date(post.publishedAt).toISOString().slice(0, 10)}
              </span>
              <p className="news-snippet">{newsTeaser(post)}</p>
            </li>
          ))}
        </ul>
      )}

      <footer className="colophon">no tracking · powered by Payload CMS</footer>
    </div>
  )
}
