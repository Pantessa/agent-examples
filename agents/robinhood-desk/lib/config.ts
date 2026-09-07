// Desk configuration — all public. The embed key is a PUBLISHABLE identifier
// (like a Stripe pk_), which is why it rides NEXT_PUBLIC_ and page source.

/** The MCPs the embed is scoped to (contract cap: 4). Stocks + swaps + the
 *  wallet reader; Pantessa's native transaction layer rides along regardless. */
export const DESK_MCPS = ['robinhood-free', 'uniswap-free', 'yeetful-tool-wallet'] as const

export interface DeskConfig {
  embedOrigin: string
  embedKey: string | null
  mcps: string[]
  watchAddress: string | null
}

export function deskConfig(): DeskConfig {
  const origin = (process.env.NEXT_PUBLIC_PANTESSA_ORIGIN || 'https://www.pantessa.com').replace(/\/+$/, '')
  const key = process.env.NEXT_PUBLIC_PANTESSA_EMBED_KEY?.trim() || null
  return {
    embedOrigin: origin,
    embedKey: key && /^yfe_[A-Za-z0-9_-]+$/.test(key) ? key : null,
    mcps: [...DESK_MCPS],
    watchAddress: process.env.NEXT_PUBLIC_WATCH_ADDRESS?.trim() || null,
  }
}
