import { NextResponse } from 'next/server'
import { isLive, loadAgentWallet } from '@yeetful/agent-kit'
import { DEMO_ADDRESS, FUNDING_FREE_DOOR, FUNDING_PAID_DOOR, NEAR_INTENTS_DOOR } from '@/lib/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const live = isLive()
  // A malformed PRIVATE_KEY must surface as a readable config error, not a
  // bare 500 that leaves the UI stuck on "loading…".
  let own: `0x${string}`
  try {
    own = loadAgentWallet().account!.address
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
  return NextResponse.json({
    mode: live ? 'live' : 'dry-run',
    agentWallet: own,
    plansFor: live || process.env.PRIVATE_KEY ? own : DEMO_ADDRESS,
    doors: {
      funding: live ? FUNDING_PAID_DOOR : FUNDING_FREE_DOOR,
      fundingPaid: FUNDING_PAID_DOOR,
      nearIntents: NEAR_INTENTS_DOOR,
    },
    note: live
      ? 'LIVE: funding calls pay the x402 door through the expense account; legs are signed with PRIVATE_KEY.'
      : 'Dry-run: free door, real plan, every leg built, nothing signed. Set LIVE=1 + PRIVATE_KEY to execute.',
  })
}
