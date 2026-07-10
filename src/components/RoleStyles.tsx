'use client'

import { useAuth } from '@payloadcms/ui'
import React from 'react'

import type { User } from '@/payload-types'

/*
 * Non-admins get a simplified admin UI. Purely cosmetic — access control
 * already scopes queries and mutations to the user's own docs.
 *
 * - Subscriptions list: Columns and Filters toggles hidden, search stays.
 * - No nav sidebar: the layout grid becomes a single full-width column (the
 *   hidden nav stops being a grid item, so the content must not be left in
 *   a zero-width first column), the togglers disappear, and the nav-open
 *   dim overlay is disabled. Users navigate via the dashboard; logging out
 *   happens through the header link (src/components/LogoutLink.tsx).
 */
/*
 * Applies to everyone (admins included). Payload's account view always renders
 * the language selector inside its "Payload settings" block — there's no config
 * flag to omit it — so hide the whole labelled block (label + dropdown).
 */
const allUsersCss = `
.payload-settings__language {
  display: none;
}
`

const nonAdminCss = `
.collection-list--subscriptions .list-controls__toggle-columns,
.collection-list--subscriptions .list-controls__toggle-where {
  display: none;
}

.template-default {
  grid-template-columns: 1fr;
}

.template-default .nav,
.template-default__nav-toggler-wrapper,
.app-header__mobile-nav-toggler,
.template-default__wrap::before {
  display: none;
}
`

/**
 * Provider (admin.components.providers): injects role-scoped CSS to simplify
 * the admin UI for non-admin users. Client-side on purpose: the root layout
 * (where providers live) renders once per full page load, so a server
 * component here would keep the pre-login auth state until a hard reload.
 * useAuth() tracks login/logout as they happen.
 */
export function RoleStyles({ children }: { children?: React.ReactNode }) {
  const { user } = useAuth<User>()

  return (
    <>
      {/* data-role marks what the provider saw — handy when debugging why
          role CSS did or didn't apply */}
      <style data-role={user ? user.role : 'anonymous'}>
        {allUsersCss}
        {user && user.role !== 'admin' ? nonAdminCss : ''}
      </style>
      {children}
    </>
  )
}
