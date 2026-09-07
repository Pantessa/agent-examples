import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Stock Desk · Robinhood Chain · Pantessa embed example',
  description:
    'A standalone portfolio desk for tokenized stocks on Robinhood Chain with the Pantessa chat embedded as the execution surface — live holdings read from the chain, every action is a prompt, your own wallet signs.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
