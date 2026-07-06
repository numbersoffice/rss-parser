import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Anonymous / disposable mailbox providers (Mailinator, temp-mail clones, etc.)
 * are a common vector for spam signups and trial abuse, so we reject them at
 * registration. The domain list is vendored from the community-maintained repo
 * https://github.com/disposable-email-domains/disposable-email-domains — refresh
 * it with `pnpm update:disposable-domains`.
 *
 * Server-only: read from the repo root (Coolify runs `next start` from there, so
 * src/data/ is on disk at runtime) once at module load into a Set.
 */
const CONF_PATH = path.join(process.cwd(), 'src/data/disposable-email-domains.conf')

const blockedDomains: Set<string> = (() => {
  const raw = readFileSync(CONF_PATH, 'utf8')
  const set = new Set<string>()
  for (const line of raw.split('\n')) {
    const domain = line.trim().toLowerCase()
    if (domain && !domain.startsWith('#')) set.add(domain)
  }
  return set
})()

/**
 * True when the email's domain is a known disposable/anonymous mailbox provider.
 * Exact-domain match only (the list is structured that way) to avoid false
 * positives on legitimate subdomains of real providers.
 */
export function isDisposableEmailDomain(email: string): boolean {
  const at = email.lastIndexOf('@')
  if (at === -1) return false
  const domain = email.slice(at + 1).trim().toLowerCase()
  return domain !== '' && blockedDomains.has(domain)
}
