import type { AdminViewServerProps } from 'payload'

import { MinimalTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'

import { generateCaptcha } from '@/lib/captcha'

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

  // Generate the first captcha server-side so the question is present in the
  // initial paint — no client fetch on mount, no "loading…" → question flash.
  // Fresh tokens after a submit are still fetched client-side via /api/captcha.
  const initialCaptcha = generateCaptcha(req.payload.secret)

  return (
    <MinimalTemplate className="register">
      <div className="login__brand">
        <LoginLogo />
      </div>
      <RegisterForm
        adminRoute={routes.admin}
        apiRoute={routes.api}
        initialCaptcha={initialCaptcha}
      />
    </MinimalTemplate>
  )
}
