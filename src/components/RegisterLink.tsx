import Link from 'next/link'
import React from 'react'

/** "Create an account" link under the admin login form (admin.components.afterLogin). */
export function RegisterLink() {
  return (
    <p className="register-link">
      no account yet?{' '}
      <Link href="/admin/register" prefetch={false}>
        create one →
      </Link>
    </p>
  )
}
