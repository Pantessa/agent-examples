import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// The embed runs in an iframe on the Pantessa origin. If you add a
// Content-Security-Policy to your own app, frame-src must include that origin
// (see the `frame-src` line below) — this example ships one so the install is
// proven against a real CSP, not an open page.
const PANTESSA_ORIGIN = process.env.NEXT_PUBLIC_PANTESSA_ORIGIN || 'https://www.pantessa.com'

const nextConfig: NextConfig = {
  // This repo has its own lockfile under a parent that also has one; pin the
  // workspace root to silence Next's multiple-lockfile inference warning.
  turbopack: { root: join(here, '..', '..') },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            // frame-src: the Pantessa embed. connect-src 'self' + the wallet
            // extensions talk over injected providers, not fetch, so nothing
            // else is needed for signing.
            value: `frame-src ${PANTESSA_ORIGIN}; frame-ancestors 'self'`,
          },
        ],
      },
    ]
  },
}

export default nextConfig
