'use client'

import { Button, useConfig } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

/**
 * "Log out" button in the account-view sidebar (a `ui` field on the Users
 * collection, position: sidebar). Non-admins have the whole nav sidebar hidden
 * (see RoleStyles), so Payload's built-in logout button at the bottom of the
 * nav is out of reach for them — this puts logout where they
 * manage their account instead. Client component so it can resolve the
 * configured admin + logout routes via useConfig rather than hardcoding
 * /admin/logout. Renders Payload's own Button (secondary/outline style, as a
 * Next link) so it matches the admin's button styling.
 */
export function LogoutField() {
  const { config } = useConfig()

  const href = formatAdminURL({
    adminRoute: config.routes.admin,
    path: config.admin.routes.logout,
  })

  return (
    <div className="field-type ui logout-field">
      <Button el="link" to={href} buttonStyle="secondary">
        Log out
      </Button>
    </div>
  )
}
