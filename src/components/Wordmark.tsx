import React from 'react'

/**
 * The `~/rss-parser` wordmark, shared between the landing page masthead and
 * the Payload admin login screen. Styling comes from the surrounding
 * stylesheet: (frontend)/styles.css on the landing page, (payload)/custom.scss
 * in the admin.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className ? `wordmark ${className}` : 'wordmark'}>
      <span className="wordmark-tilde">~/</span>
      rss-parser
    </span>
  )
}

/** Registered as admin.components.graphics.Logo in payload.config.ts. */
export function LoginLogo() {
  return <Wordmark className="login-wordmark" />
}
