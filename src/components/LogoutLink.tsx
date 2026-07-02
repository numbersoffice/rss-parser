import type { Payload, TypedUser } from 'payload'

import Link from 'next/link'
import { formatAdminURL } from 'payload/shared'

/**
 * "Log out" text link in the top-right header (admin.components.actions),
 * next to the account link. Only for regular users — their nav sidebar (and
 * with it Payload's usual logout button) is hidden via RoleStyles; admins
 * keep the nav and its logout.
 */
export function LogoutLink({ payload, user }: { payload: Payload; user?: TypedUser | null }) {
  if (!user || user.role === 'admin') return null

  const href = formatAdminURL({
    adminRoute: payload.config.routes.admin,
    path: payload.config.admin.routes.logout,
  })

  return (
    <Link className="header-link" href={href} prefetch={false}>
      Log out
    </Link>
  )
}
