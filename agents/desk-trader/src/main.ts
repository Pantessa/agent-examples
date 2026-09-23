#!/usr/bin/env node
/**
 * desk-trader — the CLI shell. Reads the environment, hands the agent its own
 * key, runs the loop, prints what happened.
 *
 *   pnpm dev                                  dry run, fresh throwaway key
 *   AGENT_KEY=0x… pnpm dev                    dry run against YOUR wallet
 *   AGENT_KEY=0x… LIVE=1 pnpm dev             arm it — real signatures
 *   pnpm dev -- --ask "…" --option 1          your sentence, your route
 *
 * Exit codes: 0 whenever the AGENT behaved — including when the desk or the
 * guard refuses, which is the product working, not a failure. Non-zero is
 * reserved for the agent's own faults: bad config, an unreachable desk, a bug.
 */
import { loadConfig } from './config.js'
import { runDeskTrader } from './agent.js'

async function main(): Promise<number> {
  const cfg = loadConfig()

  if (!cfg.bringsOwnKey) {
    console.log('note      no AGENT_KEY set — minted a fresh throwaway key for this run.')
    console.log('          It holds nothing, so the desk will read an empty wallet and say so.\n')
  }
  if (cfg.live && !cfg.bringsOwnKey) {
    console.error('LIVE=1 with a generated key would sign with a wallet that holds nothing and')
    console.error('that you will never see again. Set AGENT_KEY to a funded burner first.')
    return 2
  }

  const outcome = await runDeskTrader(cfg)
  // Everything above already narrated itself; this is the one machine-readable
  // line, so a wrapper script can grep it.
  console.log(`\noutcome   ${JSON.stringify({ kind: outcome.kind, ...('where' in outcome ? { where: outcome.where } : {}) })}`)
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`\nFAILED    ${err instanceof Error ? err.message : String(err)}`)
    if (process.env.DEBUG === '1' && err instanceof Error) console.error(err.stack)
    process.exit(1)
  })
