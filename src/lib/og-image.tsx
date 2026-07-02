import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { ImageResponse } from 'next/og'
import React from 'react'

export const ogAlt = 'rss-parser — turn Instagram accounts into RSS feeds'
export const ogSize = { width: 1200, height: 630 }
export const ogContentType = 'image/png'

/* the landing page's palette ((frontend)/styles.css) */
const paper = '#ffffff'
const ink = '#000000'
const muted = '#8a8a8a'
const accent = '#0000ee'

const font = (file: string) => readFile(path.join(process.cwd(), 'src/assets/fonts', file))

/**
 * The social preview image, drawn in the landing page's aesthetic. Served by
 * the (frontend)/opengraph-image.tsx + twitter-image.tsx file conventions and,
 * for the admin pages, by the stable /og route (referenced in admin.meta).
 */
export async function renderOgImage() {
  const [regular, bold] = await Promise.all([
    font('JetBrainsMono-Regular.ttf'),
    font('JetBrainsMono-Bold.ttf'),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: paper,
          color: ink,
          fontFamily: 'JetBrains Mono',
          fontSize: 27,
          padding: 60,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', fontSize: 56, fontWeight: 700 }}>
            <span style={{ color: muted, fontWeight: 400 }}>~/</span>
            <span>rss-parser</span>
          </div>
          <span style={{ color: muted, fontSize: 28 }}>self-hostable · instagram → rss</span>
        </div>

        {/* the XML hero from the landing page */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignSelf: 'flex-start',
            border: `2px solid ${ink}`,
            boxShadow: `14px 14px 0 ${accent}`,
            padding: '36px 48px',
            lineHeight: 1.6,
          }}
        >
          <span style={{ color: muted }}>{'<?xml version="1.0" encoding="UTF-8"?>'}</span>
          <span style={{ color: accent }}>{'<rss version="2.0">'}</span>
          <div style={{ display: 'flex', marginLeft: 38 }}>
            <span style={{ color: accent }}>{'<title>'}</span>
            <span style={{ fontWeight: 700 }}>rss-parser</span>
            <span style={{ color: accent }}>{'</title>'}</span>
          </div>
          <div style={{ display: 'flex', marginLeft: 38 }}>
            <span style={{ color: accent }}>{'<description>'}</span>
            <span style={{ fontWeight: 700 }}>Follow Instagram accounts</span>
          </div>
          <div style={{ display: 'flex', marginLeft: 76 }}>
            <span style={{ fontWeight: 700 }}>from your RSS reader.</span>
          </div>
          <div style={{ display: 'flex', marginLeft: 38, color: accent }}>{'</description>'}</div>
          <div style={{ display: 'flex', color: accent }}>
            {'</rss>'}
            <span style={{ marginLeft: 8 }}>▊</span>
          </div>
        </div>

        <span style={{ color: muted, fontSize: 24 }}>no tracking · powered by Payload CMS</span>
      </div>
    ),
    {
      ...ogSize,
      fonts: [
        { name: 'JetBrains Mono', data: regular, style: 'normal', weight: 400 },
        { name: 'JetBrains Mono', data: bold, style: 'normal', weight: 700 },
      ],
    },
  )
}
