#!/usr/bin/env tsx
/**
 * The manager, run once by hand:
 *
 *   BASE=http://localhost:3834 MANAGER_KEY=my-desk-key npm run run:once
 *
 * Dry-run by default (LIVE unset): discovers + courts a listing and prints
 * what it learned, stamping every desk call internal so a real deployment
 * never counts the drill. Set LIVE=1 to run against a deployment for real.
 */
import { run } from './lib/manager'
import { LIVE, SITE, managerKey } from './lib/config'
import { createHash } from 'node:crypto'

async function main() {
  const key = managerKey()
  const handle = createHash('sha256').update(key).digest('hex').slice(0, 16)
  console.log(`roster-manager-template · ${LIVE ? 'LIVE' : 'dry-run (stamped)'} · ${SITE}`)
  console.log(`identity handle: ${handle}  (share THIS with an employer — never the key)`)
  const result = await run()
  for (const s of result.steps) console.log(`  • ${s.label}: ${s.detail}`)
  if (result.stopped) console.log(`  ⏹ ${result.stopped}`)
  console.log(result.proposed ? '  ✅ proposal addressed' : '  (no proposal — court a listing, get hired, then propose)')
}

main().catch((e) => {
  console.error('run failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
