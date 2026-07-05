import { ImageResponse } from 'next/og'
import React from 'react'

import { getSource } from './getSource'

// 180×180 is the size iOS/readers expect for apple-touch-icon.
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

/*
 * The account's profile picture, served as this landing page's apple-touch
 * icon. This is what makes the whole scheme work: an RSS reader that derives a
 * feed's icon by scraping its home page finds this here instead of the
 * platform's own logo favicon. Co-located `icon.tsx` re-exports this for the
 * plain <link rel="icon">. Both override the app-root icon.png/apple-icon.png
 * for this route only.
 */
export default async function AppleIcon({ params }: { params: Promise<{ type: string; handle: string }> }) {
  const { type, handle } = await params
  const source = await getSource(type, handle)

  if (source?.profileImageUrl) {
    return new ImageResponse(
      (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={source.profileImageUrl}
          width={size.width}
          height={size.height}
          style={{ objectFit: 'cover' }}
          alt=""
        />
      ),
      size,
    )
  }

  // No mirrored avatar yet — a neutral tile in the landing page's palette
  // rather than falling back to the platform's logo.
  return new ImageResponse(
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
}
