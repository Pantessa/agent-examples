import { NextResponse } from 'next/server'
import { getClient, ROBINHOOD_CHAIN_ID } from '@/lib/chain'
import { loadStockTokens } from '@/lib/tokens'
import { deskConfig } from '@/lib/config'

export const dynamic = 'force-dynamic'

/** GET /api/status — what this desk is wired to (no secrets exist to leak). */
export async function GET() {
  const cfg = deskConfig()
  const [block, tokens] = await Promise.all([
    getClient().getBlockNumber().catch(() => null),
    loadStockTokens().catch(() => []),
  ])
  return NextResponse.json({
    chainId: ROBINHOOD_CHAIN_ID,
    rpcOk: block !== null,
    block: block?.toString() ?? null,
    listedStocks: tokens.length,
    embed: { origin: cfg.embedOrigin, mcps: cfg.mcps, keyed: !!cfg.embedKey },
  })
}
