/** Payload relationship values are ids at depth 0 and docs at depth 1+. */
export const relationId = (value: unknown): number | string | undefined => {
  if (value == null) return undefined
  if (typeof value === 'object') return (value as { id?: number | string }).id
  return value as number | string
}
