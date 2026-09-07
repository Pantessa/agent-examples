import { NextResponse } from 'next/server'
import { isAddress } from 'viem'
import { readPortfolio } from '@/lib/portfolio'

export const dynamic = 'force-dynamic'

/**
 * GET /api/portfolio?address=0x… — the wallet's Robinhood Chain holdings,
 * priced. Server-side so the public RPC sees one well-behaved caller (chunked
 * Multicall3) instead of every visitor's browser, and so the token list is
 * cached once. Read-only: nothing here can sign or spend.
 */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? ''
  if (!isAddress(address)) {
    return NextResponse.json({ error: 'address must be a 0x… EVM address' }, { status: 400 })
  }
  try {
    const portfolio = await readPortfolio(address)
    return NextResponse.json(portfolio, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `chain read failed: ${message.slice(0, 200)}` }, { status: 502 })
  }
}
