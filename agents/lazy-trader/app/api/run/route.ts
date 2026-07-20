import { NextResponse } from 'next/server'
import { runLazyTrade, type Goal } from '@/lib/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Live runs wait on cross-chain settlement (a minute or two per leg).
export const maxDuration = 300

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<Goal>
    if (!body.chain || !body.token || !body.amount) {
      return NextResponse.json({ error: 'chain, token and amount are required' }, { status: 400 })
    }
    const result = await runLazyTrade({
      chain: String(body.chain),
      token: String(body.token),
      amount: Number(body.amount),
      finalAction: body.finalAction ? String(body.finalAction).slice(0, 300) : undefined,
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
