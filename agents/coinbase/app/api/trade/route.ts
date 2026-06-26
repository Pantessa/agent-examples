import { NextResponse } from 'next/server'
import { placeOrder, type OrderSide, type OrderType } from '@/lib/coinbase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Place (or, unless LIVE=1, preview) an order. The lib enforces the LIVE gate —
// this route just validates inputs.
export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const productId = String(body.productId || '')
  const side = String(body.side || '').toUpperCase() as OrderSide
  const type = String(body.type || '').toUpperCase() as OrderType
  if (!productId) return NextResponse.json({ error: 'productId is required.' }, { status: 400 })
  if (side !== 'BUY' && side !== 'SELL')
    return NextResponse.json({ error: 'side must be BUY or SELL.' }, { status: 400 })
  if (type !== 'LIMIT' && type !== 'MARKET')
    return NextResponse.json({ error: 'type must be LIMIT or MARKET.' }, { status: 400 })

  try {
    const result = await placeOrder({
      productId,
      side,
      type,
      baseSize: body.baseSize ? String(body.baseSize) : undefined,
      quoteSize: body.quoteSize ? String(body.quoteSize) : undefined,
      limitPrice: body.limitPrice ? String(body.limitPrice) : undefined,
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
}
