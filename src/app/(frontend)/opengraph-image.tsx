import { ogAlt, ogContentType, ogSize, renderOgImage } from '@/lib/og-image'

export const alt = ogAlt
export const size = ogSize
export const contentType = ogContentType

export default function OpenGraphImage() {
  return renderOgImage()
}
