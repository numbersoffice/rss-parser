import type { Metadata } from 'next'

import React from 'react'
import './styles.css'

const siteUrl = process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3000'
const title = 'RSS Parser — Instagram → RSS'
const description =
  'Self-hostable tool that turns public Instagram accounts into plain RSS feeds. ' +
  'Add a handle, get a private feed URL, paste it into your reader. ' +
  'No app, no algorithm, no Instagram account.'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: title, template: '%s — RSS Parser' },
  description,
  applicationName: 'RSS Parser',
  keywords: ['rss', 'instagram', 'feed', 'rss feed', 'self-hosted', 'payload cms'],
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'RSS Parser',
    title,
    description,
    locale: 'en',
    // Pre-generated static image (public/og.png) reused across all pages —
    // never rendered at request time. See public/og.png.
    images: ['/og.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: ['/og.png'],
  },
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  )
}
