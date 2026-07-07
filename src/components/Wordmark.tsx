import Link from 'next/link'
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
  return (
    <Link className="wordmark-link" href="/">
      <Wordmark className="login-wordmark" />
    </Link>
  )
}

/**
 * Registered as admin.components.graphics.Icon — the mark at the start of the
 * dashboard breadcrumbs and the collapsed nav. The Icon slot renders arbitrary
 * markup, so we use the word "Home" instead of a square glyph.
 */
export function NavIcon() {
  return <span className="nav-home">Home</span>
}
