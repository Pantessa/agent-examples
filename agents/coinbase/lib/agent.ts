/**
 * The payer brain. Before the agent trades it buys a price signal *through its
 * Yeetful expense account* — an allowlist + per-call/per-day USD caps wrapped
 * around `yeetful()` — so every fetch is grant-checked and receipted, exactly
 * like a paid x402 call. The default signal source is Coinbase's free public
 * spot endpoint (a $0 pass-through that still proves the payer wiring); point
 * `SIGNAL_URL` at any x402 endpoint to pay for a real edge.
 *
 * The trade recommendation is a transparent, illustrative momentum rule — NOT
 * financial advice.
 */
import { createExpenseAccount, type ExpenseAccount, type Receipt } from '@yeetful/agent-kit'
import { getQuote, hasLiveQuote, type Quote } from './coinbase'
import { DEFAULT_PRODUCT, hasCoinbaseKeys } from './config'

function signalUrl(product: string): string {
  return process.env.SIGNAL_URL || `https://api.coinbase.com/v2/prices/${product}/spot`
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// One expense account per process (so the receipt log + day total accumulate).
let account: ExpenseAccount | null = null
export function expenseAccount(): ExpenseAccount {
  if (!account) {
    const hosts = new Set(['api.coinbase.com', hostOf(signalUrl(DEFAULT_PRODUCT))])
    account = createExpenseAccount({
      allow: [...hosts],
      perCallUsd: Number(process.env.SIGNAL_MAX_USD ?? 0.05),
      perDayUsd: Number(process.env.SIGNAL_DAY_USD ?? 1),
    })
  }
  return account
}

export interface Signal {
  product: string
  /** URL the signal was paid/fetched from. */
  source: string
  /** USD this signal call cost (0 for the free pass-through). */
  paidUsd: number
  /** External spot price used as the reference. */
  referenceUsd: number | null
  quote: Quote
  action: 'BUY' | 'SELL' | 'HOLD'
  rationale: string
  /** A post-only limit price to act on, when actionable. */
  suggestedLimitPrice: number | null
  /** Base size sized to ~$25 notional, for the trade form's convenience. */
  suggestedBaseSize: string | null
}

function parseSpot(body: unknown): number | null {
  // Coinbase spot: { data: { amount, base, currency } }. Be liberal for custom
  // x402 signal endpoints: also accept a bare number / { price } / { amount }.
  const b = body as Record<string, unknown> | number | null
  if (typeof b === 'number') return b
  if (b && typeof b === 'object') {
    const data = (b as { data?: { amount?: string } }).data
    if (data?.amount) return Number(data.amount)
    const p = (b as { price?: number | string; amount?: number | string }).price ?? (b as { amount?: number | string }).amount
    if (p != null) return Number(p)
  }
  return null
}

/** Buy a price signal through the expense account, then form a recommendation. */
export async function getSignal(product = DEFAULT_PRODUCT): Promise<Signal> {
  const pay = expenseAccount().pay
  const url = signalUrl(product)
  const before = expenseAccount().spentTodayUsd()

  let referenceUsd: number | null = null
  try {
    const res = await pay(url, { headers: { 'user-agent': 'yeetful-coinbase-agent' } })
    referenceUsd = parseSpot(await res.json())
  } catch {
    // Denial or network error — the receipt records it; we fall back to the book.
    referenceUsd = null
  }
  const paidUsd = Math.max(0, expenseAccount().spentTodayUsd() - before)

  // Order-book quote: real when keys exist, else synthesized around the spot.
  const quote: Quote = hasCoinbaseKeys()
    ? await getQuote(product)
    : synthQuote(product, referenceUsd)

  return decide(product, url, paidUsd, referenceUsd, quote)
}

function synthQuote(product: string, ref: number | null): Quote {
  const mid = ref ?? 0
  return {
    productId: product,
    bid: mid ? mid * 0.999 : null,
    ask: mid ? mid * 1.001 : null,
    mid: mid || null,
  }
}

function decide(
  product: string,
  source: string,
  paidUsd: number,
  referenceUsd: number | null,
  quote: Quote,
): Signal {
  const mid = quote.mid
  // Illustrative mean-reversion: if external spot sits meaningfully below the
  // book mid, the book looks rich → lean BUY at the bid; above → lean SELL at
  // the ask; within a 15bps band → HOLD.
  let action: Signal['action'] = 'HOLD'
  let suggestedLimitPrice: number | null = null
  let rationale = 'Within the no-trade band — holding.'

  if (referenceUsd != null && mid != null && mid > 0) {
    const drift = (referenceUsd - mid) / mid
    if (drift < -0.0015 && quote.bid != null) {
      action = 'BUY'
      suggestedLimitPrice = round2(quote.bid)
      rationale = `Spot ${fmt(referenceUsd)} is ${(drift * 100).toFixed(2)}% below the book mid ${fmt(mid)} → post a BUY at the bid.`
    } else if (drift > 0.0015 && quote.ask != null) {
      action = 'SELL'
      suggestedLimitPrice = round2(quote.ask)
      rationale = `Spot ${fmt(referenceUsd)} is ${(drift * 100).toFixed(2)}% above the book mid ${fmt(mid)} → post a SELL at the ask.`
    } else {
      rationale = `Spot ${fmt(referenceUsd)} ≈ book mid ${fmt(mid)} (${(drift * 100).toFixed(2)}%) — holding.`
    }
  } else if (referenceUsd == null) {
    rationale = 'No signal price available (call denied or endpoint down) — holding.'
  }

  const suggestedBaseSize =
    suggestedLimitPrice && suggestedLimitPrice > 0
      ? (25 / suggestedLimitPrice).toPrecision(4)
      : null

  return { product, source, paidUsd, referenceUsd, quote, action, rationale, suggestedLimitPrice, suggestedBaseSize }
}

const fmt = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const round2 = (n: number) => Math.round(n * 100) / 100

export function recentReceipts(): Receipt[] {
  return expenseAccount().receipts()
}

export function spendSummary(): { spentTodayUsd: number; remainingTodayUsd: number } {
  const a = expenseAccount()
  return { spentTodayUsd: a.spentTodayUsd(), remainingTodayUsd: a.remainingTodayUsd() }
}

export { hasLiveQuote }
