# coinbase-agent

A Yeetful **x402 payer agent** on the [Coinbase Advanced Trade
API](https://docs.cdp.coinbase.com/advanced-trade). The first agent in
[`agent-examples`](../../README.md), and the mirror of an `x402-services`
payee: a thin app over `@yeetful/agent-kit`.

It does three things:
1. **Shows the portfolio** — account balances valued in USD.
2. **Pays x402 for a market signal** — through its Yeetful expense account
   (allowlist + per-call/per-day USD caps), with a receipt for every call.
3. **Places order-book trades** — limit/market orders against a product's live
   best bid/ask.

## Safe by default
With no env set the agent runs in **dry-run**:
- the portfolio is a representative **sample**,
- the signal is fetched free from Coinbase's public spot endpoint (a `$0`
  pass-through that still proves the expense-account wiring), and
- orders are **previewed, never placed** — you see the exact request body that
  *would* be sent.

Real reads + real order placement require **`LIVE=1`** *and* real CDP keys.

## Run
```bash
pnpm install            # from the repo root
pnpm --filter coinbase-agent dev
# open http://localhost:3000
```

## Going live
Create an Advanced Trade key at
[portal.cdp.coinbase.com](https://portal.cdp.coinbase.com) and set, in `.env`:

```
LIVE=1
COINBASE_API_KEY_NAME=organizations/{org}/apiKeys/{key}
COINBASE_API_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----\n...\n-----END EC PRIVATE KEY-----"
```

Auth is a per-request **ES256 JWT** (120s TTL) signed with the EC key, bound to
the exact `METHOD host path` — minted fresh per call in `lib/coinbase.ts`.

To pay for a *real* signal instead of the free spot feed, point `SIGNAL_URL` at
any x402 endpoint and fund the agent wallet (`PRIVATE_KEY`); the host is added
to the expense-account allowlist automatically. See `.env.example` for all vars.

## Test
```bash
pnpm --filter coinbase-agent test    # JWT shape/verify, order builder, LIVE gate
```

## Files
- `lib/coinbase.ts` — Advanced Trade client (JWT auth, portfolio, best bid/ask, orders).
- `lib/agent.ts` — the payer brain: buys a signal via the expense account, forms a recommendation.
- `lib/config.ts` — env + the `LIVE` / keys gates.
- `app/api/*` — `portfolio`, `signal`, `trade`, `status`.
- `app/page.tsx` — the dashboard.

> The momentum rule is illustrative — **not financial advice.**
