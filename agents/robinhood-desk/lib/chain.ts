// Robinhood Chain (4663) — the one chain this desk reads. Everything here is
// public + keyless: the chain's own RPC, the canonical Multicall3, and
// Uniswap's QuoterV2 (v3 pools quote the tokenized stocks against USDG).
//
// Addresses match Pantessa's own chain registry (bytecode-verified there) and
// Uniswap's deployments/4663.md. The desk never builds calldata — that is the
// embed's job (guarded, on the Pantessa side); this module only READS.

import { createPublicClient, defineChain, http, type PublicClient } from 'viem'

export const ROBINHOOD_CHAIN_ID = 4663

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } },
  blockExplorers: {
    default: { name: 'Robinhood Chain Explorer', url: 'https://robinhoodchain.blockscout.com' },
  },
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
})

/** The chain as the wallet needs it (EIP-3085 wallet_addEthereumChain). */
export const ROBINHOOD_CHAIN_PARAMS = {
  chainId: `0x${ROBINHOOD_CHAIN_ID.toString(16)}`,
  chainName: robinhoodChain.name,
  nativeCurrency: robinhoodChain.nativeCurrency,
  rpcUrls: [...robinhoodChain.rpcUrls.default.http],
  blockExplorerUrls: [robinhoodChain.blockExplorers.default.url],
} as const

export const EXPLORER_TX = 'https://robinhoodchain.blockscout.com/tx/'
export const EXPLORER_ADDRESS = 'https://robinhoodchain.blockscout.com/address/'

/** Uniswap v3 QuoterV2 on 4663 — quotes a stock → USDG without a swap. */
export const QUOTER_V2 = '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7' as const

/** The money tokens. Robinhood Chain has no USDC: USDG (Global Dollar) is the
 *  stock-pool quote asset; USDe is the other large stable. */
export const USDG = { address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', symbol: 'USDG', name: 'Global Dollar', decimals: 6 } as const
export const USDE = { address: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34', symbol: 'USDe', name: 'Ethena USDe', decimals: 18 } as const
export const WETH = { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 } as const

/** Fee tiers the stock pools were seeded on (500 = the deep ones). */
export const QUOTE_FEE_TIERS = [500, 3000] as const

export const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// QuoterV2.quoteExactInputSingle is declared non-view upstream (it reverts
// internally to return data); it is DESIGNED to be called through eth_call,
// which is exactly what Multicall3.aggregate3 does. Declaring it `view` here
// lets viem's multicall type it — the wire is identical.
export const QUOTER_V2_ABI = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'view',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const

let client: PublicClient | null = null

/**
 * One shared client. The public RPC 429s bursts and rejects JSON-RPC batch
 * envelopes, so: NO transport batching, reads go through Multicall3 in chunks
 * (lib/portfolio.ts), and viem's built-in retry backs off on 429.
 */
export function getClient(): PublicClient {
  if (client) return client
  const url = process.env.ROBINHOOD_RPC_URL || robinhoodChain.rpcUrls.default.http[0]
  client = createPublicClient({
    chain: robinhoodChain,
    transport: http(url, { retryCount: 3, retryDelay: 400, timeout: 15_000 }),
  })
  return client
}
