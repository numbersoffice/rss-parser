// Re-vendor the disposable email blocklist from the community-maintained repo.
// Run with `pnpm update:disposable-domains`. Uses plain fetch on purpose — this
// is a manual/dev task and must NOT consume the metered outbound proxy.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const SOURCE =
  'https://raw.githubusercontent.com/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf'
const DEST = path.join(process.cwd(), 'src/data/disposable-email-domains.conf')

const res = await fetch(SOURCE)
if (!res.ok) {
  console.error(`Failed to fetch blocklist: ${res.status} ${res.statusText}`)
  process.exit(1)
}
const text = await res.text()
const count = text.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length
await writeFile(DEST, text)
console.log(`Wrote ${count} domains to ${DEST}`)
