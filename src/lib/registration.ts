import type { Endpoint } from 'payload'
import { addDataAndFileToRequest, ValidationError } from 'payload'

import { generateCaptcha, verifyCaptcha } from '@/lib/captcha'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** GET /api/captcha → { question, token } */
export const captchaEndpoint: Endpoint = {
  path: '/captcha',
  method: 'get',
  handler: (req) => Response.json(generateCaptcha(req.payload.secret)),
}

/**
 * POST /api/register { email, password, captchaToken, captchaAnswer }
 *
 * Accepts JSON or multipart (the admin's <Form> posts FormData with a _payload
 * blob). Error responses use { message } so Payload's form toasts pick them up.
 */
export const registerEndpoint: Endpoint = {
  path: '/register',
  method: 'post',
  handler: async (req) => {
    try {
      await addDataAndFileToRequest(req)
    } catch {
      return Response.json({ message: 'Invalid request body.' }, { status: 400 })
    }
    const body = req.data ?? {}
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const captchaToken = typeof body.captchaToken === 'string' ? body.captchaToken : ''
    const captchaAnswer =
      typeof body.captchaAnswer === 'string' || typeof body.captchaAnswer === 'number'
        ? String(body.captchaAnswer)
        : ''

    if (!EMAIL_RE.test(email)) {
      return Response.json({ message: 'Enter a valid email address.' }, { status: 400 })
    }
    if (password.length < 8 || password.length > 128) {
      return Response.json({ message: 'Password must be 8–128 characters.' }, { status: 400 })
    }
    if (!verifyCaptcha(req.payload.secret, captchaToken, captchaAnswer)) {
      return Response.json(
        { message: 'Wrong or expired answer — try the new question.' },
        { status: 400 },
      )
    }

    try {
      // Whitelisted fields only: the users beforeChange hook trusts Local API
      // calls, so nothing from the request body may be spread in here. The
      // account is created unverified (no req.user here), so Payload sends the
      // verification email as part of this create.
      await req.payload.create({
        collection: 'users',
        data: { email, password, role: 'user' },
        overrideAccess: true,
      })
    } catch (err) {
      if (err instanceof ValidationError) {
        return Response.json(
          { message: 'An account with that email already exists.' },
          { status: 409 },
        )
      }
      req.payload.logger.error({ err }, 'registration failed')
      return Response.json({ message: 'Registration failed — try again later.' }, { status: 500 })
    }
    return Response.json({ success: true }, { status: 201 })
  },
}
