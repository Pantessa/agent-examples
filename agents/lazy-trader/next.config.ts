import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  // agent-kit is a workspace source package (TS), so let Next transpile it.
  transpilePackages: ['@yeetful/agent-kit'],
  // This repo has its own lockfile under a parent that also has one; pin the
  // workspace root to silence Next's multiple-lockfile inference warning.
  turbopack: { root: join(here, '..', '..') },
}

export default nextConfig
