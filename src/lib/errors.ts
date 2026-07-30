/**
 * Node's `fetch` reports connection-level failures — including proxy errors —
 * as a bare "fetch failed", stashing the real reason on `err.cause` (and
 * sometimes nested further). Flatten the chain so the recorded error shows the
 * actionable detail: a proxy 407, ECONNREFUSED, a TLS error, etc.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = err
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    const code = (current as { code?: string }).code
    parts.push(code ? `${current.message} (${code})` : current.message)
    current = (current as { cause?: unknown }).cause
  }
  // Drop consecutive duplicates (the top message often repeats its cause).
  return parts.filter((part, i) => part !== parts[i - 1]).join(' — ')
}
