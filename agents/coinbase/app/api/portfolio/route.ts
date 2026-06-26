import { NextResponse } from 'next/server'
import { getPortfolio, samplePortfolio } from '@/lib/coinbase'
import { hasCoinbaseKeys, isLive } from '@/lib/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Real balances need keys AND LIVE (reading the account is a privileged call);
// otherwise show a representative sample so the dashboard is never empty.
export async function GET() {
  if (hasCoinbaseKeys() && isLive()) {
    try {
      return NextResponse.json(await getPortfolio())
    } catch (err) {
      const e = err as Error
      return NextResponse.json(
        { ...samplePortfolio(), error: `Live read failed (${e.message}); showing sample.` },
        { status: 200 },
      )
    }
  }
  return NextResponse.json(samplePortfolio())
}
