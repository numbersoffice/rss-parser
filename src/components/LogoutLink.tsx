import type { Payload, TypedUser } from 'payload'

import Link from 'next/link'
import { formatAdminURL } from 'payload/shared'

/**
 * "Log out" text link in the top-right header (admin.components.actions),
 * next to the account link, for every logged-in user. Payload's own logout
 * button in the nav sidebar is hidden via custom.scss (.nav__log-out).
 */
export function LogoutLink({ payload, user }: { payload: Payload; user?: TypedUser | null }) {
  if (!user) return null

  const href = formatAdminURL({
    adminRoute: payload.config.routes.admin,
    path: payload.config.admin.routes.logout,
  })

  return (
    <Link className="header-link" href={href} prefetch={false}>
      Logout
    </Link>
  )
}
