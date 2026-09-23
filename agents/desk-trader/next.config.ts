import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  // The workspace root holds the lockfile; pin it so Next doesn't guess.
  turbopack: { root: join(here, '..', '..') },
}

export default nextConfig
