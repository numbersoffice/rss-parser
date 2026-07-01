import { instagramAdapter } from './instagram'
import type { SourceAdapter } from './types'

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

/** Options for the `type` select field on the Sources collection. */
export const sourceTypeOptions = Object.keys(adapters).map((type) => ({
  label: type.charAt(0).toUpperCase() + type.slice(1),
  value: type,
}))
