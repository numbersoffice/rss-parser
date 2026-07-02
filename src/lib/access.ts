import type { Access, Condition, FieldAccess } from 'payload'

import { countUserSubscriptions, getSubscriptionLimit } from '@/lib/limits'
import type { User } from '@/payload-types'

export const isAdmin: Access = ({ req }) => req.user?.role === 'admin'

export const isAdminField: FieldAccess = ({ req }) => req.user?.role === 'admin'

export const isLoggedIn: Access = ({ req }) => Boolean(req.user)

/** Admins see everything; users only their own user document. */
export const isAdminOrSelf: Access = ({ req }) => {
  if (!req.user) return false
  if (req.user.role === 'admin') return true
  return { id: { equals: req.user.id } }
}

/** Admins see everything; users only documents whose `user` field is them. */
export const isAdminOrOwner: Access = ({ req }) => {
  if (!req.user) return false
  if (req.user.role === 'admin') return true
  return { user: { equals: req.user.id } }
}

/**
 * Users may create subscriptions only while under the configured cap
 * (settings global); admins are unlimited. Returning false here also makes
 * the admin UI hide its "Create New" buttons for that user.
 */
export const canCreateSubscription: Access = async ({ req }) => {
  if (!req.user) return false
  if (req.user.role === 'admin') return true
  const [limit, count] = await Promise.all([
    getSubscriptionLimit(req.payload),
    countUserSubscriptions(req.payload, req.user.id),
  ])
  return count < limit
}

/** Hide a field from the edit view for non-admins (cosmetic — pair with field access rules). */
export const adminFieldCondition: Condition = (_data, _siblingData, { user }) =>
  (user as unknown as User | null)?.role === 'admin'

/** Hide a collection or global from the admin nav for non-admins (access rules
 * still enforce). Collections and globals type the user differently
 * (ClientUser vs generated User), so accept either. */
export const hiddenFromNonAdmins = ({ user }: { user: unknown }): boolean =>
  (user as User | null)?.role !== 'admin'
