import { config } from './config.js'

/**
 * One line per event on stdout, meant to be read by a human in the Docker
 * console rather than shipped to a log aggregator — so plain text, not JSON.
 * Structured detail is appended as `key=value` pairs, which still greps well.
 *
 *   2026-07-30T11:42:03.481Z INFO  refresh @nasa ok http=200 items=12
 */

const LEVELS = ['debug', 'info', 'warn', 'error'] as const
type Level = (typeof LEVELS)[number]

const threshold = (): number => {
  const index = LEVELS.indexOf(config.logLevel as Level)
  return index === -1 ? LEVELS.indexOf('info') : index
}
const minLevel = threshold()

export type Fields = Record<string, unknown>

/** Render `key=value` pairs, skipping empties and quoting anything with spaces. */
function renderFields(fields: Fields | undefined): string {
  if (!fields) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue
    const text = String(value)
    parts.push(`${key}=${/[\s"]/.test(text) ? JSON.stringify(text) : text}`)
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : ''
}

function emit(level: Level, message: string, fields?: Fields): void {
  if (LEVELS.indexOf(level) < minLevel) return
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${renderFields(fields)}`
  // Everything goes to stdout: `docker logs` interleaves the two streams by
  // arrival, so splitting warnings onto stderr only risks reordering them.
  process.stdout.write(`${line}\n`)
}

export const log = {
  debug: (message: string, fields?: Fields) => emit('debug', message, fields),
  info: (message: string, fields?: Fields) => emit('info', message, fields),
  warn: (message: string, fields?: Fields) => emit('warn', message, fields),
  error: (message: string, fields?: Fields) => emit('error', message, fields),
}

/** Human-friendly elapsed time for job summaries: "820ms", "16.0s", "2m04s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m${String(seconds).padStart(2, '0')}s`
}
