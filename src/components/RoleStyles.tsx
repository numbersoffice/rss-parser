import config from '@payload-config'
import { headers as getHeaders } from 'next/headers'
import { getPayload } from 'payload'
import React from 'react'

/*
 * Non-admins get a simplified admin UI. Purely cosmetic — access control
 * already scopes queries and mutations to the user's own docs.
 *
 * - Subscriptions list: Columns and Filters toggles hidden, search stays.
 * - No nav sidebar: the layout grid becomes a single full-width column (the
 *   hidden nav stops being a grid item, so the content must not be left in
 *   a zero-width first column), the togglers disappear, and the nav-open
 *   dim overlay is disabled.
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

/* Payload's built-in "Verified" checkbox in the account view: an internal auth
   flag users can't act on, so hide it from non-admins. It's the last field in
   the auth block (rendered when verify && isEditing, both true on this view). */
.auth-fields.collection-edit__auth > .field-type:last-child {
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
 * the admin UI for non-admin users. Server component: it resolves the real
 * authenticated user via payload.auth() so the correct CSS is present on the
 * first paint — no flash, and nothing to hydrate-mismatch. Payload refreshes
 * the admin server tree on login/logout, so the styling stays in sync with
 * auth transitions without a hard reload.
 */
export async function RoleStyles({ children }: { children?: React.ReactNode }) {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await getHeaders() })

  return (
    <>
      {/* data-role marks what the provider saw — handy when debugging why
          role CSS did or didn't apply */}
      {/* Single concatenated child: <style> is a raw-text element, so multiple
          text children (which React separates with comment markers) collapse to
          one text node in the DOM and break hydration. */}
      <style data-role={user ? user.role : 'anonymous'}>
        {allUsersCss + (user && user.role !== 'admin' ? nonAdminCss : '')}
      </style>
      {children}
    </>
  )
}
