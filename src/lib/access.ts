import type { Access, ClientUser, Condition, FieldAccess } from 'payload'

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

/** Hide a field from the edit view for non-admins (cosmetic — pair with field access rules). */
export const adminFieldCondition: Condition = (_data, _siblingData, { user }) =>
  (user as unknown as User | null)?.role === 'admin'

/** Hide a collection from the admin nav for non-admins (access rules still enforce). */
export const hiddenFromNonAdmins = ({ user }: { user: ClientUser }): boolean =>
  (user as unknown as User | null)?.role !== 'admin'
