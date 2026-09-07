// The portfolio read: balances of every listed stock + the money tokens + gas
// ETH for one address, priced against USDG through Uniswap's QuoterV2. Pure
// aggregation (`buildPortfolio`) is separate from the chain I/O so the maths
// is unit-tested without an RPC.

import { formatUnits, getAddress, isAddress, parseUnits } from 'viem'
import { ERC20_ABI, QUOTER_V2, QUOTER_V2_ABI, QUOTE_FEE_TIERS, ROBINHOOD_CHAIN_ID, USDG, getClient } from './chain'
import { MONEY_TOKENS, loadStockTokens, type DeskToken } from './tokens'

export interface Position {
  symbol: string
  name: string
  address: `0x${string}`
  decimals: number
  kind: DeskToken['kind']
  /** Human units (shares / tokens), as a decimal string. */
  qty: string
  /** USD per unit (USDG-quoted). null = no pool answered. */
  price: number | null
  usd: number
  /** Share of the priced portfolio, 0–1. */
  weight: number
}

export interface Portfolio {
  chainId: number
  address: `0x${string}`
  block: string
  quotedAt: string
  eth: { qty: string; usd: number | null }
  positions: Position[]
  totals: {
    /** Everything priced, incl. cash + gas. */
    usd: number
    stocksUsd: number
    cashUsd: number
    /** Holdings that had a balance but no price (not in the total). */
    unpriced: string[]
  }
}

export interface RawBalance {
  token: DeskToken
  balance: bigint
  /** USDG out for ONE whole unit of the token, per fee tier tried. */
  quotes: bigint[]
}

const CHUNK = 40

export function bestUsd(quotes: bigint[]): number | null {
  const best = quotes.reduce<bigint | null>((m, q) => (m === null || q > m ? q : m), null)
  return best === null ? null : Number(formatUnits(best, USDG.decimals))
}

/** Pure: raw balances (+ ETH) → the desk's portfolio shape. */
export function buildPortfolio(
  address: `0x${string}`,
  rows: RawBalance[],
  eth: { balance: bigint; quotes: bigint[] },
  block: bigint,
  now = new Date(),
): Portfolio {
  const positions: Position[] = []
  const unpriced: string[] = []
  for (const r of rows) {
    if (r.balance === 0n) continue
    const qtyNum = Number(formatUnits(r.balance, r.token.decimals))
    // Stables are the quote asset: 1:1 by definition (USDe tracks the dollar).
    const price = r.token.kind === 'stable' ? 1 : bestUsd(r.quotes)
    if (price === null) unpriced.push(r.token.symbol)
    positions.push({
      symbol: r.token.symbol,
      name: r.token.name,
      address: r.token.address,
      decimals: r.token.decimals,
      kind: r.token.kind,
      qty: formatUnits(r.balance, r.token.decimals),
      price,
      usd: price === null ? 0 : qtyNum * price,
      weight: 0,
    })
  }
  const ethQty = Number(formatUnits(eth.balance, 18))
  const ethPrice = bestUsd(eth.quotes)
  const ethUsd = ethPrice === null ? null : ethQty * ethPrice
  const stocksUsd = positions.filter((p) => p.kind === 'stock').reduce((s, p) => s + p.usd, 0)
  const cashUsd = positions.filter((p) => p.kind === 'stable').reduce((s, p) => s + p.usd, 0)
  const gasUsd = positions.filter((p) => p.kind === 'gas').reduce((s, p) => s + p.usd, 0)
  const usd = stocksUsd + cashUsd + gasUsd + (ethUsd ?? 0)
  for (const p of positions) p.weight = usd > 0 ? p.usd / usd : 0
  positions.sort((a, b) => b.usd - a.usd || a.symbol.localeCompare(b.symbol))
  return {
    chainId: ROBINHOOD_CHAIN_ID,
    address,
    block: block.toString(),
    quotedAt: now.toISOString(),
    eth: { qty: formatUnits(eth.balance, 18), usd: ethUsd },
    positions,
    totals: { usd, stocksUsd, cashUsd, unpriced },
  }
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/**
 * Chain I/O. Sequential Multicall3 chunks (the public RPC 429s bursts and
 * refuses JSON-RPC batch envelopes); a chunk that fails is retried once, and
 * a token whose read still fails is simply absent this round (never a throw
 * that blanks the whole desk).
 */
export async function readPortfolio(rawAddress: string): Promise<Portfolio> {
  if (!isAddress(rawAddress)) throw new Error('invalid address')
  const address = getAddress(rawAddress)
  const client = getClient()
  const stocks = await loadStockTokens()
  const tokens: DeskToken[] = [...MONEY_TOKENS, ...stocks]

  const [block, ethBalance] = await Promise.all([client.getBlockNumber(), client.getBalance({ address })])

  // 1. balances
  const balances = new Map<string, bigint>()
  for (const group of chunks(tokens, CHUNK)) {
    const contracts = group.map((t) => ({ address: t.address, abi: ERC20_ABI, functionName: 'balanceOf' as const, args: [address] as const }))
    let res = await client.multicall({ contracts, allowFailure: true })
    if (res.some((r) => r.status === 'failure')) {
      await new Promise((r) => setTimeout(r, 500))
      res = await client.multicall({ contracts, allowFailure: true })
    }
    res.forEach((r, i) => {
      if (r.status === 'success') balances.set(group[i].address.toLowerCase(), r.result as bigint)
    })
  }

  // 2. quotes — only for what the wallet actually holds (plus ETH via WETH)
  const held = tokens.filter((t) => (balances.get(t.address.toLowerCase()) ?? 0n) > 0n && t.kind !== 'stable')
  const weth = MONEY_TOKENS.find((t) => t.kind === 'gas')!
  const toQuote = [...new Map([...held, weth].map((t) => [t.address.toLowerCase(), t])).values()]
  const quoteCalls = toQuote.flatMap((t) =>
    QUOTE_FEE_TIERS.map((fee) => ({
      address: QUOTER_V2,
      abi: QUOTER_V2_ABI,
      functionName: 'quoteExactInputSingle' as const,
      args: [{ tokenIn: t.address, tokenOut: USDG.address, amountIn: parseUnits('1', t.decimals), fee, sqrtPriceLimitX96: 0n }] as const,
    })),
  )
  const quotes = new Map<string, bigint[]>()
  let offset = 0
  for (const group of chunks(quoteCalls, CHUNK)) {
    const res = await client.multicall({ contracts: group, allowFailure: true })
    res.forEach((r, i) => {
      const call = quoteCalls[offset + i]
      const key = (call.args[0].tokenIn as string).toLowerCase()
      const list = quotes.get(key) ?? []
      if (r.status === 'success') list.push((r.result as readonly [bigint, bigint, number, bigint])[0])
      quotes.set(key, list)
    })
    offset += group.length
  }

  const rows: RawBalance[] = tokens
    .filter((t) => balances.has(t.address.toLowerCase()))
    .map((t) => ({ token: t, balance: balances.get(t.address.toLowerCase())!, quotes: quotes.get(t.address.toLowerCase()) ?? [] }))
  const ethQuotes = quotes.get(weth.address.toLowerCase()) ?? []
  return buildPortfolio(address, rows, { balance: ethBalance, quotes: ethQuotes }, block)
}

// ── Prompts ─────────────────────────────────────────────────────────────────
// Every desk action is a plain English ask into the embed — the exact
// sentences Pantessa's native stock layer parses ("Buy $10 of AAPL on
// Robinhood Chain"). Pure + pinned by tests so a UI tweak can't drift the
// grammar into the planner's lap.

export const CHAIN_WORD = 'Robinhood Chain'

export const prompts = {
  buyUsd: (symbol: string, usd: number) => `Buy $${trimNum(usd)} of ${symbol} on ${CHAIN_WORD}`,
  /** Sells name the QUANTITY the desk shows (4 dp) — "sell all my X" has no
   *  native sizing rule yet and falls to the planner, which only narrates. */
  sellQty: (symbol: string, qty: string | number) => `Sell ${qtyNum(Number(qty))} ${symbol} for USDG on ${CHAIN_WORD}`,
  dcaWeekly: (symbol: string, usd: number) => `Buy $${trimNum(usd)} of ${symbol} every week on ${CHAIN_WORD}`,
  fund: (usd: number) => `I need $${trimNum(usd)} of USDG on ${CHAIN_WORD}`,
  portfolio: () => `Show my portfolio on ${CHAIN_WORD}`,
  rebalance: () => `Rebalance my portfolio on ${CHAIN_WORD}`,
}

/** Share counts: up to 4 dp, trailing zeros trimmed, never sci notation. */
export function qtyNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  return n.toFixed(4).replace(/\.?0+$/, '')
}

/** 10 → "10", 12.5 → "12.5", 0.123456 → "0.1235" (money-shaped, never sci notation). */
export function trimNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const fixed = n >= 1 ? n.toFixed(2) : n.toFixed(4)
  return fixed.replace(/\.?0+$/, '')
}
