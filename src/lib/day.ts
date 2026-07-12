/**
 * The calendar day of a date as `YYYY-MM-DD`, in the server's local timezone.
 *
 * Local (not UTC) so the day boundary lines up with the nightly cron and the
 * cleanup notices, which both treat midnight server-time as the day edge
 * (`setHours(24, 0, 0, 0)`). Used to bucket source activity per day, to sum
 * "today" in the dashboard widget, and as the prune cutoff — where the fixed
 * `YYYY-MM-DD` width makes a lexicographic `<` compare a correct date compare.
 */
export function dayKey(d: Date = new Date()): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
