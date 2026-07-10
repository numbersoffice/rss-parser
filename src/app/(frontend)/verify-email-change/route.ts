import config from '@payload-config'
import { getPayload } from 'payload'

/**
 * GET /verify-email-change?token=… — the destination of the link we email to a
 * new address when a user (or admin) changes an account's email. Applies the
 * parked `pendingEmail` to `email` and clears the pending-change fields, then
 * bounces to the account view. The current email stays active until this runs,
 * so the account is never locked out mid-change. Query flags drive the banner
 * on the account screen (EmailChangeNotice).
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  const base = process.env.PAYLOAD_PUBLIC_SERVER_URL || 'http://localhost:3000'
  const to = (path: string) => Response.redirect(new URL(path, base).toString(), 302)

  if (!token) return to('/admin/account?emailChangeError=1')

  const payload = await getPayload({ config })
  try {
    const { docs } = await payload.find({
      collection: 'users',
      where: { emailChangeToken: { equals: token } },
      limit: 1,
      overrideAccess: true,
    })
    const user = docs[0]

    // Invalid/used token, no pending change, or expired link.
    const expiry = user?.emailChangeTokenExpiry
    if (!user || !user.pendingEmail || !expiry || new Date(expiry).getTime() < Date.now()) {
      return to('/admin/account?emailChangeError=1')
    }

    // Someone else may have claimed the address since the change was requested.
    const { totalDocs: taken } = await payload.count({
      collection: 'users',
      where: {
        and: [
          { id: { not_equals: user.id } },
          { email: { equals: user.pendingEmail } },
        ],
      },
      overrideAccess: true,
    })
    if (taken > 0) return to('/admin/account?emailChangeError=1')

    // System update (no user context) — the users beforeChange diversion only
    // fires when req.user is set, so this applies the new email directly.
    await payload.update({
      collection: 'users',
      id: user.id,
      data: {
        email: user.pendingEmail,
        pendingEmail: null,
        emailChangeToken: null,
        emailChangeTokenExpiry: null,
      },
      overrideAccess: true,
    })
    return to('/admin/account?emailChanged=1')
  } catch {
    return to('/admin/account?emailChangeError=1')
  }
}
