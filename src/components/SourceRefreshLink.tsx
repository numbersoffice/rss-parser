'use client'

import { toast, useConfig, useDocumentInfo } from '@payloadcms/ui'
import React, { useState } from 'react'

/**
 * Minimal "Refresh now" text link in the source's document header, next to the
 * health dots (SourceHealthBar). Posts to the collection's force-refresh
 * endpoint (POST /api/sources/:id/refresh), which runs the normal refresh
 * pipeline but ignores the source's TTL, and reports the outcome as a toast.
 * The dots and the "Last fetch" fields reflect the new outcome on the next
 * load — deliberately no auto-reload, which would cut the toast short and
 * could discard unsaved edits.
 */
export const SourceRefreshLink: React.FC = () => {
  const { id } = useDocumentInfo()
  const {
    config: {
      routes: { api },
      serverURL,
    },
  } = useConfig()
  const [busy, setBusy] = useState(false)

  // No id yet (create form) — nothing to refresh.
  if (!id) return null

  const refresh = async () => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`${serverURL}${api}/sources/${id}/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
      const result = await res.json().catch(() => ({}))
      if (res.ok && result.status === 'success') {
        toast.success(successMessage(result))
      } else {
        toast.error(result.error ?? `Refresh failed (${res.status})`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }

  return (
    <button
      type="button"
      className="source-refresh"
      onClick={refresh}
      disabled={busy}
      title="Fetch this source now, ignoring the refresh interval"
    >
      {busy ? 'Refreshing…' : 'Refresh now'}
    </button>
  )
}

/** e.g. "Fetched 12 items — 2 new, 1 pruned" (the diff only when something
 * changed; a refresh that confirms the stored set is just "Fetched 12 items"). */
function successMessage(result: {
  itemCount?: number
  changes?: { created: number; deleted: number }
}): string {
  const base = `Fetched ${result.itemCount ?? 0} items`
  const parts: string[] = []
  if (result.changes?.created) parts.push(`${result.changes.created} new`)
  if (result.changes?.deleted) parts.push(`${result.changes.deleted} pruned`)
  return parts.length > 0 ? `${base} — ${parts.join(', ')}` : base
}
