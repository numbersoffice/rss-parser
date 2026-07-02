import { renderOgImage } from '@/lib/og-image'

/** Stable URL for the social preview image, referenced by admin.meta. */
export function GET() {
  return renderOgImage()
}
