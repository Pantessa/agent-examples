import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Lazy Trader · Yeetful',
  description:
    'A Yeetful payer agent with funds on the wrong chain. It pays x402 for a fund_and_build runbook, signs the cross-chain legs with its own key, and completes the goal.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
