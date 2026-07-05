'use client'

import { useSearchParams } from 'next/navigation'
import React from 'react'

/**
 * Banner above the admin login form (admin.components.afterLogin) that reflects
 * the outcome of clicking a verification link — see src/app/(frontend)/verify.
 */
export function VerifyNotice() {
  const params = useSearchParams()

  if (params.get('verified')) {
    return (
      <p className="verify-notice verify-notice--ok">✓ Email verified — please log in.</p>
    )
  }
  if (params.get('verifyError')) {
    return (
      <p className="verify-notice verify-notice--error">
        That verification link is invalid or has already been used.
      </p>
    )
  }
  return null
}
