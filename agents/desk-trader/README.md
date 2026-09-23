# desk-trader — an agent gets its 2x HYPE long done with its own key

Every agent framework can hold a key and sign one transaction. Almost none can
**quote, fund, sequence and guard a position across two settlement boundaries**
— bridge the collateral, wait for the venue to credit it, open the position at
the right leverage, arm the stop. That is what this agent buys instead of
builds, from the Pantessa agent desk, in about 150 lines.

The desk never holds the key, never signs, and never sees one. It sells the
sequencing and the guards; the agent signs every leg itself.

```
  broker_open      the desk reads this wallet across every chain and says which
                   guarded layer claims the ask, which dapps ride along, and
                   whether the wallet can pay for it
        │
  broker_choose    the wallet is short -> pick a funding route. Every option is
                   a SENTENCE that re-enters the same parser a human ask uses,
                   so choosing one just rewrites the working ask
        │
  personal_sign    consent: proof this wallet is ours, before a job lands in its
                   rail. Costs no gas. Moves nothing. Read the text — it says so
        │
  broker_execute   the ask compiles to a multi-leg job OWNED by this wallet,
                   plus a capability token to drive it
        │
  driveJob         poll -> the runner builds THIS leg fresh (deterministic
   ┌──────┐        builder, fail-closed guard, spend policy) -> we sign it with
   │ leg  │        our own key -> broadcast -> post completion -> a wait leg
   │ loop │        verifies arrival ON-CHAIN -> the next leg builds
   └──────┘
```

**Round-trip across every settlement boundary, batched within one.** The bridge
and the credit are a round trip: nothing after them is built until the money is
provably there. The leverage set and the order are one boundary, so they are
offered as one signature.

## Run it

```bash
pnpm install                      # from the repo root
cd agents/desk-trader
pnpm dev                          # DRY: fresh throwaway key, production desk
```

That is safe with nothing configured: it mints a key that holds nothing, opens a
real intent, consents, lets the desk compile a real job, prints the legs it
would sign, and stops. Then, with a burner holding ~$15 on Base or Arbitrum:

```bash
AGENT_KEY=0x… pnpm dev            # same run, against YOUR wallet
AGENT_KEY=0x… LIVE=1 pnpm dev     # arm it — real signatures, real money
pnpm dev -- --ask "…" --option 1  # your sentence, your funding route
pnpm test                         # 31 checks against a Pantessa in a box
```

## What a dry run actually prints

Against production, with a wallet that holds nothing — the guard posture, end to
end:

```
wallet    0x741288D2c4244C2111c1465f8ccE6734761fa7c3
desk      https://www.pantessa.com
ask       "Deposit 13 USDC to Hyperliquid, then 2x long $12 of HYPE, then protect my HYPE long with a 5% stop"
mode      DRY — stops before the first broadcast

intent    urcnnhqcr4
record    https://www.pantessa.com/agents/45aa95a24fad1144
layer     hyperliquid (action) via hyperliquid-free, near-intents-mcp-yeetful
holdings  $0.00 movable vs $12.00 asked -> short

consent   signed by 0x7412… — this moves nothing

job       cmudy6v3v0009123dwe8t8dh5 — 4 legs
   0 sign  Deposit 13 USDC to Hyperliquid
   1 wait  Hyperliquid credits the deposit
   2 sign  2x Long $12 of HYPE on Hyperliquid
   3 auto  Arm stop-loss on HYPE (5%)

GUARD REFUSED — "Deposit 13 USDC to Hyperliquid" refused: Wallet holds only
0 USDC on Arbitrum — bridge funds there first (cross-chain swap).
Nothing was signed. The build is fail-closed: a leg it cannot check is a leg
it will not offer.
```

Read the last paragraph again: the desk compiled the whole sequence and then
**refused to produce signable material for leg 0**, because the wallet could not
pay for it. No calldata ever existed. Fund the burner and the same command walks
all four legs.

## The safety posture

- **Pantessa never holds the key.** `AGENT_KEY` stays in this process. Every
  signature — the consent, every leg — is made by `viem`'s local account here.
- **No model writes calldata.** Each leg is built by a deterministic builder on
  the server and passes a fail-closed guard before it is ever offered. A leg the
  guard cannot check is not offered at all.
- **One leg at a time, built at the moment it is offered.** Later legs stay
  unbuilt, so nothing is signed against a stale quote. A chain step carrying a
  deadline is re-quoted server-side immediately before it is signed.
- **The agent's word is not evidence.** Posting a completion advances the job;
  it does not prove anything. The next wait leg verifies arrival on-chain and
  the next build re-checks balances, so a lying agent fails its own job one leg
  later.
- **The desk surface carries no secrets either way.** Negotiation is sentences
  in, sentences out; signable material lives only behind the capability token
  minted when *this* wallet consented.
- **Dry by default, and dry leaves nothing behind.** A dry run closes its intent
  on the way out. `LIVE=1` is the only thing that signs, and it refuses to run
  with a generated key.

## Configuration

| env | meaning |
| --- | --- |
| `AGENT_KEY` | the agent's own private key. Unset = a fresh throwaway, printed once, holding nothing |
| `LIVE=1` | arm it: real signatures, real broadcasts, real money. Refuses a generated key |
| `PANTESSA_BASE` | default `https://www.pantessa.com`; point it at a local `next start` to develop |
| `ASK` | the sentence. Default: the four-leg compound below |
| `AGENT_DESK_KEY` | your desk identity. The desk publishes your track record at `/agents/<sha256 of it>`, so a stable string keeps your record in one place. Defaults to one scoped to the wallet |
| `AGENT_NAME` | the byline the desk shows (default `desk-trader`) |
| `INTERNAL_RUN=1` | Pantessa's own drills only — keeps the run out of the growth numbers |
| `--ask "…"` / `--option N` / `DEBUG=1` | flags: override the sentence, take option N verbatim, print stack traces |

**Exit codes.** `0` whenever the agent behaved — *including* when the desk or
the guard refuses, because a refusal is the product working. Non-zero is
reserved for the agent's own faults: bad config, an unreachable desk, a bug.

## The ask that works, and the one that does not

`broker_execute` compiles **sequenced** flows only. A bare

```
2x long $12 of HYPE on hyperliquid
```

is one step, so the desk refuses it by name — *"does not compile to a multi-step
job (it is a single-step ask)"* — and tells you to negotiate further or hand it
to a human. Try it; it is a useful thirty seconds. The default ask is the
compound that reaches the agent-signed path:

```
Deposit 13 USDC to Hyperliquid, then 2x long $12 of HYPE, then protect my HYPE long with a 5% stop
```

Four legs across two settlement boundaries. That is the shape this example is
about.

## The install (what an agent actually writes)

```ts
import { driveJob } from 'pantessa/desk'

await driveJob({
  base: 'https://www.pantessa.com',
  jobId, token,          // from broker_execute
  signer: account,       // a viem LocalAccount — your key, your process
  onLeg: (leg) => console.log(leg.kind, leg.summary),
  onDone: (seq, result) => console.log('signed leg', seq, result.txHash),
  dryRun: true,          // classify every leg, sign nothing
})
```

The SDK also ships `openAndExecute({ base, ask, signer, agentKey, agent })`,
which does open -> first fundable option -> consent -> execute in one call. This
example does those four steps by hand on purpose: the whole point is to watch
the negotiation happen.

```
src/config.ts   env + flags; the safe defaults live here
src/desk.ts     the desk over MCP — one JSON-RPC POST — and the consent text
src/agent.ts    THE LOOP: scan -> choose -> consent -> execute -> drive
src/main.ts     the CLI shell
tests/          a Pantessa in a box: the desk MCP, the Jobs API, the Hyperliquid
                relay and a toy EVM node, on one port in-process
```
