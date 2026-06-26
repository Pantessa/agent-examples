import { createWalletClient, http, type WalletClient } from 'viem'
import { base } from 'viem/chains'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

/**
 * The single arm switch every agent reads before it spends real USDC or places
 * a real order. With `LIVE` unset the default run is safe: throwaway wallet, no
 * spending, orders previewed not placed.
 */
export function isLive(): boolean {
  return process.env.LIVE === '1'
}

/**
 * A viem `WalletClient` on Base for the agent to pay x402 challenges from.
 *
 * Uses `PRIVATE_KEY` when set (a small dedicated burner), else a throwaway key
 * generated per process — so the default, key-less run is free and harmless
 * (every x402 payment is still grant-checked and receipted; it just never has
 * funds to settle). Mirrors the `example-agent` pattern.
 */
export function loadAgentWallet(): WalletClient {
  const pk = (process.env.PRIVATE_KEY as `0x${string}`) || generatePrivateKey()
  const account = privateKeyToAccount(pk)
  return createWalletClient({ account, chain: base, transport: http() })
}
