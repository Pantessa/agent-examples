# Stock Desk — a Robinhood Chain portfolio manager with the Pantessa chat embedded

A standalone host app that proves the `pantessa/embed` install end to end.
The page **reads** a wallet's tokenized-stock holdings straight from
Robinhood Chain (4663) and prices them through Uniswap's quoter; every button
on the page is a plain-English ask sent into the embedded Pantessa chat, which
**builds** the guarded transaction on its side and hands the signature to the
visitor's own wallet — on this page, through the host-wallet bridge.

Nothing in this app can move money. The only executable surface is the embed.

```
app/page.tsx                the shell — reads the (public) desk config from env
components/Desk.tsx         the desk: tiles, balance history, activity log, holdings, THE DESK
components/PantessaDesk.tsx THE INSTALL — mountPantessaChat, once, inline, wallet bridged
lib/wallet.ts               EIP-6963 discovery + a switching EIP-1193 provider (one mount, any wallet)
lib/portfolio.ts            chunked Multicall3 balances + QuoterV2 prices; pure aggregation + the prompt grammar
lib/desk-log.ts             the embed's `turn` / `order-signed` events → log lines (pure)
app/api/portfolio/route.ts  GET ?address= → the priced portfolio (server-side, keyless)
tests/                      the maths, the log reducer, and the SDK wire (jsdom) — 13 checks
```

## Run it

```bash
pnpm install                                   # from the repo root
cd agents/robinhood-desk
cp .env.example .env.local                     # optional — everything runs keyless
pnpm dev                                       # http://localhost:3000
```

Open it with a wallet that holds stocks on Robinhood Chain, or watch any
address read-only: `http://localhost:3000/?address=0x…`.

`pnpm test` runs the 13 checks; `pnpm typecheck` and `pnpm build` are the
other two gates.

## The install (what a host actually writes)

```ts
import { mountPantessaChat } from 'pantessa/embed'

const chat = mountPantessaChat({
  container: el,                                  // inline — fills the element
  mcps: ['robinhood-free', 'uniswap-free', 'yeetful-tool-wallet'],
  key: 'yfe_…',                                   // PUBLIC embed key (optional)
  theme: 'light',
  wallet: provider,                               // the page's EIP-1193 provider
  onEvent: (name, data) => log(name, data),       // 'turn' | 'order-signed'
})
chat.sendPrompt('Buy $10 of AAPL on Robinhood Chain')   // any button → an ask
```

Three things this example does that a five-line snippet skips, because real
pages need them:

1. **One mount, any wallet.** `wallet` is captured at mount and users pick a
   wallet *after* the chat is on screen. `lib/wallet.ts` hands the SDK a
   switching provider — a stable facade whose `request` forwards to the
   selected EIP-6963 wallet and which emits `accountsChanged` /
   `chainChanged` itself when the selection changes — so the bridge
   re-announces and the embed auto-connects without a remount (a remount
   drops the conversation).
2. **Land on the right chain.** Connecting also asks the wallet to switch to
   Robinhood Chain (`wallet_switchEthereumChain`, `wallet_addEthereumChain`
   on 4902). The embed will ask to switch anyway when it builds; doing it at
   connect time means the first ask signs in one prompt.
3. **A real CSP.** `next.config.ts` ships `frame-src https://www.pantessa.com`
   so the install is proven against a Content-Security-Policy, not an open
   page. If your app has one, that is the only line the embed needs.

## What the activity log is

Every chat turn emits one `turn` event to the host page
(`{ outcome, artifact?, valueUsd?, txUrl?, chainId? }` — outcomes are
`answered · tx-built · signed · settled · clarify · refused · credit-gate ·
error`), and a signed CoW / Hyperliquid order emits `order-signed`. The log
renders exactly what the embed reported; the "desk gate" tile is the same
events read as a funnel (connect → ask → build → sign) and the money it sums
is the guardrail-priced `valueUsd` of signed turns. Nothing is inferred.

## Config

| var | what |
| --- | --- |
| `NEXT_PUBLIC_PANTESSA_EMBED_KEY` | public `yfe_` key from [/dashboard/keys](https://www.pantessa.com/dashboard/keys). Attributes sessions to your account and bills house answers to your plan. Optional. |
| `NEXT_PUBLIC_PANTESSA_ORIGIN` | leave unset. Point at a local `next start` of the Pantessa site to test embed changes before they deploy. |
| `ROBINHOOD_RPC_URL` | optional RPC override; the public one rate-limits bursts, which is why reads are chunked Multicall3. |
| `NEXT_PUBLIC_WATCH_ADDRESS` | open on a wallet without connecting (`?address=` does the same per visit). |

## Honest limits

- Prices are QuoterV2 quotes for **one whole share** into USDG on the 0.05% /
  0.30% pools — a mark, not a fill. Thin pools show the impact; tokens with no
  USDG pool are listed as *unpriced* rather than counted at zero.
- The balance history is the samples **this browser** took (every 30s while
  the tab is visible, persisted per address in `localStorage`). It is not an
  indexer.
- Robinhood Chain's public RPC returns 429 on bursts and rejects JSON-RPC
  batch envelopes; the reader is sequential and chunked for that reason.
- This page wears no Robinhood branding on purpose: it is a host app that
  *uses* the chain, not a fork of anyone's interface.
