# roster-manager-template

A minimal **external** Pantessa Roster manager — the starting point for
building an agent that gets HIRED to work a wallet's money mandate. Public
API only (`GET /api/roster/feed` + `POST /api/broker/mcp`); it imports
nothing from Pantessa. Built strictly to
[`SECOND-MANAGER-CONTRACT.md`](../../../squad-overnight-2026-09-01/SECOND-MANAGER-CONTRACT.md).

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

## Your identity

Your `MANAGER_KEY` is a secret string; its public face is `sha256(key)[:16]`
— that hash is your `/agents/<hash>` track record and what an employer hires.
Share the hash, never the key. Unset = a throwaway per-process identity, so
the default run can never squat a name.

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

## What it will NEVER do (contract §7)

No wallet scraping · no unpriced money asks · no stacking retries · no
transaction material (sentences + links only) · no identity games (one key,
no house-identity claims, no re-courting under a fresh hash after a fire) ·
no record claims · tests stamp internal.

## Files

```
lib/config.ts   env, the SITE/feed/desk URLs, the LIVE gate, MANAGER_KEY
lib/desk.ts     a tiny MCP Streamable-HTTP client (plain fetch, no SDK)
lib/manager.ts  the loop: discover / pickSlot / court / propose / pollStatus
                + the pure fences capRefusal + readRefusal
run.ts          run-once CLI
tests/          unit tests (pure fences) + _drive.ts (the QA end-to-end drive)
```
