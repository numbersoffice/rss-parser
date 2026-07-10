'use client'

import type { TextFieldClientComponent } from 'payload'

import { TextInput, useField } from '@payloadcms/ui'
import React from 'react'

/**
 * Read-only `pendingEmail` field (Users collection, account view): the address
 * awaiting confirmation, with the usual "awaiting confirmation" copy and a
 * small inline "Cancel" link at the very end of that copy. Clicking Cancel
 * aborts the pending change via /cancel-email-change and reloads the account
 * view, so a user who changes their mind can drop the pending address without
 * waiting for the confirmation link to expire. Only rendered when pendingEmail
 * is set (the field's own `condition`), so the link never shows with nothing to
 * cancel. Custom Field (rather than a Description component) so the link sits
 * truly inline in the description text.
 */
export const PendingEmailField: TextFieldClientComponent = ({ field, path }) => {
  const { value } = useField<string>({ path })
  const [cancelling, setCancelling] = React.useState(false)

  const onCancel = async () => {
    setCancelling(true)
    try {
      const res = await fetch('/cancel-email-change', { method: 'POST' })
      if (res.ok) {
        window.location.assign('/admin/account')
        return
      }
    } catch {
      /* fall through to re-enable the link */
    }
    setCancelling(false)
  }

  return (
    <div className="pending-email-field">
      <TextInput
        label={field.label}
        onChange={() => undefined}
        path={path}
        readOnly
        value={value ?? ''}
      />
      {/* Own description element (Payload's `description` prop is text-only) so
          the Cancel link sits inline at the end of the copy. */}
      <div className="field-description pending-email-field__description">
        A change to this address is awaiting confirmation. Your current email stays active until the
        link we emailed is clicked.{' '}
        <button
          className="pending-email-cancel"
          disabled={cancelling}
          onClick={onCancel}
          type="button"
        >
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </button>
      </div>
    </div>
  )
}
