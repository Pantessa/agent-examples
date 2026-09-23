import { describe, it, expect, afterEach } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { runDeskTrader } from '../src/agent'
import { startMockDesk, type MockDesk, type MockScenario, type MockStep } from './mock-desk'

const ACCOUNT = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const ASK = 'Deposit 13 USDC to Hyperliquid, then 2x long $12 of HYPE'

let mock: MockDesk | null = null
afterEach(async () => {
  await mock?.close()
  mock = null
})

/** The 3-leg flagship, as the runner serves it: an EVM deposit, the wait for
 *  Hyperliquid to credit it, then the leveraged order. Artifact keys are the
 *  real ones — `txRequest`, not `tx`. */
function flagshipSteps(): MockStep[] {
  return [
    {
      seq: 0,
      kind: 'sign',
      status: 'pending',
      builder: 'native-hl-exec',
      title: 'Deposit 13 USDC to Hyperliquid',
      valueUsd: 13,
      artifact: {
        summary: 'Deposit 13 USDC to Hyperliquid',
        txRequest: { to: '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7', data: '0xa9059cbb', value: '0x0', chainId: 42161 },
      },
    },
    { seq: 1, kind: 'wait', status: 'pending', builder: 'wait', title: 'Hyperliquid credits the deposit', valueUsd: null, artifact: null },
    {
      seq: 2,
      kind: 'sign',
      status: 'pending',
      builder: 'native-hl-exec',
      title: '2x Long $12 of HYPE on Hyperliquid',
      valueUsd: 12,
      artifact: {
        summary: '2x Long $12 of HYPE on Hyperliquid',
        orderRequest: {
          protocol: 'hyperliquid',
          typedData: hlTypedData(1_700_000_000_000),
          hl: { action: { type: 'order', orders: [] }, nonce: 1_700_000_000_000, expected: { coin: 'HYPE', kind: 'long', isBuy: true } },
        },
      },
    },
  ]
}

function hlTypedData(nonce: number) {
  return {
    domain: { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: '0x0000000000000000000000000000000000000000' },
    types: { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
    primaryType: 'Agent',
    message: { source: 'a', connectionId: `0x${nonce.toString(16).padStart(64, '0')}` },
  }
}

function scenario(over: Partial<MockScenario> = {}): MockScenario {
  return {
    fundingVerdict: 'short',
    movableUsd: 0,
    askUsd: 12,
    fundingOptions: [],
    executeRefusal: null,
    steps: flagshipSteps(),
    ...over,
  }
}

/** A driver that does everything the SDK's driveJob does EXCEPT sign: it polls
 *  the real mock Jobs API with the token the example handed it and posts real
 *  completions. It proves the example's plumbing (base + jobId + token +
 *  callbacks). The signing itself is proven against the published SDK in
 *  tests/drive.test.ts. */
function recordingDrive(opts: { signEach?: boolean } = {}) {
  const seen: Array<{ base: string; jobId: string; token: string }> = []
  const fn = async (o: Record<string, unknown>): Promise<Record<string, unknown>> => {
    seen.push({ base: String(o.base), jobId: String(o.jobId), token: String(o.token) })
    const legs: unknown[] = []
    const results: unknown[] = []
    for (;;) {
      const res = await fetch(`${o.base}/api/jobs/${o.jobId}?t=${encodeURIComponent(String(o.token))}`)
      const { job } = (await res.json()) as { job: { status: string; currentStep: number; failReason?: string; steps: MockStep[] } }
      const step = job.steps.find((s) => s.seq === job.currentStep)
      if (step && step.status === 'offered' && step.artifact) {
        const view = { seq: step.seq, kind: step.artifact.txRequest ? 'tx' : 'hlAction', summary: step.title, artifact: step.artifact, chainId: null, valueUsd: step.valueUsd, staleAfterMs: null }
        legs.push(view)
        await (o.onLeg as ((v: unknown) => Promise<void>) | undefined)?.(view)
        if (o.dryRun || !opts.signEach) return { jobId: o.jobId, status: 'dry', legs, results }
        const result = { txHash: `0x${'ab'.repeat(32)}`, chainId: 42161 }
        await fetch(`${o.base}/api/jobs/${o.jobId}/complete?t=${encodeURIComponent(String(o.token))}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ seq: step.seq, result }),
        })
        results.push({ seq: step.seq, result })
        await (o.onDone as ((s: number, r: unknown) => Promise<void>) | undefined)?.(step.seq, result)
        continue
      }
      if (job.status === 'failed') return { jobId: o.jobId, status: 'failed', legs, results, failReason: job.failReason }
      if (job.status === 'done') return { jobId: o.jobId, status: 'done', legs, results }
      return { jobId: o.jobId, status: job.status, legs, results }
    }
  }
  return { fn: fn as never, seen }
}

async function run(sc: MockScenario, over: Partial<Parameters<typeof runDeskTrader>[0]> = {}) {
  mock = await startMockDesk(sc, ACCOUNT.address.toLowerCase())
  const lines: string[] = []
  const drive = recordingDrive({ signEach: over.live === true })
  const outcome = await runDeskTrader({
    account: ACCOUNT,
    base: mock.url,
    ask: ASK,
    agentKey: 'desk-trader-test',
    agentName: 'desk-trader',
    live: false,
    optionIndex: null,
    internalRun: true,
    log: (l) => lines.push(l),
    drive: drive.fn,
    ...over,
  })
  return { outcome, lines, out: lines.join('\n'), drive, mock: mock! }
}

describe('the whole loop, against a Pantessa in a box', () => {
  it('opens, consents with its own key, compiles a job, and signs nothing in dry mode', async () => {
    const { outcome, out, drive, mock: m } = await run(scenario())

    expect(m.calls.map((c) => c.tool)).toEqual(['broker_open', 'broker_execute', 'broker_close'])
    // The desk recovered OUR address out of OUR signature over ITS text.
    expect(m.consentSigner).toBe(ACCOUNT.address.toLowerCase())
    // The example handed the drive exactly what broker_execute gave it —
    // including the capability token it had to dig out of the drive URL.
    expect(drive.seen).toHaveLength(1)
    expect(drive.seen[0]!.jobId).toBe('mockjob00000')
    expect(drive.seen[0]!.token).toBe('mock-capability-token')
    // Nothing signed, nothing broadcast, nothing completed.
    expect(m.completes).toEqual([])
    expect(m.broadcasts).toEqual([])
    expect(m.hlSubmits).toEqual([])
    expect(outcome.kind).toBe('dry')
    expect(out).toContain('DRY RUN COMPLETE')
    expect(out).toContain('WOULD sign')
    // A dry run tidies up after itself — and walking away proves identity too,
    // so the close carries the same agent_key the open did (website#854).
    expect(m.calls.at(-1)!.tool).toBe('broker_close')
    expect(m.calls.at(-1)!.args.agent_key).toBe('desk-trader-test')
    expect(out).toContain('leaves nothing behind')
    expect(out).not.toContain('could not be closed')
  })

  it('takes the funding route the desk offers, and re-quotes on the rewritten sentence', async () => {
    const funding = { id: 'fund-1', label: 'Just enough (~$14)', resume: 'Fund hyperliquid with $14 from base, then ' + ASK }
    const { outcome, out, mock: m } = await run(scenario({ fundingOptions: [funding] }))

    expect(m.calls.map((c) => c.tool)).toEqual(['broker_open', 'broker_choose', 'broker_execute', 'broker_close'])
    expect(m.calls[1]!.args.option_id).toBe('fund-1')
    expect(out).toContain('choosing  fund-1')
    expect(out).toContain(funding.resume)
    expect(outcome.kind).toBe('dry')
  })

  it('reads out the desk\'s refusal instead of improvising, and leaves no job behind', async () => {
    const why = '"2x long $12 of HYPE on hyperliquid" does not compile to a multi-step job (it is a single-step ask).'
    const { outcome, out, mock: m } = await run(scenario({ executeRefusal: why }))

    // It still consented — the refusal comes AFTER the desk proved the wallet.
    expect(m.consentSigner).toBe(ACCOUNT.address.toLowerCase())
    expect(outcome).toMatchObject({ kind: 'refused', where: 'desk' })
    expect(out).toContain('DESK REFUSED')
    expect(out).toContain('single-step ask')
    expect(m.completes).toEqual([])
  })

  it('reads out the GUARD\'s refusal when a leg will not build', async () => {
    const reason = '"Deposit 13 USDC to Hyperliquid" refused: Wallet holds only 0 USDC on Arbitrum — bridge funds there first.'
    const { outcome, out } = await run(scenario({ failAt: { seq: 0, reason } }))

    expect(outcome).toMatchObject({ kind: 'refused', where: 'guard' })
    expect(out).toContain('GUARD REFUSED')
    expect(out).toContain('bridge funds there first')
    expect(out).toContain('Nothing was signed')
  })

  it('drives every leg to done when armed, and keeps the intent open', async () => {
    const { outcome, out, mock: m } = await run(scenario(), { live: true })

    expect(outcome).toMatchObject({ kind: 'done', signed: 2 })
    // The wait leg is the runner's, not the agent's: two signatures, three legs.
    expect(m.completes.map((c) => c.seq)).toEqual([0, 2])
    expect(out).toContain('DONE')
    // A live run leaves the position alone.
    expect(m.calls.map((c) => c.tool)).not.toContain('broker_close')
  })

  it('binds the consent to an instant, and presents the identity it opened with', async () => {
    const { outcome, out, mock: m } = await run(scenario())

    const exec = m.calls.find((c) => c.tool === 'broker_execute')!
    // Sent VERBATIM beside the signature; the desk rebuilds the text from it.
    expect(typeof exec.args.issued_at).toBe('string')
    expect(m.issuedAt).toBe(exec.args.issued_at)
    expect(Math.abs(Date.now() - Date.parse(String(exec.args.issued_at)))).toBeLessThan(60_000)
    // The identity bound at open, presented again at execute.
    expect(exec.args.agent_key).toBe('desk-trader-test')
    expect(m.calls.find((c) => c.tool === 'broker_open')!.args.agent_key).toBe('desk-trader-test')
    expect(out).toContain(`at ${exec.args.issued_at}`)
    expect(outcome.kind).toBe('dry')
  })

  it('will not re-sign a weaker consent for a desk that predates the replay window', async () => {
    const { outcome, out, mock: m } = await run(scenario({ legacyConsent: true }))

    // Exactly ONE execute attempt: dropping the instant to please an old
    // server is the wrong way round, so the agent says which end is old.
    expect(m.calls.filter((c) => c.tool === 'broker_execute')).toHaveLength(1)
    expect(outcome).toMatchObject({ kind: 'refused', where: 'desk' })
    expect(out).toContain('predates the replay window')
    expect(out).toContain('will not sign a weaker consent')
    expect(m.completes).toEqual([])
  })

  it('walks away when told to, and never on its own', async () => {
    // With no funding route the desk offers [proceed, decline]; index 1 is
    // the walk-away, and only an explicit --option can reach it.
    const { outcome } = await run(scenario(), { optionIndex: 1 })
    expect(outcome).toMatchObject({ kind: 'stopped', status: 'declined' })
  })

  it('refuses a consent signed by a wallet that is not the intent\'s', async () => {
    mock = await startMockDesk(scenario(), '0x000000000000000000000000000000000000dead')
    const lines: string[] = []
    const outcome = await runDeskTrader({
      account: ACCOUNT,
      base: mock.url,
      ask: ASK,
      agentKey: 'k',
      agentName: 'a',
      live: false,
      optionIndex: null,
      internalRun: true,
      log: (l) => lines.push(l),
      drive: recordingDrive().fn,
    })
    // The mock binds the intent to the wallet broker_open was called with, so
    // this can only fail if the desk stopped checking. It is the one gate
    // between "an agent names a wallet" and "a job lands in that rail".
    expect(outcome).toMatchObject({ kind: 'refused', where: 'desk' })
    expect(lines.join('\n')).toMatch(/recovers to|does not verify/)
  })
})
