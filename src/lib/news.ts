import type { SerializedEditorState } from '@payloadcms/richtext-lexical/lexical'
import { convertLexicalToPlaintext } from '@payloadcms/richtext-lexical/plaintext'

import type { News } from '@/payload-types'

const TEASER_LENGTH = 160

/** Excerpt when set, otherwise the first words of the post body. */
export function newsTeaser(post: News): string {
  const excerpt = post.excerpt?.trim()
  if (excerpt) return excerpt
  const text = post.content
    ? convertLexicalToPlaintext({ data: post.content as unknown as SerializedEditorState })
    : ''
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > TEASER_LENGTH ? `${flat.slice(0, TEASER_LENGTH).trimEnd()}…` : flat
}
