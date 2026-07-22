import { ImageResponse } from 'next/og'
import React from 'react'

import { isPublicS3Url } from '@/lib/s3'
import { withRenderLimit } from '@/lib/render-limit'

import { getSource } from './getSource'

// 180×180 is the size iOS/readers expect for apple-touch-icon.
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

// Icons are the same for many requests (and probed by crawlers at arbitrary
// handles), so let the CDN/reader cache them. Moderate TTL: an avatar can start
// existing or change.
const ICON_CACHE_CONTROL = 'public, max-age=3600'

// The no-avatar fallback tile is identical for every handle, so rasterize it
// once and serve the cached bytes — a crawler probing random `/f/.../icon`
// URLs then never triggers a fresh WASM render.
let fallbackBytes: Promise<ArrayBuffer> | null = null
function fallbackTileBytes(): Promise<ArrayBuffer> {
  if (!fallbackBytes) {
    fallbackBytes = withRenderLimit(async () => {
      const res = new ImageResponse(
        (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#ffffff',
              color: '#000000',
              fontFamily: 'monospace',
              fontSize: 96,
              fontWeight: 700,
            }}
          >
            ~/
          </div>
        ),
        size,
      )
      return res.arrayBuffer()
    }).catch((err) => {
      fallbackBytes = null
      throw err
    })
  }
  return fallbackBytes
}

function fallbackTile(): Promise<Response> {
  return fallbackTileBytes().then(
    (bytes) =>
      new Response(bytes, {
        headers: { 'content-type': contentType, 'cache-control': ICON_CACHE_CONTROL },
      }),
  )
}

/*
 * The account's profile picture, served as this landing page's apple-touch
 * icon. This is what makes the whole scheme work: an RSS reader that derives a
 * feed's icon by scraping its home page finds this here instead of the
 * platform's own logo favicon. Co-located `icon.tsx` re-exports this for the
 * plain <link rel="icon">. Both override the app-root icon.png/apple-icon.png
 * for this route only.
 *
 * When the avatar is already mirrored into our public bucket we 302-redirect to
 * that stable URL rather than re-encoding it through the WASM rasterizer — the
 * common case does zero render work, which is what keeps crawler bursts from
 * spiking CPU/memory. Only the un-mirrored and no-avatar cases render, and the
 * no-avatar tile is cached.
 */
export default async function AppleIcon({ params }: { params: Promise<{ type: string; handle: string }> }) {
  const { type, handle } = await params
  const source = await getSource(type, handle)

  // No source (unknown/disabled/bot-probed handle) or no avatar yet — the
  // shared, cached fallback tile. No per-request rasterization.
  if (!source?.profileImageUrl) {
    return fallbackTile()
  }

  // Mirrored into our bucket: hand the reader the stable public URL directly.
  if (isPublicS3Url(source.profileImageUrl)) {
    return new Response(null, {
      status: 302,
      headers: { location: source.profileImageUrl, 'cache-control': ICON_CACHE_CONTROL },
    })
  }

  // Not yet mirrored (still a platform CDN URL) — rasterize under the render
  // limit. Rare and transient; the next refresh mirrors it and this becomes a
  // redirect.
  const res = await withRenderLimit(async () =>
    new ImageResponse(
      (
        <img
          src={source.profileImageUrl!}
          width={size.width}
          height={size.height}
          style={{ objectFit: 'cover' }}
          alt=""
        />
      ),
      size,
    ).arrayBuffer(),
  )
  return new Response(res, {
    headers: { 'content-type': contentType, 'cache-control': ICON_CACHE_CONTROL },
  })
}
