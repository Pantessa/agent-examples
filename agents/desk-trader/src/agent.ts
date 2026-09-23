/**
 * THE LOOP — an agent with its own key getting a leveraged position opened
 * through the Pantessa agent desk, and nothing else.
 *
 *   scan   broker_open      the desk reads the wallet across every chain and
 *                           says which guarded layer claims the ask
 *   choose broker_choose    a funding route, if the wallet is short — every
 *                           option is a sentence, so choosing just rewrites
 *                           the working ask
 *   consent personal_sign   proves the wallet before a job exists in its rail
 *   execute broker_execute  the ask compiles to a multi-leg job owned by the
 *                           agent's wallet + a capability token to drive it
 *   drive  driveJob         poll -> the runner builds THIS leg fresh (guarded,
 *                           policy-checked) -> sign with our own key ->
 *                           broadcast -> complete -> the wait leg verifies
 *                           arrival on-chain -> the next leg builds
 *
 * Round-trip across every settlement boundary, batched within one. Pantessa
 * never holds the key, never signs, and never sees a private key: it sells the
 * sequencing and the guards.
 */
import { driveJob, type DeskLegView, type DeskLegResult } from 'pantessa/desk'
import type { PrivateKeyAccount } from 'viem/accounts'
import { Desk, DeskRefusal, deskExecuteConsentMessage, looksLikeConsentMismatch, tokenFromDriveUrl, type BrokerOption, type BrokerPlan } from './desk.js'

export interface RunOptions {
  account: PrivateKeyAccount
  base: string
  ask: string
  agentKey: string
  agentName: string
  live: boolean
  optionIndex: number | null
  internalRun: boolean
  fetchImpl?: typeof fetch
  /** `{ chainId: rpcUrl }` — the SDK defaults to each chain's canonical node. */
  rpc?: Record<number, string>
  /** Injected in tests; defaults to the published SDK helper. */
  drive?: typeof driveJob
  log?: (line: string) => void
}

export type RunOutcome =
  | { kind: 'refused'; where: 'desk'; why: string; intentId?: string }
  | { kind: 'refused'; where: 'guard'; why: string; intentId: string; jobId: string }
  | { kind: 'withheld'; why: string; seq: number; intentId: string; jobId: string }
  | { kind: 'dry'; intentId: string; jobId: string; legs: DeskLegView[] }
  | { kind: 'done'; intentId: string; jobId: string; legs: DeskLegView[]; signed: number }
  | { kind: 'stopped'; intentId: string; jobId: string; status: string; why: string | null }

/** Pick the route to take. Default: the first real funding route the desk
 *  offers, because a wallet short of the ask cannot proceed without one;
 *  otherwise "proceed as asked". `--option N` takes option N verbatim, and
 *  never silently falls back — an agent told to take a route it cannot see
 *  should stop, not improvise. */
export function pickOption(plan: BrokerPlan, index: number | null): BrokerOption {
  if (index != null) {
    const chosen = plan.options[index]
    if (!chosen) throw new Error(`--option ${index} is out of range (the desk offered ${plan.options.length}).`)
    return chosen
  }
  return plan.options.find((o) => o.kind === 'funding') ?? plan.options.find((o) => o.id === 'proceed') ?? plan.options[0]
}

const money = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`)

export async function runDeskTrader(opts: RunOptions): Promise<RunOutcome> {
  const say = opts.log ?? ((l: string) => console.log(l))
  const drive = opts.drive ?? driveJob
  const desk = new Desk({ base: opts.base, internalRun: opts.internalRun, fetchImpl: opts.fetchImpl })
  const wallet = opts.account.address

  // ── (a) scan ────────────────────────────────────────────────────────────
  say(`wallet    ${wallet}`)
  say(`desk      ${desk.base}`)
  say(`ask       "${opts.ask}"`)
  say(`mode      ${opts.live ? 'LIVE — this signs and broadcasts' : 'DRY — stops before the first broadcast'}\n`)

  let open
  try {
    open = await desk.open({ ask: opts.ask, wallet, agent: opts.agentName, agent_key: opts.agentKey })
  } catch (e) {
    if (e instanceof DeskRefusal) return refusal(say, e.message)
    throw e
  }
  const f = open.plan.quote.funding
  say(`intent    ${open.intentId}${open.recordUrl ? `\nrecord    ${open.recordUrl}` : ''}`)
  say(`layer     ${open.plan.quote.gate} (${open.plan.quote.kind}) via ${open.plan.quote.mcps.join(', ') || 'no dapps'}`)
  say(`holdings  ${f ? `${money(f.movableUsd)} movable vs ${money(f.askUsd)} asked -> ${f.verdict}${f.strandedUsd ? ` (${money(f.strandedUsd)} stranded without gas)` : ''}` : 'not scanned (the ask names no dollar amount)'}`)
  say(`\n${open.plan.say}\n`)
  say('options')
  open.plan.options.forEach((o, i) => say(`  [${i}] ${o.id.padEnd(10)} ${o.label}\n       -> "${o.resume}"`))

  // ── (b) choose ──────────────────────────────────────────────────────────
  const chosen = pickOption(open.plan, opts.optionIndex)
  say(`\nchoosing  ${chosen.id} — ${chosen.label}`)
  if (chosen.kind === 'decline') return { kind: 'stopped', intentId: open.intentId, jobId: '', status: 'declined', why: 'the chosen option walks away' }
  let plan = open.plan
  if (chosen.id !== 'proceed') {
    try {
      plan = (await desk.choose(open.intentId, chosen.id)).plan
    } catch (e) {
      if (e instanceof DeskRefusal) return refusal(say, e.message, open.intentId)
      throw e
    }
    say(`working   "${plan.ask}"`)
  }

  // ── (c) consent ─────────────────────────────────────────────────────────
  // Free (personal_sign costs no gas, so even an empty wallet can do it) and
  // it authorizes nothing but the compile — read the text, it says so. The
  // instant goes INTO the text and travels beside the signature, so a consent
  // captured today cannot be replayed tomorrow.
  const issuedAt = new Date().toISOString()
  const message = deskExecuteConsentMessage(open.intentId, wallet, issuedAt)
  const walletSignature = await opts.account.signMessage({ message })
  say(`\nconsent   signed by ${wallet} at ${issuedAt} (${walletSignature.slice(0, 12)}…) — this moves nothing`)

  // ── (d) execute ─────────────────────────────────────────────────────────
  let ex
  try {
    ex = await desk.execute(open.intentId, walletSignature, { issuedAt, agentKey: opts.agentKey })
  } catch (e) {
    if (!(e instanceof DeskRefusal)) throw e
    // A desk that predates the replay window rebuilds a FOUR-line text, so our
    // signature recovers to somebody else. We do not re-sign without the
    // window to please it — we say which end is old and stop.
    if (looksLikeConsentMismatch(e.message)) {
      say('\nnote      this desk rebuilt a different consent text — it predates the replay window (website#851).')
      say('          Point PANTESSA_BASE at a deployment that has it; the agent will not sign a weaker consent.')
    }
    return refusal(say, e.message, open.intentId)
  }
  const token = tokenFromDriveUrl(ex.drive.poll)
  say(`\njob       ${ex.jobId} — ${ex.steps.length} legs`)
  for (const s of ex.steps) say(`  ${String(s.seq).padStart(2)} ${s.kind.padEnd(5)} ${s.note}`)

  // ── (e) drive ───────────────────────────────────────────────────────────
  say(`\ndriving   ${opts.live ? 'signing each leg as the runner offers it' : 'dry — printing the legs, signing none'}`)
  const legs: DeskLegView[] = []
  let signed = 0
  const result = await drive({
    base: opts.base,
    jobId: ex.jobId,
    token,
    signer: opts.account,
    dryRun: !opts.live,
    rpc: opts.rpc,
    fetch: opts.fetchImpl,
    headers: opts.internalRun ? { 'x-yf-internal-run': '1' } : undefined,
    onLeg: (view: DeskLegView) => {
      legs.push(view)
      say(`\n  leg ${view.seq} [${view.kind}] ${view.summary || '(no summary)'}`)
      say(`    chain ${view.chainId ?? '—'}   value ${money(view.valueUsd)}${view.staleAfterMs != null ? `   re-fetch within ${Math.round(view.staleAfterMs / 1000)}s` : ''}`)
      say(`    ${opts.live ? 'signing with our own key' : 'WOULD sign: ' + Object.keys(view.artifact ?? {}).join(' + ')}`)
    },
    // Nothing to sign yet: a wait leg settling, the runner still building, or
    // a step the runner WITHHELD because the wallet cannot fund it. The last
    // one is the honest refusal that matters most, so say it out loud.
    onWaiting: (note: { seq: number; status: string; title: string; withheld?: string }) => {
      say(note.withheld ? `  leg ${note.seq} withheld — ${note.withheld}` : `  leg ${note.seq} ${note.status} — ${note.title}`)
    },
    onDone: (seq: number, res: DeskLegResult) => {
      signed += 1
      say(`  leg ${seq} done — ${res.txHash ?? (res.batch ? `${res.batch.filter((b) => b.ok).length}/${res.batch.length} actions` : 'venue accepted')}`)
    },
  })

  // The desk's own summary of what the runner made of it. A failed leg's
  // reason is the guard talking, and that is worth reading out loud.
  // WITHHELD is not a failure: the runner built nothing because the wallet
  // cannot pay for this leg yet, and the job stays live — the step is offered
  // the moment the money lands.
  if (result.withheld) {
    say(`\nWITHHELD at leg ${result.withheld.seq} — ${result.withheld.reason}`)
    say('Nothing was signed, and the job is still live: fund the wallet and it picks up where it stopped.')
    if (!opts.live) await closeQuietly(desk, open.intentId, say)
    return { kind: 'withheld', why: result.withheld.reason, seq: result.withheld.seq, intentId: open.intentId, jobId: ex.jobId }
  }
  if (result.status === 'failed') {
    say(`\nGUARD REFUSED — ${result.failReason ?? 'the runner failed the job'}`)
    say('Nothing was signed. The build is fail-closed: a leg it cannot check is a leg it will not offer.')
    await closeQuietly(desk, open.intentId, say)
    return { kind: 'refused', where: 'guard', why: result.failReason ?? 'the runner failed the job', intentId: open.intentId, jobId: ex.jobId }
  }
  if (!opts.live) {
    say(`\nDRY RUN COMPLETE — ${legs.length} leg${legs.length === 1 ? '' : 's'} seen, 0 signed, 0 broadcast.`)
    say('Set LIVE=1 with a funded key to actually do this.')
    await closeQuietly(desk, open.intentId, say)
    return { kind: 'dry', intentId: open.intentId, jobId: ex.jobId, legs }
  }
  if (result.status === 'done') {
    say(`\nDONE — ${signed} leg${signed === 1 ? '' : 's'} signed by ${wallet}. Position open.`)
    return { kind: 'done', intentId: open.intentId, jobId: ex.jobId, legs, signed }
  }
  say(`\nSTOPPED at status "${result.status}"${result.failReason ? ` — ${result.failReason}` : ''}`)
  return { kind: 'stopped', intentId: open.intentId, jobId: ex.jobId, status: result.status, why: result.failReason ?? null }
}

function refusal(say: (l: string) => void, why: string, intentId?: string): RunOutcome {
  say(`\nDESK REFUSED — ${why}`)
  return { kind: 'refused', where: 'desk', why, intentId }
}

/** A dry run leaves nothing behind: closing revokes the intent (and cancels
 *  the job it compiled). A LIVE run keeps it — that is the position. */
async function closeQuietly(desk: Desk, intentId: string, say: (l: string) => void): Promise<void> {
  try {
    await desk.close(intentId)
    say(`closed    ${intentId} — the dry run leaves nothing behind`)
  } catch {
    say(`closed    ${intentId} could not be closed; it expires on its own`)
  }
}
