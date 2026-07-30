/**
 * `accounts.txt` is the interface of this app: the list of Instagram accounts to
 * publish feeds for, one per line. Adding a line creates a feed; removing one
 * deletes the feed and everything it had mirrored.
 */

/** Instagram's own rules: letters, digits, periods and underscores, ≤30 chars. */
const VALID_HANDLE = /^[a-z0-9._]{1,30}$/

export interface ParsedAccounts {
  /** Valid handles, lowercased and deduplicated, in file order. */
  handles: string[]
  /** Lines that looked like handles but weren't usable, for logging. */
  invalid: string[]
}

/**
 * Parse the file's contents. Handles are lowercased because Instagram treats
 * them case-insensitively — without that, `NASA` and `nasa` would become two
 * sources fetching the same account, and would collide as filenames on a
 * case-insensitive filesystem.
 */
export function parseAccounts(text: string): ParsedAccounts {
  const seen = new Set<string>()
  const handles: string[] = []
  const invalid: string[] = []

  for (const rawLine of text.split(/\r?\n/)) {
    // Strip comments, whether a whole line or trailing.
    const line = (rawLine.split('#')[0] ?? '').trim()
    if (!line) continue

    const handle = line.replace(/^@/, '').toLowerCase()
    if (!VALID_HANDLE.test(handle)) {
      invalid.push(line)
      continue
    }
    if (seen.has(handle)) continue
    seen.add(handle)
    handles.push(handle)
  }

  return { handles, invalid }
}
