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

const initialState = {
  captchaAnswer: { valid: true, value: '' },
  captchaToken: { valid: true, value: '' },
  email: { valid: true, value: '' },
  password: { valid: true, value: '' },
}

const validatePassword = (value: unknown) =>
  (typeof value === 'string' && value.length >= 8 && value.length <= 128) ||
  'Password must be 8–128 characters.'

/**
 * Anti-bot question inside the register form. Holds the server-issued token in
 * the hidden captchaToken field and shows the question as the answer field's
 * label. Solved tokens are single-use and questions expire, so a fresh one is
 * fetched after every submit attempt.
 */
function CaptchaField({ apiRoute }: { apiRoute: string }) {
  const { setValue: setToken } = useField<string>({ path: 'captchaToken' })
  const [question, setQuestion] = useState<string | null>(null)
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
    void load()
  }, [load])

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

export function RegisterForm({ adminRoute, apiRoute }: { adminRoute: string; apiRoute: string }) {
  const onSuccess: FormProps['onSuccess'] = async (_json, ctx) => {
    const emailValue = ctx?.formState?.email?.value
    const passwordValue = ctx?.formState?.password?.value
    try {
      const res = await fetch(`${apiRoute}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: emailValue, password: passwordValue }),
      })
      // Full navigation so the admin SSR picks up the fresh auth cookie.
      window.location.assign(res.ok ? adminRoute : `${adminRoute}/login`)
    } catch {
      window.location.assign(`${adminRoute}/login`)
    }
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
          <CaptchaField apiRoute={apiRoute} />
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
