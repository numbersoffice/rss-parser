import type { Payload, TypedUser } from 'payload'

import React from 'react'

import { countUserSubscriptions, getSubscriptionLimit } from '@/lib/limits'

/**
 * Quiet "7 / 12" indicator above the subscriptions list
 * (admin.components.beforeListTable). Only rendered for regular users —
 * admins are not limited and their list spans all users. The count can
 * exceed the limit (e.g. 20/15) when an admin lowered it retroactively;
 * existing subscriptions keep working, only creating new ones is blocked.
 */
export async function SubscriptionLimitCounter({
  payload,
  user,
}: {
  payload: Payload
  user?: TypedUser | null
}) {
  if (!user || user.role === 'admin') return null

  const [limit, count] = await Promise.all([
    getSubscriptionLimit(payload),
    countUserSubscriptions(payload, user.id),
  ])

  return (
    <div className="subs-limit" title="How many subscriptions you use of your allowance">
      {count} / {limit} subscriptions used
    </div>
  )
}
