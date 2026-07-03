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
          padding: 70,
        }}
      >
        <span style={{ color: muted, fontSize: 28 }}>self-hostable · instagram → rss</span>

        {/* the terminal wordmark, front and center — the landing page's mark */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', fontSize: 104, fontWeight: 700 }}>
            <span style={{ color: muted, fontWeight: 400 }}>~/</span>
            <span>rss-parser</span>
            <span style={{ color: accent, marginLeft: 12 }}>▊</span>
          </div>
          <span style={{ fontSize: 40, marginTop: 28 }}>
            Follow Instagram accounts from your RSS reader.
          </span>
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
