import { headers as getHeaders } from 'next/headers.js'
import { getPayload } from 'payload'
import React from 'react'

import config from '@/payload.config'
import './styles.css'

export const dynamic = 'force-dynamic'

/* The hero speaks the format this tool produces. */
function XmlHero() {
  const tag = (text: string) => <span className="xml-tag">{`<${text}>`}</span>
  return (
    <pre className="hero" aria-label="rss-parser turns Instagram accounts into RSS feeds">
      <span className="xml-decl">{'<?xml version="1.0" encoding="UTF-8"?>'}</span>
      {'\n'}
      {tag('rss version="2.0"')}
      {'\n  '}
      {tag('channel')}
      {'\n    '}
      {tag('title')}
      <span className="xml-text">rss-parser</span>
      {tag('/title')}
      {'\n    '}
      {tag('description')}
      {'\n      '}
      <span className="xml-text">Follow Instagram accounts</span>
      {'\n      '}
      <span className="xml-text">from your RSS reader.</span>
      {'\n    '}
      {tag('/description')}
      {'\n    '}
      {tag('ttl')}
      <span className="xml-text">60</span>
      {tag('/ttl')}
      {'\n  '}
      {tag('/channel')}
      {'\n'}
      {tag('/rss')}
      <span className="cursor" aria-hidden="true">
        ▊
      </span>
    </pre>
  )
}

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
    <div className="page">
      <header className="masthead">
        <span className="wordmark">rss-parser</span>
        <span className="masthead-meta">self-hosted · instagram → rss</span>
      </header>

      <XmlHero />

      {!user && (
        <>
          <p>
            This instance turns public Instagram accounts into plain RSS 2.0 feeds. Add a handle,
            get a private feed URL, paste it into your reader. No app, no algorithm, no Instagram
            account.
          </p>
          <ul className="facts">
            <li>
              Each account is fetched once and shared by everyone here — Instagram sees one polite
              visitor, not a crowd.
            </li>
            <li>
              Your feed URL is unguessable and yours alone. Delete the subscription and the URL
              stops working.
            </li>
            <li>
              Open source, one SQLite file, runs anywhere Node runs. New platforms are a one-file
              adapter away.
            </li>
          </ul>
          <p className="cta-row">
            <a className="cta" href={payloadConfig.routes.admin}>
              [ log in / create an account → ]
            </a>
          </p>
        </>
      )}

      {user && (
        <>
          <h2 className="section-label"># your feeds</h2>
          {subscriptions && subscriptions.docs.length === 0 && (
            <p>
              No feeds yet — create a subscription in the dashboard and your private feed URLs will
              show up here.
            </p>
          )}
          {subscriptions && subscriptions.docs.length > 0 && (
            <ul className="feed-list">
              {subscriptions.docs.map((subscription) => (
                <li key={subscription.id}>
                  <span className="feed-handle">@{subscription.handle}</span>
                  <span className="feed-type">({subscription.type})</span>
                  <a href={`/feeds/${subscription.token}`}>/feeds/{subscription.token}</a>
                </li>
              ))}
            </ul>
          )}
          <p className="cta-row">
            <a className="cta" href={payloadConfig.routes.admin}>
              [ open the dashboard → ]
            </a>
          </p>
        </>
      )}

      <footer className="colophon">
        made for the indie web · no tracking · powered by Payload CMS
      </footer>
    </div>
  )
}
