import { defineConfig } from 'vitest/config'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// `driveJob` ships in `pantessa@1.1.0`. Until that version is on npm the
// import cannot resolve, so the unit tests (which inject their own driver)
// are pointed at a stub that throws if anything actually calls it, and
// tests/drive.test.ts skips itself. The alias disappears the moment the real
// package resolves — there is nothing to remember to undo.
let sdkPresent = true
try {
  createRequire(import.meta.url).resolve('pantessa/desk')
} catch {
  sdkPresent = false
  console.warn('\n[desk-trader] pantessa/desk is not installed — the real drive test will SKIP.\n')
}

export default defineConfig({
  resolve: {
    alias: sdkPresent ? {} : { 'pantessa/desk': path.resolve(here, 'tests/sdk-absent.ts') },
  },
  define: { __SDK_PRESENT__: JSON.stringify(sdkPresent) },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    testTimeout: 30_000,
  },
})
