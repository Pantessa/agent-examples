import { NextResponse } from 'next/server'
import { expenseAccount, recentReceipts, spendSummary } from '@/lib/agent'
import { DEFAULT_PRODUCT, hasCoinbaseKeys, isLive } from '@/lib/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// What mode is the agent in, and what has its expense account spent?
export async function GET() {
  return NextResponse.json({
    live: isLive(),
    hasCoinbaseKeys: hasCoinbaseKeys(),
    product: DEFAULT_PRODUCT,
    agentAddress: expenseAccount().address,
    spend: spendSummary(),
    receipts: recentReceipts(),
  })
}
