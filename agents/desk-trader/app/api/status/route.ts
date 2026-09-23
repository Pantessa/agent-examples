import { NextResponse } from 'next/server'
import { DEFAULT_ASK } from '@/src/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** What this deployment will do when you press the button: always a DRY run
 *  with a throwaway key. The web face never holds a funded key and never
 *  signs — LIVE is the CLI's job (`AGENT_KEY=0x… LIVE=1 pnpm dev`). */
export async function GET() {
  return NextResponse.json({
    mode: 'dry-run',
    base: (process.env.PANTESSA_BASE || 'https://www.pantessa.com').replace(/\/$/, ''),
    defaultAsk: DEFAULT_ASK,
    note: 'Dry run with a fresh throwaway key: opens a real intent, consents, lets the desk compile a real job, prints the legs it WOULD sign, closes the intent. Nothing is broadcast. LIVE=1 is CLI-only.',
  })
}
