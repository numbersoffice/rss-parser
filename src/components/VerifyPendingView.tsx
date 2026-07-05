import type { AdminViewServerProps } from 'payload'

import { MinimalTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import React from 'react'

import { LoginLogo } from './Wordmark'

/**
 * "Check your email" page shown right after registration (admin.components.views
 * → verify-pending in payload.config.ts). New accounts are unverified and can't
 * log in yet, so RegisterForm sends visitors here instead of the dashboard.
 * Custom admin views skip the auth redirect, so this renders for the logged-out
 * visitor; it reuses the login/register structure so it looks consistent.
 */
export function VerifyPendingView({ initPageResult, searchParams }: AdminViewServerProps) {
  const { req } = initPageResult
  const { routes } = req.payload.config

  // Already logged in (so already verified) — nothing to wait for.
  if (req.user) {
    redirect(routes.admin)
  }

  const emailParam = searchParams?.email
  const email = typeof emailParam === 'string' ? emailParam : undefined

  return (
    <MinimalTemplate className="verify-pending">
      <div className="login__brand">
        <LoginLogo />
      </div>
      <h1>Check your email</h1>
      <p>
        {email ? (
          <>
            We sent a verification link to <strong>{email}</strong>.
          </>
        ) : (
          <>We sent you a verification link.</>
        )}{' '}
        Click it to finish creating your account, then come back to log in.
      </p>
      <p className="register-link">
        already verified?{' '}
        <Link href={`${routes.admin}/login`} prefetch={false}>
          log in →
        </Link>
      </p>
    </MinimalTemplate>
  )
}
