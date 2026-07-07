'use client'

import type { FormProps } from '@payloadcms/ui'

import {
  EmailField,
  Form,
  FormSubmit,
  PasswordField,
  TextField,
  useField,
  useFormProcessing,
} from '@payloadcms/ui'
import Link from 'next/link'
import { email } from 'payload/shared'
import React, { useCallback, useEffect, useRef, useState } from 'react'

const validatePassword = (value: unknown) =>
  (typeof value === 'string' && value.length >= 8 && value.length <= 128) ||
  'Password must be 8–128 characters.'

/**
 * Anti-bot question inside the register form. Holds the server-issued token in
 * the hidden captchaToken field and shows the question as the answer field's
 * label. The first question+token is rendered server-side (seeded via props and
 * initialState) so it's present on first paint — no mount fetch, no flash.
 * Solved tokens are single-use and questions expire, so a fresh one is fetched
 * from /api/captcha after every submit attempt.
 */
function CaptchaField({ apiRoute, initialQuestion }: { apiRoute: string; initialQuestion: string }) {
  const { setValue: setToken } = useField<string>({ path: 'captchaToken' })
  const [question, setQuestion] = useState<string | null>(initialQuestion)
  const processing = useFormProcessing()
  const wasProcessing = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiRoute}/captcha`)
      const data = (await res.json()) as { question: string; token: string }
      setQuestion(data.question)
      setToken(data.token)
    } catch {
      setQuestion(null)
    }
  }, [apiRoute, setToken])

  useEffect(() => {
    if (wasProcessing.current && !processing) {
      void load()
    }
    wasProcessing.current = processing
  }, [processing, load])

  return (
    <TextField
      field={{
        name: 'captchaAnswer',
        label: question ? `Anti-bot check: ${question} = ?` : 'Anti-bot check: loading…',
        required: true,
      }}
      path="captchaAnswer"
    />
  )
}

export function RegisterForm({
  adminRoute,
  apiRoute,
  initialCaptcha,
}: {
  adminRoute: string
  apiRoute: string
  initialCaptcha: { question: string; token: string }
}) {
  const initialState = {
    captchaAnswer: { valid: true, value: '' },
    captchaToken: { valid: true, value: initialCaptcha.token },
    email: { valid: true, value: '' },
    password: { valid: true, value: '' },
  }

  const onSuccess: FormProps['onSuccess'] = async (_json, ctx) => {
    // The new account is unverified, so we can't log in yet — send the visitor
    // to the "check your email" page until they click the verification link.
    const emailValue = ctx?.formState?.email?.value
    const query =
      typeof emailValue === 'string' && emailValue
        ? `?email=${encodeURIComponent(emailValue)}`
        : ''
    window.location.assign(`${adminRoute}/verify-pending${query}`)
  }

  return (
    <>
      <Form
        action={`${apiRoute}/register`}
        className="login__form"
        disableSuccessStatus
        initialState={initialState}
        method="POST"
        onSuccess={onSuccess}
      >
        <div className="login__form__inputWrap">
          <EmailField
            field={{ name: 'email', label: 'Email', required: true }}
            path="email"
            validate={email}
          />
          <PasswordField
            field={{ name: 'password', label: 'Password', required: true }}
            path="password"
            validate={validatePassword}
          />
          <CaptchaField apiRoute={apiRoute} initialQuestion={initialCaptcha.question} />
        </div>
        <FormSubmit size="large">Create account</FormSubmit>
      </Form>
      {/* below the form, mirroring the login page's "no account yet?" link */}
      <p className="register-link">
        already have an account?{' '}
        <Link href={`${adminRoute}/login`} prefetch={false}>
          log in →
        </Link>
      </p>
    </>
  )
}
