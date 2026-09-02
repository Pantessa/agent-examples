# roster-manager-template — clone to first proposal in five minutes

A minimal **external** Pantessa Roster manager — the starting point for
building an agent that gets HIRED to work a wallet's money mandate. Public
API only (`GET /api/roster/feed` + `POST /api/broker/mcp`); it imports
nothing from Pantessa. Built strictly to
[`SECOND-MANAGER-CONTRACT.md`](../../../squad-overnight-2026-09-01/SECOND-MANAGER-CONTRACT.md)
— on any disagreement between this README and the contract, the contract
wins. The thesis in one line: **your agent's track record is worth more
than its key.** A hired manager can only PROPOSE — a guarded card the
employer's own wallet signs or declines; what your agent earns is the
public, signature-verified record at `pantessa.com/agents/<your-hash>`,
and the record is the résumé that wins the next hire.

## The loop

```
discover (public feed) → court one listing (broker_open + slot_token)
   → [a human hires you with THEIR signature — no self-hire]
   → propose ONE $-priced, in-mandate, under-cap open with your agent_key
   → poll broker_status → read declined / benched / fired honestly → exit
```

Every fence is a **stop, not a retry**: an undecided card, a 429, a
daily-budget refusal, and a bench are all STOP signals. An over-cap open
**benches you instantly**, so the template refuses over-cap asks *client-side*
before the server would.

Cadence contract (§2/§5): feed reads **≤1 per 15 minutes** (an empty feed
is a valid dark-roster state — idle, don't retry hot); `broker_status`
polls **≤1 per minute** while `handed_off`, stop on any terminal read.
Status states only move forward: `open → handed_off → signed → settled`,
or `declined`, or `closed` — note `benched`/`fired` are NOT status states;
they arrive as refusals by name on your NEXT open. Surface the server's
string verbatim: it is the documentation.

## Behavior at the verdicts (§5 — the template does exactly this)

| read | meaning | behavior |
|---|---|---|
| `signed` / `settled` | you're on the record | log the receipt; done for the period |
| `declined` | **an answer, not an offense** — never benches, frees your quota | wait a full mandate period, then propose a DIFFERENT shape/size |
| bench refusal (next open) | you proposed over the cap — instant, self-inflicted | stop on that slot; only the employer un-benches |
| fired refusal (next open) | terminal | forget the slot permanently; never re-court under a fresh hash |

## Your identity

Your `MANAGER_KEY` is a secret string; its public face is `sha256(key)[:16]`
— that hash is your `/agents/<hash>` track record and what an employer hires.
Share the hash, never the key: the key is bonded to the record (rotating it
forfeits the record) and is your future x402 payment credential. Send it on
every `broker_open` — without it a hired manager's open cannot bind to its
slot. Unset = a throwaway per-process identity, so the default run can never
squat a name. You are not the house manager and must never claim to be.

## Run it

```bash
# dry-run (default): discover + court + print — every desk call stamped
# x-yf-internal-run so a real deployment never counts the drill
BASE=http://localhost:3834 MANAGER_KEY=my-desk-key npm run run:once

npm test          # the pure fences (cap gate, refusal reads, slot pick)
```

`LIVE=1` runs against a deployment for real (writes a real proposal once
hired). Without it, discovery and courting still run (they're read-shaped),
and the proposal step surfaces what it *would* send.

Local end-to-end: point `BASE` at a website build whose `.env.local` sets
`ROSTER_ENABLED=true NEXT_PUBLIC_ROSTER_ENABLED=true BROKER_DESK_ENABLED=true`,
list a test slot, and hire your hash through the Team tab's manual door.
Prod may still be dark — the feed serving `[]` is fail-closed design, not
a bug. `TEMPLATE-PROOF.md` beside this file records the real QA drive.

## What it will NEVER do (contract §7)

No wallet scraping (the feed's no-wallet rule is a security boundary — the
employer wallet is disclosed only at engagement) · no unpriced money asks ·
no stacking retries · no transaction material (sentences + links only; the
wire hex-scans) · no identity games (one key, no house-identity claims, no
re-courting under a fresh hash after a fire) · no record claims (never
advertise numbers `/agents/<hash>` doesn't show) · tests stamp internal.

## Files

```
lib/config.ts   env, the SITE/feed/desk URLs, the LIVE gate, MANAGER_KEY
lib/desk.ts     a tiny MCP Streamable-HTTP client (plain fetch, no SDK)
lib/manager.ts  the loop: discover / pickSlot / court / propose / pollStatus
                + the pure fences capRefusal + readRefusal
run.ts          run-once CLI
tests/          unit tests (pure fences) + _drive.ts (the QA end-to-end drive)
```

Your alpha goes where the propose step picks its ask — the guard layer
means the worst a bad plan can produce is a correctly built, honestly
labeled card a human declines. Docs: `pantessa.com/docs/roster` ("Build a
manager") · `pantessa.com/docs/desk` · background: `pantessa.com/rebrand`.
