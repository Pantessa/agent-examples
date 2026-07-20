# agent-examples

Yeetful's fleet of **x402 _payer_ agents** — the mirror image of
[`x402-services`](../x402-services) (the payees). One repo, many thin agents,
each with a Yeetful **expense account**: an allowlist of payable hosts plus
per-call / per-day USD caps, with a receipt for every decision (settlement or
denial). Agents pay per call in USDC on Base — no API keys to the data they buy.

```
packages/agent-kit/      shared payer plumbing: viem wallet from env + the yeetful() expense account + receipt log
agents/coinbase/         a Coinbase trading agent → reads its portfolio, places order-book trades,
                         and pays x402 for the market signal it trades on   → next.js app
agents/lazy-trader/      an agent with funds on the WRONG chain → pays x402 for Yeetful's
                         fund_and_build runbook, signs each cross-chain leg with its own key,
                         completes the goal (dry-run by default)            → next.js app
```

> `x402-services` owns the *payment gate* (a service is a thin adapter over
> `@yeetful/x402-service-kit`). This repo owns the *payer* — an agent is a thin
> adapter over `@yeetful/agent-kit`, which wraps the published [`yeetful`](https://www.npmjs.com/package/yeetful)
> SDK's `yeetful({ wallet, grant })` expense account so the spend-control wiring
> is one place, not N agents.

## The shared kit (`@yeetful/agent-kit`)
An agent is a thin adapter; the kit provides:
- `loadAgentWallet()` — a viem `WalletClient` on Base from `PRIVATE_KEY`, or a
  throwaway key when none is set (so the default run is free and safe).
- `createExpenseAccount({ allow, perCallUsd, perDayUsd, ... })` — the
  `yeetful()` grant-aware paid `fetch`, pre-wired with env (`YEETFUL_API_KEY`,
  `YEETFUL_GRANT_ID`, `YEETFUL_LEDGER_URL`) and a receipt log you can read back.
- `isLive()` — the single `LIVE=1` gate every agent reads before it spends real
  USDC or places a real order.

## The first agent (`agents/coinbase`)
A Coinbase trading agent built on the Advanced Trade API:
- **Shows the portfolio** — account balances + USD value.
- **Places trades in order books** — limit/market orders against a product's
  live best bid/ask.
- **Pays x402 for its edge** — before trading it buys a market signal through
  the expense account (allowlist-gated, receipted), demonstrating the payer side
  of Yeetful end-to-end.

**Safe by default.** With no keys it runs in **dry-run**: it previews orders
and shows a sample portfolio, and spends nothing. Real reads/orders require
`LIVE=1` + real CDP keys. See `agents/coinbase/README.md`.

## Adding an agent (one repo → many Vercel projects)
Same model as `x402-services`: a Vercel **Project** points at a folder inside
this repo. Set **Root Directory** to `agents/<name>`; Vercel installs the whole
workspace (so `@yeetful/agent-kit` resolves) and builds just that app. Each
agent gets its own env vars and domain. Turborepo skips rebuilding unchanged
projects.

## Local dev
```bash
pnpm install
pnpm --filter coinbase-agent dev      # or: cd agents/coinbase && pnpm dev
pnpm typecheck                         # whole workspace
pnpm --filter coinbase-agent test      # JWT + order-builder unit tests
```
Copy `agents/<name>/.env.example` → `.env` and fill it in. `.env` is gitignored
— never commit real keys.
