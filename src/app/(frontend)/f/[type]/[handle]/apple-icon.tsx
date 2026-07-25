import { redirect } from 'next/navigation'

import { isPublicS3Url } from '@/lib/s3'
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
 *
 * The avatar is already mirrored into our public bucket once per source (see
 * resolveProfileImage in lib/refresh.ts), so we redirect straight to that
 * stable URL rather than re-rasterising the image through next/og on every
 * request — reader polls across every feed made that the server's dominant
 * cost. When a source has no mirrored copy yet (profileImageUrl is still a
 * platform CDN URL that readers can't fetch), fall back to a pre-generated
 * neutral tile instead of the platform's own logo.
 */
export default async function AppleIcon({
  params,
}: {
  params: Promise<{ type: string; handle: string }>
}) {
  const { type, handle } = await params
  const source = await getSource(type, handle)

  const url = source?.profileImageUrl
  if (url && isPublicS3Url(url)) redirect(url)

  redirect('/feed-icon-fallback.png')
}
