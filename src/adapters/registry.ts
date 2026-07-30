import { instagramAdapter } from './instagram.js'
import type { SourceAdapter } from './types.js'

const adapters: Record<string, SourceAdapter> = {
  [instagramAdapter.type]: instagramAdapter,
  // Register new adapters here, e.g.:
  // [youtubeAdapter.type]: youtubeAdapter,
}

export function getAdapter(type: string): SourceAdapter {
  const adapter = adapters[type]
  if (!adapter) {
    throw new Error(`No adapter registered for source type "${type}"`)
  }
  return adapter
}

/**
 * The short URL segment a source type is published under, e.g. `instagram` →
 * `/feeds/ig/{handle}.xml`. Keeping the mapping here means adding an adapter
 * doesn't touch the routing code.
 */
export const FEED_PREFIXES: Record<string, string> = {
  instagram: 'ig',
}

export const typeForPrefix = (prefix: string): string | undefined =>
  Object.entries(FEED_PREFIXES).find(([, value]) => value === prefix)?.[0]

export const prefixForType = (type: string): string => FEED_PREFIXES[type] ?? type
