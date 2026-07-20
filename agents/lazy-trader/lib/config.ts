import { base, arbitrum, mainnet, type Chain } from 'viem/chains'

/**
 * The two MCPs this agent composes:
 *  - the funding planner (Yeetful's yeetful-tool-funding) — scan + fund_and_build
 *  - NEAR Intents (Yeetful's near-intents MCP) — builds each leg's deposit tx
 *
 * In LIVE mode the funding calls go through the PAID door (/paid/mcp) via the
 * expense account — every call is an x402 payment with a receipt. In dry-run
 * they ride the free door, so the default run costs nothing and needs nothing.
 */
export const FUNDING_MCP = (process.env.FUNDING_MCP_URL || 'https://funding-mcp.yeetful.com').replace(/\/$/, '')
export const NEAR_INTENTS_MCP = (process.env.NEAR_INTENTS_MCP_URL || 'https://near-intents.yeetful.com').replace(/\/$/, '')

export const FUNDING_FREE_DOOR = `${FUNDING_MCP}/mcp`
export const FUNDING_PAID_DOOR = `${FUNDING_MCP}/paid/mcp`
export const NEAR_INTENTS_DOOR = `${NEAR_INTENTS_MCP}/mcp`

/** Address the DRY-RUN plans for when the agent's own wallet is a throwaway —
 *  the Yeetful house wallet by default (known small real holdings, so the
 *  default demo shows a REAL plan instead of an empty scan). Live mode always
 *  uses the agent's own wallet. */
export const DEMO_ADDRESS = (process.env.DEMO_ADDRESS || '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0') as `0x${string}`

export interface GoalChain {
  /** The word the funding planner speaks ("Base"). */
  word: string
  chainId: number
  chain: Chain
  /** publicnode RPC — viem's defaults 429 under load (mainnet especially). */
  rpcUrl: string
}

/** Chains the funding planner covers as destinations AND origins. */
export const GOAL_CHAINS: GoalChain[] = [
  { word: 'Base', chainId: 8453, chain: base, rpcUrl: 'https://base-rpc.publicnode.com' },
  { word: 'Arbitrum', chainId: 42161, chain: arbitrum, rpcUrl: 'https://arbitrum-one-rpc.publicnode.com' },
  { word: 'Ethereum', chainId: 1, chain: mainnet, rpcUrl: 'https://ethereum-rpc.publicnode.com' },
]

export function resolveGoalChain(input: string): GoalChain | null {
  const t = input.trim().toLowerCase()
  return (
    GOAL_CHAINS.find(
      (c) => c.word.toLowerCase() === t || String(c.chainId) === t || (t === 'mainnet' && c.chainId === 1) || (t === 'eth' && c.chainId === 1) || (t === 'arb' && c.chainId === 42161),
    ) ?? null
  )
}
