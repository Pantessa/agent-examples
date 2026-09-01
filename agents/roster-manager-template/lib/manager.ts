/**
 * roster-manager-template — a minimal external Roster manager.
 *
 * Built STRICTLY to SECOND-MANAGER-CONTRACT.md (Ideation, 2026-09-01) —
 * public HTTP/MCP surfaces only, no Pantessa internals. The loop:
 *
 *   discover (GET /api/roster/feed)  →  court one listing (broker_open +
 *   slot_token)  →  [the human hires you with their signature — no API to
 *   hire yourself]  →  propose ONE in-mandate, under-cap, $-priced open
 *   with your agent_key  →  poll broker_status  →  read declined/benched/
 *   fired honestly  →  exit.
 *
 * Every fence in §6 is a STOP, not a retry (§7.3). Dry-run by default: the
 * proposal write only happens under LIVE=1; discovery + courting are
 * read-shaped and always run.
 */
import { DeskClient } from './desk'
import { FEED_URL, LIVE, MANAGER_NAME, managerKey, type MandateKind } from './config'

export interface FeedSlot {
  slotToken: string
  kind: MandateKind
  mandate: string
  capUsd: number
  listedAt?: string
}

export interface RunStep {
  label: string
  detail: string
  data?: unknown
}

export interface RunResult {
  mode: 'dry-run' | 'live'
  identity: string
  steps: RunStep[]
  proposed: boolean
  stopped?: string
}

/** §2 — pull the public feed. An empty feed is a valid IDLE state (dark
 *  roster or nothing listed), never an error; a 429 means back off. */
export async function discover(fetchImpl: typeof fetch = fetch): Promise<{ slots: FeedSlot[]; how?: string; rateLimited?: boolean }> {
  const res = await fetchImpl(FEED_URL, { headers: { accept: 'application/json' } })
  if (res.status === 429) return { slots: [], rateLimited: true }
  const body = (await res.json().catch(() => ({}))) as { slots?: FeedSlot[]; how?: string }
  return { slots: Array.isArray(body.slots) ? body.slots : [], how: body.how }
}

/** Pick the newest listing of a preferred kind (default: the manager's own
 *  speciality). Returns null when nothing matches — idle, don't invent work. */
export function pickSlot(slots: FeedSlot[], preferKind?: MandateKind): FeedSlot | null {
  if (slots.length === 0) return null
  if (preferKind) {
    const m = slots.find((s) => s.kind === preferKind)
    if (m) return m
  }
  return slots[0]
}

/**
 * §4 — the client-side cap gate. The contract is emphatic: an over-cap
 * proposal BENCHES the slot instantly (§4, §7.3), so a well-behaved manager
 * refuses BEFORE the server would. Returns the reason string when the ask
 * must not be sent, or null when it is safe.
 */
export function capRefusal(priceUsd: number | null, capUsd: number): string | null {
  if (priceUsd == null) return 'unpriceable money ask — every proposal must state its $ size (§7.2); refusing before the server fail-closes.'
  if (priceUsd > capUsd) return `$${priceUsd} exceeds the slot cap of $${capUsd} — an over-cap open benches the slot (§4); refusing client-side.`
  if (priceUsd <= 0) return 'a proposal must move a positive dollar amount.'
  return null
}

/** Honest classification of a desk refusal string (§5 slot-state reads). */
export function readRefusal(text: string): 'benched' | 'fired' | 'dead-token' | 'other' {
  if (/\bFIRED\b/.test(text)) return 'fired'
  if (/\bBENCHED\b/.test(text)) return 'benched'
  if (/No open listing matches this slot_token/.test(text)) return 'dead-token'
  return 'other'
}

export interface CourtResult {
  ok: boolean
  /** The employer wallet disclosed at engagement (§3) — never from the feed. */
  wallet?: string
  kind?: string
  mandate?: string
  capUsd?: number
  refusal?: string
}

/** §3 — court a listing with broker_open + slot_token. Success returns the
 *  discovery block (which discloses the employer wallet). A dead token is a
 *  re-pull signal, not a retry (§3). */
export async function court(desk: DeskClient, slotToken: string, agentKey: string): Promise<CourtResult> {
  const r = await desk.call('broker_open', {
    ask: 'Introducing myself for this mandate — reviewing the shape before I propose.',
    slot_token: slotToken,
    agent: MANAGER_NAME,
    agent_key: agentKey,
  })
  if (r.isError) return { ok: false, refusal: String(r.payload) }
  const d = r.payload?.discovery
  if (!d) return { ok: false, refusal: 'no discovery block returned — the listing may have changed; re-pull the feed.' }
  return { ok: true, wallet: d.wallet, kind: d.kind, mandate: d.mandate, capUsd: d.capUsd }
}

export interface ProposeResult {
  ok: boolean
  intentId?: string
  url?: string
  inboxUrl?: string
  badge?: unknown
  refusal?: string
  stateRead?: 'benched' | 'fired' | 'dead-token' | 'other'
}

/**
 * §4 — the proposal open (only meaningful once the human has hired this
 * agent_key). One in-mandate, under-cap, $-priced sentence. Client-side cap
 * gate first (§7.3). A refusal is read honestly and NEVER retried.
 */
export async function propose(
  desk: DeskClient,
  args: { wallet: string; ask: string; priceUsd: number | null; capUsd: number; agentKey: string },
): Promise<ProposeResult> {
  const capStop = capRefusal(args.priceUsd, args.capUsd)
  if (capStop) return { ok: false, refusal: capStop }
  const r = await desk.call('broker_open', {
    ask: args.ask,
    wallet: args.wallet,
    agent: MANAGER_NAME,
    agent_key: args.agentKey,
  })
  if (r.isError) return { ok: false, refusal: String(r.payload), stateRead: readRefusal(String(r.payload)) }
  const roster = r.payload?.roster
  if (!roster) {
    // No slot binding: this agent_key isn't hired for this wallet yet.
    return { ok: false, refusal: 'no roster binding — this identity is not hired for that wallet (the human hires with their signature).' }
  }
  return { ok: true, intentId: r.payload.intentId, url: roster.url, inboxUrl: roster.inboxUrl, badge: roster.badge }
}

/** §5 — poll broker_status. States only move forward; stop on any terminal
 *  read. Bounded polls, ≤1/min in real use (here: a bounded loop for a drive). */
export async function pollStatus(desk: DeskClient, intentId: string, tries = 3): Promise<{ state: string; valueUsd?: number }> {
  let last = { state: 'unknown' as string, valueUsd: undefined as number | undefined }
  for (let i = 0; i < tries; i++) {
    const r = await desk.call('broker_status', { intent_id: intentId })
    if (!r.isError && r.payload?.state) {
      last = { state: r.payload.state, valueUsd: r.payload.valueUsd }
      if (['signed', 'settled', 'declined', 'closed'].includes(last.state)) break
    }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, 400))
  }
  return last
}

/**
 * The whole loop, as a drive. Discovery + courting always run (read-shaped);
 * the proposal open only fires under LIVE=1 (dry-run default surfaces what it
 * WOULD send). Every stop is honest and terminal.
 */
export async function run(opts?: { preferKind?: MandateKind; fetchImpl?: typeof fetch }): Promise<RunResult> {
  const steps: RunStep[] = []
  const key = managerKey()
  const desk = new DeskClient(!LIVE) // dry-run drills stamp internal (§7.7)
  await desk.init()

  const { slots, how, rateLimited } = await discover(opts?.fetchImpl)
  if (rateLimited) return { mode: LIVE ? 'live' : 'dry-run', identity: key, steps, proposed: false, stopped: 'feed 429 — backing off for the hour (§6).' }
  steps.push({ label: 'discover', detail: `${slots.length} listed slot(s)`, data: { how } })
  if (slots.length === 0) return { mode: LIVE ? 'live' : 'dry-run', identity: key, steps, proposed: false, stopped: 'empty feed — idle (a valid state, §2).' }

  const slot = pickSlot(slots, opts?.preferKind)
  if (!slot) return { mode: LIVE ? 'live' : 'dry-run', identity: key, steps, proposed: false, stopped: 'no matching kind — idle.' }
  steps.push({ label: 'pick', detail: `${slot.kind} · "${slot.mandate}" · $${slot.capUsd} cap`, data: slot })

  const courted = await court(desk, slot.slotToken, key)
  if (!courted.ok) return { mode: LIVE ? 'live' : 'dry-run', identity: key, steps, proposed: false, stopped: `courting refused: ${courted.refusal}` }
  steps.push({ label: 'court', detail: `engaged — employer disclosed, cap $${courted.capUsd}`, data: { wallet: courted.wallet, kind: courted.kind } })

  // The human hires with their signature — there is no API to hire yourself
  // (§3). A propose-only manager stops here until it holds a hire; the drive
  // harness performs the manual hire and then calls propose() directly.
  steps.push({ label: 'await-hire', detail: 'hiring is the human\'s signature — the template does not self-hire (§3).' })
  return { mode: LIVE ? 'live' : 'dry-run', identity: key, steps, proposed: false }
}
