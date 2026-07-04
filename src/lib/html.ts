/**
 * Escape a string for interpolation into HTML text or attribute values.
 * Adapters use this when building feed item content, and the refresh logic
 * relies on the exact same escaping to find-and-replace image URLs inside
 * that content — keep them importing from here so the two stay in sync.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
