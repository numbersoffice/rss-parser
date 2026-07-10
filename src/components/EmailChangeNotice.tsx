'use client'

import { useConfig } from '@payloadcms/ui'
import { useSearchParams } from 'next/navigation'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

/**
 * Banner at the top of the account view reflecting the outcome of clicking an
 * email-change confirmation link — see src/app/(frontend)/verify-email-change.
 * Rendered via a `ui` field on the Users collection. Renders nothing on any
 * page without the outcome flags, so it's inert in the admin user-edit view.
 */
export function EmailChangeNotice() {
  const params = useSearchParams()
  const { config } = useConfig()

  if (params.get('emailChanged')) {
    const logoutHref = formatAdminURL({
      adminRoute: config.routes.admin,
      path: config.admin.routes.logout,
    })
    return (
      <p className="verify-notice verify-notice--ok">
        ✓ Email updated — you can now log in with your new address.{' '}
        <a href={logoutHref} className="verify-notice__logout">
          Log out
        </a>
      </p>
    )
  }
  if (params.get('emailChangeError')) {
    return (
      <p className="verify-notice verify-notice--error">
        That email-change link is invalid, expired, or already used. Request the change again.
      </p>
    )
  }
  return null
}
