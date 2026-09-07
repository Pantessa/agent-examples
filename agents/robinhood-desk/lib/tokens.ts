// The tokenized-stock list for Robinhood Chain, from Uniswap Labs' official
// token list (tokens.uniswap.org carries chainId 4663 — the same source the
// Pantessa swap builder resolves against, so the desk and the embed agree on
// what "AAPL" is). Cached in memory for 24h; a network failure degrades to the
// money tokens only (never throws).

import { USDE, USDG, WETH } from './chain'

export interface DeskToken {
  address: `0x${string}`
  symbol: string
  name: string
  decimals: number
  /** Money tokens (USDG/USDe) and gas (WETH) are not stocks. */
  kind: 'stock' | 'stable' | 'gas'
}

const UNISWAP_LIST = 'https://tokens.uniswap.org'
const TTL_MS = 24 * 60 * 60 * 1000

export const MONEY_TOKENS: DeskToken[] = [
  { ...USDG, kind: 'stable' },
  { ...USDE, kind: 'stable' },
  { ...WETH, kind: 'gas' },
]

interface RawToken {
  chainId: number
  address: string
  symbol: string
  name?: string
  decimals: number
}

let cache: { tokens: DeskToken[]; loadedAt: number } | null = null
let inflight: Promise<DeskToken[]> | null = null

/** Pure: raw list → the desk's stock tokens (money tokens excluded, deduped by address). */
export function stocksFromList(raw: RawToken[], chainId = 4663): DeskToken[] {
  const money = new Set(MONEY_TOKENS.map((t) => t.address.toLowerCase()))
  const seen = new Set<string>()
  const out: DeskToken[] = []
  for (const t of raw) {
    if (t.chainId !== chainId) continue
    if (!/^0x[0-9a-fA-F]{40}$/.test(t.address)) continue
    const key = t.address.toLowerCase()
    if (money.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push({
      address: t.address as `0x${string}`,
      symbol: t.symbol,
      name: t.name ?? t.symbol,
      decimals: t.decimals,
      kind: 'stock',
    })
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol))
}

export async function loadStockTokens(fetchImpl: typeof fetch = fetch): Promise<DeskToken[]> {
  if (cache && Date.now() - cache.loadedAt < TTL_MS) return cache.tokens
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetchImpl(UNISWAP_LIST, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`token list ${res.status}`)
      const data = (await res.json()) as { tokens: RawToken[] }
      const tokens = stocksFromList(data.tokens)
      if (tokens.length > 0) cache = { tokens, loadedAt: Date.now() }
      return tokens
    } catch {
      // Stale cache beats no list; no cache → stocks unknown this round.
      return cache?.tokens ?? []
    } finally {
      inflight = null
    }
  })()
  return inflight
}
