import { NextResponse } from 'next/server'
import { getSignal, recentReceipts, spendSummary } from '@/lib/agent'
import { DEFAULT_PRODUCT } from '@/lib/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const product = new URL(req.url).searchParams.get('product') || DEFAULT_PRODUCT
  try {
    const signal = await getSignal(product)
    return NextResponse.json({ signal, receipts: recentReceipts(), spend: spendSummary() })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
