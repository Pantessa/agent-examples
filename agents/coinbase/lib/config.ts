import { isLive } from '@yeetful/agent-kit'

export { isLive }

/** Coinbase Advanced Trade base host (no scheme — used in the JWT `uri` claim). */
export const COINBASE_HOST = 'api.coinbase.com'
export const COINBASE_BASE_URL = `https://${COINBASE_HOST}`

export interface CoinbaseKeys {
  /** CDP key name, e.g. "organizations/{org}/apiKeys/{key}". */
  keyName: string
  /** EC private key (SEC1 or PKCS8 PEM). */
  privateKey: string
}

/**
 * Read the CDP API credentials from env, or `null` when unset.
 *
 * Env values often store the PEM with literal `\n` escapes — we normalize those
 * back to real newlines so `crypto.createPrivateKey` can parse the key.
 */
export function loadCoinbaseKeys(): CoinbaseKeys | null {
  const keyName = process.env.COINBASE_API_KEY_NAME
  const privateKey = process.env.COINBASE_API_PRIVATE_KEY
  if (!keyName || !privateKey) return null
  return { keyName, privateKey: privateKey.replace(/\\n/g, '\n') }
}

export function hasCoinbaseKeys(): boolean {
  return loadCoinbaseKeys() !== null
}

/** The product the agent watches/trades by default. */
export const DEFAULT_PRODUCT = process.env.COINBASE_PRODUCT || 'BTC-USD'
