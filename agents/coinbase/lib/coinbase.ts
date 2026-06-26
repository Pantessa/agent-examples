/**
 * Coinbase Advanced Trade API client.
 *
 * Auth is a per-request JWT (ES256), signed with the CDP EC private key, valid
 * for 120s. The JWT's `uri` claim binds it to one METHOD + path, so we mint a
 * fresh token for every call. Docs: docs.cdp.coinbase.com/advanced-trade.
 *
 * Read paths (accounts/products) need real keys. Order placement additionally
 * needs `LIVE=1` — without it `createOrder` returns a *preview* and places
 * nothing, so the default run is safe.
 */
import { createPrivateKey, randomBytes } from 'node:crypto'
import { SignJWT, importPKCS8, type KeyLike } from 'jose'
import {
  COINBASE_BASE_URL,
  COINBASE_HOST,
  hasCoinbaseKeys,
  isLive,
  loadCoinbaseKeys,
  type CoinbaseKeys,
} from './config'

/** Whether order-book quotes/portfolio come from the real API (vs synthesized). */
export const hasLiveQuote = hasCoinbaseKeys

// ── Types (the slices we use) ───────────────────────────────────────────────

export interface CoinbaseAccount {
  uuid: string
  name: string
  currency: string
  available_balance: { value: string; currency: string }
  hold?: { value: string; currency: string }
}

export interface PriceBook {
  product_id: string
  bids: { price: string; size: string }[]
  asks: { price: string; size: string }[]
}

export interface PortfolioHolding {
  currency: string
  name: string
  amount: number
  /** USD spot price for the currency, when resolvable. */
  priceUsd: number | null
  /** amount × priceUsd, when resolvable. */
  valueUsd: number | null
}

export interface Portfolio {
  holdings: PortfolioHolding[]
  totalUsd: number
  /** True when these are real balances; false for the dry-run sample. */
  live: boolean
}

export type OrderSide = 'BUY' | 'SELL'
export type OrderType = 'LIMIT' | 'MARKET'

export interface PlaceOrderInput {
  productId: string
  side: OrderSide
  type: OrderType
  /** Base size (e.g. BTC) for LIMIT + MARKET SELL. */
  baseSize?: string
  /** Quote size (e.g. USD) for MARKET BUY. */
  quoteSize?: string
  /** Limit price — required for LIMIT. */
  limitPrice?: string
}

export interface OrderResult {
  /** False when this is a dry-run preview (no order was placed). */
  placed: boolean
  /** "preview" | "filled-or-open" | "rejected". */
  status: string
  productId: string
  side: OrderSide
  type: OrderType
  config: Record<string, unknown>
  /** Coinbase order id when placed. */
  orderId?: string
  /** Coinbase error payload when a real placement is rejected. */
  error?: unknown
  message: string
}

// ── JWT auth ──────────────────────────────────────────────────────────────

async function importSigningKey(pem: string): Promise<KeyLike> {
  // PKCS8 ("BEGIN PRIVATE KEY") imports straight through jose; SEC1
  // ("BEGIN EC PRIVATE KEY") is parsed by Node crypto, which auto-detects it.
  if (pem.includes('BEGIN PRIVATE KEY')) {
    return importPKCS8(pem, 'ES256')
  }
  return createPrivateKey({ key: pem, format: 'pem' }) as unknown as KeyLike
}

export async function mintJwt(keys: CoinbaseKeys, method: string, path: string): Promise<string> {
  const key = await importSigningKey(keys.privateKey)
  const now = Math.floor(Date.now() / 1000)
  // `uri` binds the token to one METHOD + host + path (no query string).
  const uri = `${method} ${COINBASE_HOST}${path}`
  return new SignJWT({ iss: 'cdp', sub: keys.keyName, uri })
    .setProtectedHeader({ alg: 'ES256', kid: keys.keyName, nonce: randomBytes(16).toString('hex'), typ: 'JWT' })
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 120)
    .sign(key)
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  opts: { query?: Record<string, string | string[]>; body?: unknown } = {},
): Promise<T> {
  const keys = loadCoinbaseKeys()
  if (!keys) throw new Error('NO_COINBASE_KEYS')

  // The JWT signs the bare path; the query string is appended only to the URL.
  const jwt = await mintJwt(keys, method, path)
  const url = new URL(COINBASE_BASE_URL + path)
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item)
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })

  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) {
    const err = new Error(`COINBASE_${res.status}`) as Error & { status: number; data: unknown }
    err.status = res.status
    err.data = data
    throw err
  }
  return data as T
}

// ── Portfolio ───────────────────────────────────────────────────────────────

const STABLE = new Set(['USD', 'USDC', 'USDT', 'DAI', 'PYUSD'])

/** Best ask (a buyer's price) for a product, or null if unavailable. */
async function spotUsd(currency: string): Promise<number | null> {
  if (STABLE.has(currency)) return 1
  try {
    const book = await getBestBidAsk([`${currency}-USD`])
    const px = book[0]?.asks?.[0]?.price ?? book[0]?.bids?.[0]?.price
    return px ? Number(px) : null
  } catch {
    return null
  }
}

/** List non-zero account balances and value them in USD (live keys required). */
export async function getPortfolio(): Promise<Portfolio> {
  const { accounts } = await request<{ accounts: CoinbaseAccount[] }>(
    'GET',
    '/api/v3/brokerage/accounts',
    { query: { limit: '250' } },
  )

  const nonZero = accounts.filter((a) => Number(a.available_balance.value) > 0)
  const holdings: PortfolioHolding[] = []
  for (const a of nonZero) {
    const amount = Number(a.available_balance.value)
    const priceUsd = await spotUsd(a.currency)
    const valueUsd = priceUsd != null ? amount * priceUsd : null
    holdings.push({ currency: a.currency, name: a.name, amount, priceUsd, valueUsd })
  }
  holdings.sort((x, y) => (y.valueUsd ?? 0) - (x.valueUsd ?? 0))
  const totalUsd = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0)
  return { holdings, totalUsd, live: true }
}

/** A realistic sample portfolio for the key-less dry-run UI. */
export function samplePortfolio(): Portfolio {
  const rows: [string, string, number, number][] = [
    ['USD', 'Cash (USD)', 4250.0, 1],
    ['BTC', 'Bitcoin', 0.125, 67800],
    ['ETH', 'Ethereum', 1.8, 3520],
    ['SOL', 'Solana', 22.5, 168],
  ]
  const holdings: PortfolioHolding[] = rows.map(([currency, name, amount, priceUsd]) => ({
    currency,
    name,
    amount,
    priceUsd,
    valueUsd: amount * priceUsd,
  }))
  return {
    holdings,
    totalUsd: holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0),
    live: false,
  }
}

// ── Order book ────────────────────────────────────────────────────────────

export async function getBestBidAsk(productIds: string[]): Promise<PriceBook[]> {
  const { pricebooks } = await request<{ pricebooks: PriceBook[] }>(
    'GET',
    '/api/v3/brokerage/best_bid_ask',
    { query: { product_ids: productIds } },
  )
  return pricebooks
}

export interface Quote {
  productId: string
  bid: number | null
  ask: number | null
  mid: number | null
}

export async function getQuote(productId: string): Promise<Quote> {
  const [book] = await getBestBidAsk([productId])
  const bid = book?.bids?.[0]?.price ? Number(book.bids[0].price) : null
  const ask = book?.asks?.[0]?.price ? Number(book.asks[0].price) : null
  const mid = bid != null && ask != null ? (bid + ask) / 2 : (ask ?? bid)
  return { productId, bid, ask, mid }
}

// ── Orders ──────────────────────────────────────────────────────────────────

export function buildOrderConfig(input: PlaceOrderInput): Record<string, unknown> {
  if (input.type === 'LIMIT') {
    if (!input.limitPrice) throw new Error('LIMIT order needs limitPrice')
    if (!input.baseSize) throw new Error('LIMIT order needs baseSize')
    return { limit_limit_gtc: { base_size: input.baseSize, limit_price: input.limitPrice, post_only: false } }
  }
  // MARKET: buy spends quote (USD), sell sends base.
  if (input.side === 'BUY') {
    if (!input.quoteSize) throw new Error('MARKET BUY needs quoteSize')
    return { market_market_ioc: { quote_size: input.quoteSize } }
  }
  if (!input.baseSize) throw new Error('MARKET SELL needs baseSize')
  return { market_market_ioc: { base_size: input.baseSize } }
}

/**
 * Place an order — or, unless `LIVE=1`, *preview* one. The preview returns the
 * exact request body that would be sent, so the dry-run path proves the wiring
 * without risking a fill.
 */
export async function placeOrder(input: PlaceOrderInput): Promise<OrderResult> {
  const order_configuration = buildOrderConfig(input)
  const base: Omit<OrderResult, 'placed' | 'status' | 'message'> = {
    productId: input.productId,
    side: input.side,
    type: input.type,
    config: order_configuration,
  }

  if (!isLive()) {
    return {
      ...base,
      placed: false,
      status: 'preview',
      message: `Dry-run — previewed a ${input.type} ${input.side} on ${input.productId}. Set LIVE=1 (with CDP keys) to place it.`,
    }
  }
  if (!loadCoinbaseKeys()) {
    return { ...base, placed: false, status: 'rejected', message: 'LIVE=1 but no CDP keys set.' }
  }

  // client_order_id makes the request idempotent on Coinbase's side.
  const client_order_id = randomBytes(16).toString('hex')
  try {
    const res = await request<{ success: boolean; order_id?: string; success_response?: { order_id: string }; error_response?: unknown }>(
      'POST',
      '/api/v3/brokerage/orders',
      { body: { client_order_id, product_id: input.productId, side: input.side, order_configuration } },
    )
    if (res.success) {
      const orderId = res.success_response?.order_id ?? res.order_id
      return { ...base, placed: true, status: 'filled-or-open', orderId, message: `Order placed (${orderId}).` }
    }
    return { ...base, placed: false, status: 'rejected', error: res.error_response, message: 'Coinbase rejected the order.' }
  } catch (err) {
    const e = err as Error & { data?: unknown }
    return { ...base, placed: false, status: 'rejected', error: e.data ?? e.message, message: `Order failed: ${e.message}` }
  }
}
