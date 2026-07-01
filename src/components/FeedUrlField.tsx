'use client'

import type { TextFieldClientComponent } from 'payload'

import { FieldLabel, TextInput, useField } from '@payloadcms/ui'
import React, { useEffect, useRef, useState } from 'react'

/**
 * Read-only feed URL with a "copy" text link next to the label.
 * The URL only exists once the subscription is saved (the token is minted
 * server-side), so the link is omitted on the create form.
 */
export const FeedUrlField: TextFieldClientComponent = ({ field, path }) => {
  const { value } = useField<string>({ path })
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(resetTimer.current), [])

  const copy = async () => {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopied(true)
    clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <TextInput
      description={field.admin?.description}
      Label={
        <div style={{ alignItems: 'baseline', display: 'inline-flex', gap: '0.5rem' }}>
          <FieldLabel label={field.label} path={path} />
          {value ? (
            <button
              onClick={copy}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--theme-text)',
                cursor: 'pointer',
                fontSize: '0.85em',
                padding: 0,
                textDecoration: 'underline',
              }}
              type="button"
            >
              {copied ? 'copied' : 'copy'}
            </button>
          ) : null}
        </div>
      }
      onChange={() => undefined}
      path={path}
      readOnly
      value={value ?? ''}
    />
  )
}
