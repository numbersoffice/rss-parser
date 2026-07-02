import type { AdminViewServerProps } from 'payload'

import { MinimalTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'

import { RegisterForm } from './RegisterForm'
import { LoginLogo } from './Wordmark'

/**
 * Public registration view at /admin/register, registered under
 * admin.components.views in payload.config.ts. Custom admin views skip the
 * auth redirect, so this renders for logged-out visitors; it reuses the login
 * view's structure (MinimalTemplate + login__brand + login__form classes) so
 * it looks exactly like the login and password-reset screens.
 */
export function RegisterView({ initPageResult }: AdminViewServerProps) {
  const { req } = initPageResult
  const { routes } = req.payload.config

  if (req.user) {
    redirect(routes.admin)
  }

  return (
    <MinimalTemplate className="register">
      <div className="login__brand">
        <LoginLogo />
      </div>
      <RegisterForm adminRoute={routes.admin} apiRoute={routes.api} />
    </MinimalTemplate>
  )
}
