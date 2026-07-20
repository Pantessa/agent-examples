# lazy-trader — funds on the wrong chain, goals on the right one

The demo thesis in one line: **your agent has $5 somewhere; Yeetful makes that
spendable everywhere.** Every agent framework can hold a key and sign. Almost
none can quote, route, gas-plan, and sequence a cross-chain move. That gap is
exactly what this agent *buys* instead of builds:

1. **Scan** — `scan_funding_sources` on Yeetful's funding MCP: where the
   movable ETH + USDC actually sits (Base / Arbitrum / Ethereum).
2. **Buy the hard part** — ONE x402 call to `fund_and_build` on the **paid
   door** (`/paid/mcp`, $0.02, paid through the agent's expense account,
   receipted): back comes a numbered runbook of exact NEAR Intents tool calls.
3. **Follow the runbook** — for each leg: `build_swap` (the deposit address
   comes from the tool, never invented) → sign the one transfer with the
   agent's OWN key → `submit_deposit_tx` → `await_completion`.
4. **Prove it** — a fresh scan shows the goal balance actually landed, then the
   runbook's final step hands off to whatever the funding was *for*.

Yeetful never holds the key, never signs, never takes custody — it sells the
*plan*. If a leg can't fill, the deposit refunds automatically to the agent's
own address; funds are never stranded mid-bridge.

## Safe by default

With nothing set, `pnpm dev` runs **dry-run**: free door, plans for a demo
address with real (small) holdings, every leg's deposit transaction is built —
and nothing is ever signed.

| env | meaning |
| --- | --- |
| `LIVE=1` | arm it: pay the x402 door, sign the legs |
| `PRIVATE_KEY` | the agent's burner (funded with a few USDC on any covered chain) |
| `FUNDING_MCP_URL` | default `https://funding-mcp.yeetful.com` (point at localhost while it's undeployed) |
| `NEAR_INTENTS_MCP_URL` | default `https://near-intents.yeetful.com` |
| `DEMO_ADDRESS` | dry-run scan target (default: the Yeetful house wallet) |
| `FUNDING_MAX_USD` / `FUNDING_DAY_USD` | expense-account caps (default $0.05 / $1) |

## Why the paid door, when the free door serves the same tools?

Because that's the point of the demo. In dry-run the agent rides the free
rate-limited door — same tools, $0. In LIVE it pays $0.02/call over x402
through its expense account (allowlist + caps + receipts). Payment buys the
un-throttled door, not different capability — and the receipt strip at the
bottom of the run log is the payer story told end-to-end: the agent funded its
own orchestration with the same wallet it trades with.

## Run it

```bash
pnpm install
pnpm --filter lazy-trader-agent dev   # dry-run, http://localhost:3000
pnpm --filter lazy-trader-agent test  # offline unit tests (mocked MCPs)
```

Give it a goal like *"hold 2 USDC on Arbitrum, then supply it to Aave"* and
watch the step log: scan → shortfall → runbook → legs → (dry-run stops here) →
handoff.
