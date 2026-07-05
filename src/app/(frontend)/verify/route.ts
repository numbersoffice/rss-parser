import config from '@payload-config'
import { getPayload } from 'payload'

/**
 * GET /verify?token=… — the destination of the verification link we email on
 * signup. Verifies the account, then bounces to the admin login (the built-in
 * verify flow leaves no session, so the user logs in once to reach the
 * dashboard). Query flags drive the banner on the login screen (VerifyNotice).
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  const base = process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3000'
  const to = (path: string) => Response.redirect(new URL(path, base).toString(), 302)

  if (!token) {
    return to('/admin/login?verifyError=1')
  }

  const payload = await getPayload({ config })
  try {
    await payload.verifyEmail({ collection: 'users', token })
    return to('/admin/login?verified=1')
  } catch {
    // Invalid, expired, or already-used token.
    return to('/admin/login?verifyError=1')
  }
}
