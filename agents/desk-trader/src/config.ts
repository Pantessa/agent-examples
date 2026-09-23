import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'

/**
 * Everything this agent reads from its environment, in one place.
 *
 * Safe by default: with NOTHING set it mints a fresh throwaway key, points at
 * production, and runs dry — it opens a real intent, consents, lets the desk
 * compile a real job, prints the legs it WOULD sign, and stops. Nothing is
 * broadcast and nothing can be, because a dry run never reaches a signer.
 */
export interface AgentConfig {
  /** The agent's own signer. Pantessa never sees this key. */
  account: PrivateKeyAccount
  /** True when AGENT_KEY was supplied — a generated key holds no money. */
  bringsOwnKey: boolean
  base: string
  ask: string
  /** Your desk identity: your public track record at /agents/<hash of this>. */
  agentKey: string
  agentName: string
  live: boolean
  /** Pick option N from broker_open's list instead of the first fundable one. */
  optionIndex: number | null
  /** Pantessa's own drills only — keeps the run out of the growth arc. */
  internalRun: boolean
}

/** The shape that actually reaches the agent-signed path today.
 *
 *  `broker_execute` compiles SEQUENCED flows only, and a bare "2x long $12 of
 *  HYPE" is one step, so the desk refuses it by name. The compound below is
 *  four legs across two settlement boundaries — deposit, wait for Hyperliquid
 *  to credit it, open the position, arm the stop — which is exactly the loop
 *  this example exists to show. Set ASK to the bare sentence to watch the
 *  refusal for yourself; it is a good thirty seconds. */
export const DEFAULT_ASK =
  'Deposit 13 USDC to Hyperliquid, then 2x long $12 of HYPE, then protect my HYPE long with a 5% stop'

function flagValue(argv: string[], name: string): string | null {
  const i = argv.indexOf(`--${name}`)
  if (i >= 0 && argv[i + 1] != null) return argv[i + 1]
  const eq = argv.find((a) => a.startsWith(`--${name}=`))
  return eq ? eq.slice(name.length + 3) : null
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv.slice(2)): AgentConfig {
  const raw = (env.AGENT_KEY || '').trim()
  const bringsOwnKey = raw.length > 0
  const key = bringsOwnKey ? (raw.startsWith('0x') ? raw : `0x${raw}`) : generatePrivateKey()
  const account = privateKeyToAccount(key as `0x${string}`)
  const optRaw = flagValue(argv, 'option')
  const optionIndex = optRaw != null && /^\d+$/.test(optRaw) ? Number(optRaw) : null
  return {
    account,
    bringsOwnKey,
    base: (env.PANTESSA_BASE || 'https://www.pantessa.com').replace(/\/$/, ''),
    ask: (flagValue(argv, 'ask') || env.ASK || DEFAULT_ASK).trim(),
    // The desk binds the intent to this string and publishes the record under
    // sha256(it) — so it is an identity, not a secret, and a stable one keeps
    // your track record in one place. A generated wallet gets a scoped default
    // so throwaway runs never pile onto somebody else's record.
    agentKey: (env.AGENT_DESK_KEY || `desk-trader-${account.address.slice(2, 12).toLowerCase()}`).trim(),
    agentName: (env.AGENT_NAME || 'desk-trader').trim(),
    live: env.LIVE === '1',
    optionIndex,
    internalRun: env.INTERNAL_RUN === '1',
  }
}
