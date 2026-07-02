'use client'

import { useAuth } from '@payloadcms/ui'
import React from 'react'

/**
 * Registered as admin.avatar in payload.config.ts. Replaces the default
 * profile picture in the top-right with text-only identity — the part of
 * the email before the @ — matching the site's lo-fi, type-only style.
 */
export function AccountAvatar() {
  const { user } = useAuth()
  const name = user?.email?.split('@')[0] || 'account'
  return <span className="account-name">{name}</span>
}
