import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Desk Trader · Pantessa',
  description:
    'An agent that holds its own key gets a 2x HYPE long done through the Pantessa desk: holdings read, funding route, one consent, then every leg signed by the agent — round-trip across every settlement boundary, batched within one.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
