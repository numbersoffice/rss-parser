import type { TypedUser } from 'payload'
import React from 'react'

/*
 * Non-admins get a simplified subscriptions list: the Columns and Filters
 * toggles are hidden, the search bar stays. Purely cosmetic — access control
 * already scopes queries to the user's own docs.
 */
const nonAdminCss = `
.collection-list--subscriptions .list-controls__toggle-columns,
.collection-list--subscriptions .list-controls__toggle-where {
  display: none;
}
`

/**
 * Server provider (admin.components.providers): injects role-scoped CSS to
 * simplify the admin UI for non-admin users. Rendered on the server from the
 * authenticated request, so the hidden controls never flash before hydration
 * and no client JS is involved.
 */
export function RoleStyles({
  children,
  user,
}: {
  children?: React.ReactNode
  user?: TypedUser | null
}) {
  return (
    <>
      {user && user.role !== 'admin' && <style>{nonAdminCss}</style>}
      {children}
    </>
  )
}
