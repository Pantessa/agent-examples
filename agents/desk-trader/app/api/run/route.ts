import { NextResponse } from 'next/server'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { runDeskTrader } from '@/src/agent'
import { DEFAULT_ASK } from '@/src/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST { ask?: string, option?: number } → the dry-run transcript.
 *
 *  The web face is a window onto the loop, not a signer: every run mints a
 *  fresh throwaway key (it holds nothing, so the desk reads an empty wallet
 *  and the guard refuses leg 0 fail-closed — which IS the demo), `live` is
 *  hard-wired false, and the intent is closed afterwards. A funded key and
 *  LIVE=1 exist only on the CLI, in the operator's own process. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { ask?: unknown; option?: unknown }
  const ask = typeof body.ask === 'string' && body.ask.trim() ? body.ask.trim().slice(0, 280) : DEFAULT_ASK
  const optionIndex = typeof body.option === 'number' && Number.isInteger(body.option) && body.option >= 0 ? body.option : null
  const account = privateKeyToAccount(generatePrivateKey())
  const lines: string[] = []
  try {
    const outcome = await runDeskTrader({
      account,
      base: (process.env.PANTESSA_BASE || 'https://www.pantessa.com').replace(/\/$/, ''),
      ask,
      agentKey: `desk-trader-web-${account.address.slice(2, 12).toLowerCase()}`,
      agentName: 'desk-trader (web)',
      live: false,
      optionIndex,
      internalRun: process.env.INTERNAL_RUN === '1',
      log: (l) => lines.push(l),
    })
    return NextResponse.json({ mode: 'dry-run', wallet: account.address, ask, lines, outcome })
  } catch (err) {
    return NextResponse.json({ mode: 'dry-run', wallet: account.address, ask, lines, error: (err as Error).message }, { status: 502 })
  }
}
