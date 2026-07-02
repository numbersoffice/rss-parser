import type { DashboardViewServerProps } from '@payloadcms/next/views'

import { DefaultDashboard } from '@payloadcms/next/views'
import { Gutter } from '@payloadcms/ui'
import React from 'react'

import { SubscriptionsWidget } from './SubscriptionsWidget'

/**
 * Replaces the default dashboard view (admin.components.views.dashboard):
 * admins keep Payload's editable modular dashboard; users get a fixed set of
 * widgets with no edit mode. Mirrors the modular dashboard's markup
 * (.modular-dashboard > .widget > .widget-wrapper) so the fixed version is
 * visually identical to the editable one.
 */
export function RoleDashboard(props: DashboardViewServerProps) {
  const { cookies, locale, permissions, req } = props.initPageResult

  if (req.user?.role === 'admin') {
    return <DefaultDashboard {...props} />
  }

  return (
    <Gutter className="dashboard">
      <div className="user-dashboard__intro">
        <h2>How this works</h2>
        <p>
          Create a subscription with the Instagram handle you want to follow and you get a private
          RSS feed URL — paste it into your RSS reader and new posts show up there. Each
          subscription has its own URL: delete the subscription and its URL stops working.
        </p>
      </div>
      <div className="modular-dashboard user-dashboard">
        <div className="widget">
          <div className="widget-wrapper">
            <div className="widget-content">
              <SubscriptionsWidget
                cookies={cookies}
                locale={locale}
                permissions={permissions}
                req={req}
                widgetSlug="subscriptions-overview"
              />
            </div>
          </div>
        </div>
      </div>
    </Gutter>
  )
}
