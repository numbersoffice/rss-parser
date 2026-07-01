import React from 'react'
import './styles.css'

export const metadata = {
  description: 'Turn Instagram feeds (and more) into RSS feeds.',
  title: 'RSS Parser',
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props

  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  )
}
