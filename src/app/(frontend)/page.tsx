import { getPayload } from 'payload'
import React from 'react'

import config from '@/payload.config'
import './styles.css'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })

  const sources = await payload.find({
    collection: 'sources',
    where: { enabled: { equals: true } },
    sort: 'name',
    limit: 100,
    depth: 0,
  })

  return (
    <div className="home">
      <div className="content">
        <h1>RSS feeds</h1>
        {sources.docs.length === 0 && (
          <p>No feeds yet — add a source in the admin panel.</p>
        )}
        {sources.docs.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, textAlign: 'left' }}>
            {sources.docs.map((source) => (
              <li key={source.id} style={{ margin: '0.5rem 0' }}>
                <a href={`/feeds/${source.slug}`}>{source.name}</a>{' '}
                <small>
                  ({source.type}: {source.handle})
                </small>
              </li>
            ))}
          </ul>
        )}
        <div className="links">
          <a className="admin" href={payloadConfig.routes.admin}>
            Go to admin panel
          </a>
        </div>
      </div>
    </div>
  )
}
