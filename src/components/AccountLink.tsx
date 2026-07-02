import type { Payload, TypedUser } from 'payload'

import Link from 'next/link'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

/**
 * Text-only account link in the top-right header (admin.components.actions),
 * showing the part of the email before the @ — matching the site's lo-fi,
 * type-only style. Replaces Payload's avatar button (hidden in custom.scss),
 * so it renders for every logged-in user. Registered before LogoutLink, so
 * for regular users "Log out" sits to its right.
 */
export function AccountLink({
  payload,
  user,
}: {
  payload: Payload
  user?: TypedUser | null
}) {
  if (!user) return null

  const href = formatAdminURL({
    adminRoute: payload.config.routes.admin,
    path: payload.config.admin.routes.account,
  })

  const name = user.email?.split('@')[0] || 'account'

  return (
    <Link className="header-link" href={href} prefetch={false}>
      {name.charAt(0).toUpperCase() + name.slice(1)}
    </Link>
  )
}
