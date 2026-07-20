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
 * `PRIVATE_KEY` from env, normalized: trims whitespace/newlines, strips
 * accidental wrapping quotes (dashboards store pastes literally), and accepts
 * the key with or without its `0x` prefix. Returns null when unset; throws a
 * message that names the env var and the exact problem when it's malformed —
 * viem's bare "invalid private key" cost a real debugging session.
 */
export function loadAgentPrivateKey(): `0x${string}` | null {
  const raw = process.env.PRIVATE_KEY
  if (!raw) return null
  const trimmed = raw.trim().replace(/^['"]+|['"]+$/g, '')
  const hex = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed.slice(2) : trimmed
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      `PRIVATE_KEY is set but not a 32-byte hex key: expected 64 hex chars (0x prefix optional), got ${hex.length} chars${/[^0-9a-fA-F]/.test(hex) ? ' with non-hex characters' : ''}. Check for quotes, spaces, or a truncated paste in the env dashboard, then redeploy.`,
    )
  }
  return `0x${hex.toLowerCase()}`
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
  const pk = loadAgentPrivateKey() ?? generatePrivateKey()
  const account = privateKeyToAccount(pk)
  return createWalletClient({ account, chain: base, transport: http() })
}
