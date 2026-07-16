import config from '@payload-config'
import { RichText } from '@payloadcms/richtext-lexical/react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import { Wordmark } from '@/components/Wordmark'
import { newsTeaser } from '@/lib/news'
import type { News } from '@/payload-types'
import '../../styles.css'

type Params = { slug: string }

async function getPost(slug: string): Promise<News | null> {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'news',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
  })
  return docs[0] ?? null
}

/**
 * Prerender every post at build; posts created afterwards render on first hit
 * (dynamicParams defaults to true) and are then cached until the collection's
 * afterChange hook purges them. Guarded like the list page so a fresh-host
 * build (no news table yet) still succeeds.
 */
export async function generateStaticParams(): Promise<Params[]> {
  try {
    const payload = await getPayload({ config })
    const { docs } = await payload.find({ collection: 'news', limit: 1000, depth: 0 })
    return docs.flatMap((post) => (post.slug ? [{ slug: post.slug }] : []))
  } catch {
    return []
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) return { title: 'Post not found' }
  const description = newsTeaser(post)
  return {
    title: post.title,
    description,
    openGraph: { title: post.title, description, url: `/news/${post.slug}` },
  }
}

export default async function NewsPostPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params
  const post = await getPost(slug)
  if (!post) notFound()

  return (
    <div className="page">
      <header className="masthead">
        <Link className="wordmark-link" href="/">
          <Wordmark />
        </Link>
        <span className="masthead-meta">
          <Link href="/news">news</Link>
        </span>
      </header>

      <article>
        <h1 className="news-title">{post.title}</h1>
        <p className="news-date">{new Date(post.publishedAt).toISOString().slice(0, 10)}</p>
        <div className="news-body">
          <RichText data={post.content} />
        </div>
      </article>

      <footer className="colophon">
        <Link href="/news">← all news</Link>
      </footer>
    </div>
  )
}
