/**
 * A Pantessa in a box: the agent desk MCP, the Jobs API, the Hyperliquid relay
 * and a toy EVM node, on one ephemeral port in this process.
 *
 * It is not a stub of our own client — it is the SERVER side, so a test that
 * passes here exercised real HTTP, real SSE framing, a real signature recovery
 * of the consent text, and real capability-token checks. The pieces it models
 * are the ones the example depends on, and it is deliberately strict: a wrong
 * token, a foreign signer, a completion for the wrong leg, or an HL action
 * whose signature does not recover all answer with an error, the way prod does.
 */
import { createServer, type Server } from 'node:http'
import { recoverMessageAddress, recoverTypedDataAddress, keccak256, toHex } from 'viem'
import { deskExecuteConsentMessage } from '../src/desk.js'

export interface MockStep {
  seq: number
  kind: 'sign' | 'wait' | 'auto'
  status: 'pending' | 'offered' | 'done' | 'failed'
  builder: string
  title: string
  artifact: Record<string, unknown> | null
  guardReport?: Record<string, unknown> | null
  result?: unknown
  valueUsd: number | null
}

export interface MockScenario {
  /** What broker_open answers: the funding verdict + the options offered. */
  fundingVerdict: 'covered' | 'short'
  movableUsd: number
  askUsd: number
  fundingOptions: Array<{ id: string; label: string; resume: string }>
  /** null = broker_execute refuses with this sentence instead of compiling. */
  executeRefusal: string | null
  /** The legs the job is compiled from (artifacts served on offer). */
  steps: MockStep[]
  /** Set to fail the job at this seq with this reason when it is offered. */
  failAt?: { seq: number; reason: string }
  /** Make /api/tx/refresh withhold the re-quote (the dead-calldata guard). */
  refreshBlocked?: boolean
  /** Make the Hyperliquid relay reject the member carrying this nonce, the
   *  way the venue refuses one action of a batch. */
  hlRejectNonce?: number
  /** Model a desk that predates the `Issued at:` line: it ignores `issued_at`
   *  and rebuilds the FOUR-line consent, so a five-line signature recovers to
   *  somebody else. This is what production looks like before website#851. */
  legacyConsent?: boolean
}

export interface MockCall {
  tool: string
  args: Record<string, unknown>
}

export interface MockDesk {
  url: string
  calls: MockCall[]
  /** Every completion the drive posted, in order. */
  completes: Array<{ seq: number; result: Record<string, unknown> }>
  /** Every HL action submitted to the relay, with its recovered signer. */
  hlSubmits: Array<{ signer: string; action: unknown; mode?: string; nonce: number }>
  /** Every re-quote a txChain step asked for. */
  refreshes: Array<Record<string, unknown>>
  /** Every raw transaction the toy node accepted. */
  broadcasts: Array<{ chainId: number; raw: string; hash: string }>
  /** The consent signature recovered by broker_execute (null until it runs). */
  consentSigner: string | null
  /** The `issued_at` the accepted consent carried (null on a legacy desk). */
  issuedAt: string | null
  close(): Promise<void>
}

const json = (res: import('node:http').ServerResponse, code: number, body: unknown) => {
  const text = JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(text)
}
/** The desk answers SSE-framed, like mcp-handler does — so the client's
 *  framing parser is exercised on every single test. */
const sse = (res: import('node:http').ServerResponse, payload: unknown) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`)
}
const toolOk = (payload: unknown) => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } })
const toolErr = (message: string) => ({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: message }], isError: true } })

const TOKEN = 'mock-capability-token'

export async function startMockDesk(scenario: MockScenario, walletExpected?: string): Promise<MockDesk> {
  const calls: MockCall[] = []
  const completes: MockDesk['completes'] = []
  const hlSubmits: MockDesk['hlSubmits'] = []
  const broadcasts: MockDesk['broadcasts'] = []
  const refreshes: MockDesk['refreshes'] = []
  const state = {
    consentSigner: null as string | null,
    /** The instant the accepted consent carried (null on a legacy desk). */
    issuedAt: null as string | null,
    /** The identity bound at open; execute must present the same one. */
    agentKey: null as string | null,
    intentId: 'mockintent',
    intentWallet: walletExpected ? walletExpected.toLowerCase() : null,
    jobId: 'mockjob00000',
    jobStatus: 'running' as string,
    failReason: null as string | null,
    steps: scenario.steps.map((s) => ({ ...s })),
    closed: false,
    ask: '',
  }

  /** Offer the earliest step that is still pending, mirroring the runner:
   *  a `wait` advances itself, an `auto` runs itself, a `sign` gets built. */
  function advance(): void {
    for (const step of state.steps) {
      if (step.status === 'done' || step.status === 'failed') continue
      if (scenario.failAt && step.seq === scenario.failAt.seq && step.status === 'pending') {
        step.status = 'failed'
        state.jobStatus = 'failed'
        state.failReason = scenario.failAt.reason
        return
      }
      if (step.kind === 'wait' || step.kind === 'auto') {
        step.status = 'done'
        continue
      }
      if (step.status === 'pending') step.status = 'offered'
      state.jobStatus = 'waiting_signature'
      return
    }
    state.jobStatus = 'done'
  }
  advance()

  /** The seq the runner is working on — what `driveJob` reads to find its leg. */
  function currentStep(): number {
    const live = state.steps.find((st) => st.status === 'offered') ?? state.steps.find((st) => st.status === 'pending')
    return live ? live.seq : state.steps.length
  }

  /** Every Hyperliquid typed-data blob this job will ever hand out, by nonce.
   *  The relay recovers against THESE bytes, so a signature only verifies if
   *  the agent signed exactly what the runner served — the #850 rule, tested. */
  const hlTypedData = new Map<number, unknown>()
  for (const step of state.steps) {
    const order = (step.artifact as { orderRequest?: Record<string, unknown> } | null)?.orderRequest
    if (!order) continue
    const hl = (order.hl as Record<string, unknown> | undefined) ?? {}
    if (typeof hl.nonce === 'number' && order.typedData) hlTypedData.set(hl.nonce, order.typedData)
    const pre = hl.pre as Record<string, unknown> | undefined
    if (pre && typeof pre.nonce === 'number') hlTypedData.set(pre.nonce, pre.typedData)
    // C2 ships the batch at the TOP level of orderRequest; `hl.batch` is the
    // older spelling and both are indexed, exactly as the SDK reads both.
    const members = [
      ...((order.batch as Array<Record<string, unknown>> | undefined) ?? []),
      ...((hl.batch as Array<Record<string, unknown>> | undefined) ?? []),
    ]
    for (const raw of members) {
      if (typeof raw.nonce === 'number') hlTypedData.set(raw.nonce, raw.typedData)
    }
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const body = await new Promise<string>((resolve) => {
      let buf = ''
      req.on('data', (c) => (buf += c))
      req.on('end', () => resolve(buf))
    })

    // ── the desk MCP ────────────────────────────────────────────────────
    if (url.pathname === '/api/broker/mcp' && req.method === 'POST') {
      const rpc = JSON.parse(body || '{}') as { params?: { name?: string; arguments?: Record<string, unknown> } }
      const tool = rpc.params?.name ?? ''
      const args = rpc.params?.arguments ?? {}
      calls.push({ tool, args })

      if (tool === 'broker_open') {
        state.ask = String(args.ask ?? '')
        // A fixed `walletExpected` models a desk that already knows which
        // wallet this intent is for, whatever the caller names at open.
        state.intentWallet = (walletExpected ? walletExpected.toLowerCase() : null) ?? String(args.wallet ?? '').toLowerCase()
        if (!args.agent_key) return sse(res, toolErr('broker_execute needs a bound agent identity — pass agent_key at open.'))
        state.agentKey = String(args.agent_key)
        return sse(res, toolOk({
          intentId: state.intentId,
          state: 'open',
          plan: planFor(state.ask, scenario),
          contract: 'Sentences in, sentences and sign links out.',
          next: ['broker_choose', 'broker_handoff'],
          recordUrl: 'http://example.invalid/agents/mockrecord',
        }))
      }
      if (tool === 'broker_choose') {
        const opt = [...scenario.fundingOptions, { id: 'proceed', label: 'Proceed as asked', resume: state.ask }].find((o) => o.id === args.option_id)
        if (!opt) return sse(res, toolErr(`No option ${String(args.option_id)} on this intent.`))
        state.ask = opt.resume
        return sse(res, toolOk({ intentId: state.intentId, state: 'open', plan: planFor(state.ask, scenario), contract: '', next: [] }))
      }
      if (tool === 'broker_execute') {
        // The real gates, in the order prod applies them: the bound identity,
        // then the replay window, then recovery of the consent signature —
        // refusing any signer but the wallet the intent was opened for.
        if (!args.agent_key || args.agent_key !== state.agentKey) {
          return sse(res, toolErr('broker_execute needs the same agent_key the intent was opened with.'))
        }
        const sig = String(args.wallet_signature ?? '')
        if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return sse(res, toolErr('broker_execute needs wallet_signature — a 65-byte 0x signature over the consent text is required.'))
        let issuedAt: string | undefined
        if (!scenario.legacyConsent) {
          issuedAt = typeof args.issued_at === 'string' ? args.issued_at : undefined
          if (!issuedAt) return sse(res, toolErr('broker_execute needs issued_at — the ISO-8601 instant from the consent text.'))
          const at = Date.parse(issuedAt)
          if (!Number.isFinite(at) || Math.abs(Date.now() - at) > 10 * 60_000) {
            return sse(res, toolErr('broker_execute needs issued_at within ten minutes of now, both ways.'))
          }
          state.issuedAt = issuedAt
        }
        let signer: string
        try {
          // Rebuilt from the CALLER's own string, so a reformatted timestamp
          // recovers to a different address — which is the whole point.
          const text = issuedAt
            ? deskExecuteConsentMessage(String(args.intent_id), state.intentWallet ?? '', issuedAt)
            : legacyConsentText(String(args.intent_id), state.intentWallet ?? '')
          signer = await recoverMessageAddress({ message: text, signature: sig as `0x${string}` })
        } catch {
          return sse(res, toolErr('broker_execute needs wallet_signature — the signature does not verify against the consent text.'))
        }
        if (signer.toLowerCase() !== (state.intentWallet ?? '')) {
          return sse(res, toolErr(`broker_execute needs wallet_signature — the signature recovers to ${signer.toLowerCase()}, not the intent's wallet.`))
        }
        state.consentSigner = signer.toLowerCase()
        if (scenario.executeRefusal) return sse(res, toolErr(scenario.executeRefusal))
        return sse(res, toolOk({
          intentId: state.intentId,
          state: 'executing',
          jobId: state.jobId,
          steps: state.steps.map((s) => ({ seq: s.seq, kind: s.kind, note: s.title })),
          drive: {
            poll: `${base()}/api/jobs/${state.jobId}?t=${TOKEN}`,
            complete: `${base()}/api/jobs/${state.jobId}/complete?t=${TOKEN}`,
            how: ['GET poll', 'sign', 'POST complete'],
          },
          say: `Compiled to a ${state.steps.length}-leg job.`,
        }))
      }
      if (tool === 'broker_close') {
        state.closed = true
        return sse(res, toolOk({ intentId: state.intentId, state: 'closed', say: 'Closed. Any sign link is revoked.' }))
      }
      return sse(res, toolErr(`Unknown tool ${tool}`))
    }

    // ── the Jobs API ────────────────────────────────────────────────────
    if (url.pathname === `/api/jobs/${state.jobId}` && req.method === 'GET') {
      if (url.searchParams.get('t') !== TOKEN) return json(res, 401, { error: 'Not signed in.' })
      return json(res, 200, { job: { id: state.jobId, status: state.jobStatus, currentStep: currentStep(), failReason: state.failReason, steps: state.steps } })
    }
    if (url.pathname === `/api/jobs/${state.jobId}/complete` && req.method === 'POST') {
      if (url.searchParams.get('t') !== TOKEN) return json(res, 401, { error: 'Not signed in.' })
      const parsed = JSON.parse(body || '{}') as { seq?: number; result?: Record<string, unknown> }
      const step = state.steps.find((s) => s.seq === parsed.seq)
      if (!step || step.status !== 'offered') return json(res, 400, { error: `Step ${String(parsed.seq)} is not offered.` })
      step.status = 'done'
      step.result = parsed.result ?? {}
      completes.push({ seq: parsed.seq as number, result: parsed.result ?? {} })
      advance()
      return json(res, 200, { ok: true })
    }

    // ── the re-quote a deadline-bearing chain step asks for ─────────────
    if (url.pathname === '/api/tx/refresh' && req.method === 'POST') {
      const parsed = JSON.parse(body || '{}') as Record<string, unknown>
      refreshes.push(parsed)
      if (scenario.refreshBlocked) return json(res, 200, { blocked: true, error: 'the re-quote would revert on-chain', blockKind: 'revert' })
      return json(res, 200, {
        tx: { to: '0x000000000000000000000000000000000000c0de', data: '0xfeed', value: '0x0', chainId: 8453 },
        validUntil: Math.floor(Date.now() / 1000) + 600,
      })
    }

    // ── the Hyperliquid relay ───────────────────────────────────────────
    if (url.pathname === '/api/hl/submit' && req.method === 'POST') {
      const parsed = JSON.parse(body || '{}') as { action?: Record<string, unknown>; nonce?: number; signature?: string; mode?: string; from?: string }
      if (!parsed.signature || typeof parsed.nonce !== 'number') return json(res, 400, { error: 'signature and nonce are required.' })
      // A one-time builder-fee cap is the only action whose bytes the CLIENT
      // composes; its typed data is fully determined, so rebuild it here.
      const td =
        parsed.action?.type === 'approveBuilderFee'
          ? feeApprovalTypedData(parsed.action, parsed.nonce)
          : hlTypedData.get(parsed.nonce)
      if (!td) return json(res, 400, { error: `No build outstanding for nonce ${parsed.nonce} — the action was not one this runner served.` })
      let signer: string
      try {
        const recover = recoverTypedDataAddress as unknown as (a: Record<string, unknown>) => Promise<string>
        signer = (await recover({ ...(td as Record<string, unknown>), signature: parsed.signature })).toLowerCase()
      } catch {
        return json(res, 400, { error: 'the signature does not recover against the bytes this runner served.' })
      }
      hlSubmits.push({ signer, action: parsed.action, mode: parsed.mode, nonce: parsed.nonce })
      if (scenario.hlRejectNonce === parsed.nonce) {
        return json(res, 400, { error: 'the venue refused this action: insufficient margin' })
      }
      return json(res, 200, { ok: true, status: 'ok', filled: { totalSz: '1.0', avgPx: '42.0' } })
    }

    // ── a toy EVM node, enough for sign -> broadcast -> receipt ──────────
    if (url.pathname.startsWith('/rpc/') && req.method === 'POST') {
      const chainId = Number(url.pathname.slice(5))
      const reqs = JSON.parse(body || '{}')
      const one = (r: { id: number; method: string; params?: unknown[] }) => {
        const reply = (result: unknown) => ({ jsonrpc: '2.0', id: r.id, result })
        switch (r.method) {
          case 'eth_chainId': return reply(toHex(chainId))
          case 'net_version': return reply(String(chainId))
          case 'eth_blockNumber': return reply(toHex(1000))
          case 'eth_getTransactionCount': return reply(toHex(0))
          case 'eth_gasPrice': return reply(toHex(1_000_000_000))
          case 'eth_maxPriorityFeePerGas': return reply(toHex(1_000_000))
          case 'eth_estimateGas': return reply(toHex(120_000))
          case 'eth_call': return reply('0x')
          case 'eth_getBlockByNumber':
            return reply({ number: toHex(1000), baseFeePerGas: toHex(1_000_000_000), gasLimit: toHex(30_000_000), timestamp: toHex(1_700_000_000), hash: keccak256(toHex('block')), transactions: [] })
          case 'eth_sendRawTransaction': {
            const raw = String((r.params ?? [])[0] ?? '')
            const hash = keccak256(raw as `0x${string}`)
            broadcasts.push({ chainId, raw, hash })
            return reply(hash)
          }
          case 'eth_getTransactionReceipt': {
            const hash = String((r.params ?? [])[0] ?? '')
            if (!broadcasts.some((b) => b.hash === hash)) return reply(null)
            return reply({ transactionHash: hash, blockNumber: toHex(1001), blockHash: keccak256(toHex('block')), status: '0x1', gasUsed: toHex(100_000), cumulativeGasUsed: toHex(100_000), logs: [], logsBloom: `0x${'0'.repeat(512)}`, type: '0x2', transactionIndex: '0x0', from: '0x0000000000000000000000000000000000000000', to: '0x0000000000000000000000000000000000000000', contractAddress: null, effectiveGasPrice: toHex(1_000_000_000) })
          }
          default: return { jsonrpc: '2.0', id: r.id, error: { code: -32601, message: `mock node: ${r.method} not implemented` } }
        }
      }
      return json(res, 200, Array.isArray(reqs) ? reqs.map(one) : one(reqs))
    }

    json(res, 404, { error: `mock desk: no route for ${req.method} ${url.pathname}` })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const base = () => `http://127.0.0.1:${port}`

  return {
    url: base(),
    calls,
    completes,
    hlSubmits,
    broadcasts,
    refreshes,
    get consentSigner() {
      return state.consentSigner
    },
    get issuedAt() {
      return state.issuedAt
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function planFor(ask: string, scenario: MockScenario) {
  return {
    ask,
    quote: {
      gate: 'hyperliquid',
      kind: 'action' as const,
      mcps: ['hyperliquid-free', 'near-intents-mcp-yeetful'],
      funding: { askUsd: scenario.askUsd, movableUsd: scenario.movableUsd, strandedUsd: 0, verdict: scenario.fundingVerdict },
    },
    options: [
      ...scenario.fundingOptions.map((o) => ({ ...o, kind: 'funding' as const })),
      { id: 'proceed', label: 'Proceed as asked', resume: ask, kind: 'restate' as const },
      { id: 'decline', label: 'Walk away', resume: 'Never mind — leave my funds where they are.', kind: 'decline' as const },
    ],
    say: `"${ask}" — the hyperliquid layer will compile this deterministically.`,
  }
}

/** The typed data a `approveBuilderFee` action is signed under — the one HL
 *  payload the client composes rather than receives. */
function feeApprovalTypedData(action: Record<string, unknown>, nonce: number) {
  const chainId = Number.parseInt(String(action.signatureChainId ?? '0x1'), 16)
  return {
    domain: { name: 'HyperliquidSignTransaction', version: '1', chainId, verifyingContract: '0x0000000000000000000000000000000000000000' },
    types: {
      'HyperliquidTransaction:ApproveBuilderFee': [
        { name: 'hyperliquidChain', type: 'string' },
        { name: 'maxFeeRate', type: 'string' },
        { name: 'builder', type: 'address' },
        { name: 'nonce', type: 'uint64' },
      ],
    },
    primaryType: 'HyperliquidTransaction:ApproveBuilderFee',
    message: {
      hyperliquidChain: action.hyperliquidChain,
      maxFeeRate: action.maxFeeRate,
      builder: action.builder,
      nonce: BigInt(nonce),
    },
  }
}

/** The four-line consent a deployment that predates the replay window rebuilds.
 *  Only `legacyConsent` scenarios use it — it is what an agent's five-line
 *  signature fails against, on purpose. */
function legacyConsentText(intentId: string, wallet: string): string {
  return [
    'Pantessa agent desk — execute consent',
    `Intent: ${intentId}`,
    `Wallet: ${wallet.toLowerCase()}`,
    "Signing lets the desk compile this intent into a job owned by this wallet. It moves nothing by itself; every leg still needs this wallet's own signature.",
  ].join('\n')
}
