import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { ImageResponse } from 'next/og'
import React from 'react'

import { withRenderLimit } from '@/lib/render-limit'

export const ogAlt = 'rss-parser — turn Instagram accounts into RSS feeds'
export const ogSize = { width: 1200, height: 630 }
export const ogContentType = 'image/png'

// The image is identical for every request, so it can be cached hard by the CDN
// and by the crawlers that fetch it — this is what stops a link-preview sweep
// from re-triggering the WASM rasterizer on every hit.
const OG_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/* the landing page's palette ((frontend)/styles.css) */
const paper = '#ffffff'
const ink = '#000000'
const muted = '#8a8a8a'
const accent = '#0000ee'

// Fonts never change; read them once per process instead of on every request.
let fontsPromise: Promise<[Buffer, Buffer]> | null = null
function loadFonts(): Promise<[Buffer, Buffer]> {
  if (!fontsPromise) {
    const font = (file: string) => readFile(path.join(process.cwd(), 'src/assets/fonts', file))
    fontsPromise = Promise.all([font('JetBrainsMono-Regular.ttf'), font('JetBrainsMono-Bold.ttf')])
  }
  return fontsPromise
}

// The rasterized bytes never change either, so rasterize once and serve the
// cached buffer thereafter — a crawler burst can't trigger repeated renders.
let bytesPromise: Promise<ArrayBuffer> | null = null
function ogImageBytes(): Promise<ArrayBuffer> {
  if (!bytesPromise) {
    bytesPromise = withRenderLimit(async () => {
      const [regular, bold] = await loadFonts()
      const res = new ImageResponse(
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
      return res.arrayBuffer()
    }).catch((err) => {
      // Don't cache a failed render — let the next request retry.
      bytesPromise = null
      throw err
    })
  }
  return bytesPromise
}

/**
 * The social preview image, drawn in the landing page's aesthetic. Served by
 * the (frontend)/opengraph-image.tsx + twitter-image.tsx file conventions and,
 * for the admin pages, by the stable /og route (referenced in admin.meta).
 *
 * The content is fully static, so it is rasterized once (behind the render
 * limiter) and cached — subsequent requests, including crawler bursts, get the
 * cached bytes with long-lived cache headers instead of a fresh WASM render.
 */
export async function renderOgImage(): Promise<Response> {
  const bytes = await ogImageBytes()
  return new Response(bytes, {
    headers: {
      'content-type': ogContentType,
      'cache-control': OG_CACHE_CONTROL,
    },
  })
}
