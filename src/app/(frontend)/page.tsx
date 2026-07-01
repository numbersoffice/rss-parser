import { headers as getHeaders } from 'next/headers.js'
import { getPayload } from 'payload'
import React from 'react'

import config from '@/payload.config'
import './styles.css'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const headers = await getHeaders()
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const { user } = await payload.auth({ headers })

  const subscriptions = user
    ? await payload.find({
        collection: 'subscriptions',
        where: { user: { equals: user.id } },
        sort: 'handle',
        limit: 100,
        depth: 0,
      })
    : null

  return (
    <div className="home">
      <div className="content">
        <h1>Your RSS feeds</h1>
        {!user && <p>Log in to see your feeds.</p>}
        {subscriptions && subscriptions.docs.length === 0 && (
          <p>No feeds yet — add a subscription in the dashboard.</p>
        )}
        {subscriptions && subscriptions.docs.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, textAlign: 'left' }}>
            {subscriptions.docs.map((subscription) => (
              <li key={subscription.id} style={{ margin: '0.5rem 0' }}>
                <a href={`/feeds/${subscription.token}`}>@{subscription.handle}</a>{' '}
                <small>({subscription.type})</small>
              </li>
            ))}
          </ul>
        )}
        <div className="links">
          <a className="admin" href={payloadConfig.routes.admin}>
            {user ? 'Go to dashboard' : 'Log in'}
          </a>
        </div>
      </div>
    </div>
  )
}
