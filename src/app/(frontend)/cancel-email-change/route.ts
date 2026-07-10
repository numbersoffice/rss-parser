import config from '@payload-config'
import { headers as getHeaders } from 'next/headers'
import { getPayload } from 'payload'

/**
 * POST /cancel-email-change — aborts an in-flight email change for the
 * authenticated user: clears the parked `pendingEmail` and the token backing
 * the confirmation link, so any link already emailed stops working. The
 * account keeps its current (still-active) email. Fired by the inline "Cancel"
 * link in the pendingEmail field's description (PendingEmailField).
 */
export async function POST() {
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: await getHeaders() })
  if (!user) return new Response('Unauthorized', { status: 401 })

  await payload.update({
    collection: 'users',
    id: user.id,
    data: {
      pendingEmail: null,
      emailChangeToken: null,
      emailChangeTokenExpiry: null,
    },
    overrideAccess: true,
  })
  return Response.json({ ok: true })
}
