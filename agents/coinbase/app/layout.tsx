import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Coinbase Agent · Yeetful',
  description:
    'A Yeetful x402 payer agent on Coinbase Advanced Trade — shows the portfolio, pays x402 for a market signal, and places order-book trades.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
