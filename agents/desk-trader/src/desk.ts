/**
 * The agent desk, over MCP — a ~40-line client and nothing else.
 *
 * `POST /api/broker/mcp` is a STATELESS Streamable-HTTP MCP server: one
 * JSON-RPC `tools/call`, no `initialize` handshake, no session id. The reply
 * comes back SSE-framed (`event: message` / `data: {…}`) or as plain JSON.
 * That is the whole transport, which is why this file needs no MCP SDK.
 *
 * Read the safety contract while you are here: the desk trades in SENTENCES.
 * Every option it offers is a resume-sentence that re-enters the same parse
 * ladder a human ask uses, and `assertNoTxMaterial` mechanically forbids
 * calldata, typed data and deposit addresses from crossing this surface.
 * Signable material lives in exactly one place — the job API, behind the
 * capability token minted when THIS wallet consented.
 */

export interface BrokerOption {
  id: string
  label: string
  /** The sentence choosing this option rewrites the working ask into. */
  resume: string
  kind: 'funding' | 'restate' | 'decline'
}

export interface BrokerPlan {
  ask: string
  quote: {
    gate: string
    kind: 'action' | 'clarify' | 'planner' | string
    note?: string
    mcps: string[]
    funding?: { askUsd: number; movableUsd: number; strandedUsd: number; verdict: 'covered' | 'short' | 'unknown' }
  }
  options: BrokerOption[]
  say: string
}

export interface OpenResult {
  intentId: string
  state: string
  plan: BrokerPlan
  contract: string
  next: string[]
  /** The agent's public, shareable track record — keyed on sha256(agent_key). */
  recordUrl?: string
}

export interface ExecuteResult {
  intentId: string
  state: string
  jobId: string
  steps: { seq: number; kind: string; note: string }[]
  drive: { poll: string; complete: string; how: string[] }
  say: string
}

/** The desk said no, in its own words. Not a bug — the product working. */
export class DeskRefusal extends Error {
  readonly tool: string
  constructor(tool: string, message: string) {
    super(message)
    this.name = 'DeskRefusal'
    this.tool = tool
  }
}

export interface DeskOptions {
  /** `https://www.pantessa.com` — or a local `next start` while you develop. */
  base: string
  /** Mark this run as a Pantessa internal drill so it never counts as growth. */
  internalRun?: boolean
  fetchImpl?: typeof fetch
}

/** Pull the first JSON-RPC message out of a plain-JSON or SSE-framed body. */
export function parseMcpBody(text: string): { result?: unknown; error?: { message?: string } } {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) return JSON.parse(trimmed)
  for (const line of trimmed.split('\n')) {
    if (line.startsWith('data:')) {
      const payload = line.slice(5).trim()
      if (payload && payload !== '[DONE]') return JSON.parse(payload)
    }
  }
  throw new Error(`Unrecognized MCP response framing: ${trimmed.slice(0, 120)}`)
}

export class Desk {
  constructor(private readonly opts: DeskOptions) {}

  get base(): string {
    return this.opts.base.replace(/\/$/, '')
  }

  async call<T>(tool: string, args: Record<string, unknown>): Promise<T> {
    const f = this.opts.fetchImpl ?? fetch
    const res = await f(`${this.base}/api/broker/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        // Pantessa's own drills stamp themselves so their rows never read as
        // growth, and their refusals never land in the product-gap queue.
        ...(this.opts.internalRun ? { 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${tool} → HTTP ${res.status}: ${text.slice(0, 300)}`)
    const msg = parseMcpBody(text)
    if (msg.error) throw new DeskRefusal(tool, msg.error.message || 'MCP error')
    const result = msg.result as { content?: Array<{ type: string; text?: string }>; isError?: boolean } | undefined
    const body = result?.content?.find((c) => c.type === 'text')?.text ?? ''
    // A tool that refuses answers 200 with isError — the desk's refusals are
    // sentences, not status codes.
    if (result?.isError) throw new DeskRefusal(tool, body || `${tool} failed`)
    try {
      return JSON.parse(body) as T
    } catch {
      throw new Error(`${tool} -> the desk answered something that is not JSON: ${body.slice(0, 200)}`)
    }
  }

  open(args: { ask: string; wallet: string; agent: string; agent_key: string }): Promise<OpenResult> {
    return this.call<OpenResult>('broker_open', args)
  }

  choose(intentId: string, optionId: string): Promise<OpenResult> {
    return this.call<OpenResult>('broker_choose', { intent_id: intentId, option_id: optionId })
  }

  execute(intentId: string, walletSignature: string): Promise<ExecuteResult> {
    return this.call<ExecuteResult>('broker_execute', { intent_id: intentId, wallet_signature: walletSignature })
  }

  close(intentId: string): Promise<{ intentId: string; state: string; say: string }> {
    return this.call('broker_close', { intent_id: intentId })
  }
}

/**
 * THE CONSENT. `broker_execute` compiles the intent into a job OWNED BY THIS
 * WALLET, and a job shows up in its owner's rail with a needs-you badge — so
 * the desk will not take the wallet's word for who it is. The agent holds the
 * key on this path by definition, so it signs these exact bytes (EIP-191
 * personal_sign) and the desk recovers the signer before a job row exists.
 *
 * Signing this moves nothing. Every leg still needs this wallet's own
 * signature, one at a time, after the guard has built and checked it.
 *
 * Mirror of `deskExecuteConsentMessage` in the website's lib/broker-exec.ts —
 * byte for byte, including the em dash and the lowercased wallet.
 */
export function deskExecuteConsentMessage(intentId: string, wallet: string): string {
  return [
    'Pantessa agent desk — execute consent',
    `Intent: ${intentId}`,
    `Wallet: ${wallet.toLowerCase()}`,
    'Signing lets the desk compile this intent into a job owned by this wallet. It moves nothing by itself; every leg still needs this wallet\'s own signature.',
  ].join('\n')
}

/**
 * `broker_execute` hands back drive URLs with the capability token already in
 * the query string, but no bare `token` field — so every agent has to pull it
 * back out to call the job API itself. (Filed with the desk; when
 * `ExecuteResult.token` lands this becomes `ex.token ?? tokenFromDriveUrl(…)`.)
 */
export function tokenFromDriveUrl(pollUrl: string): string {
  const t = new URL(pollUrl).searchParams.get('t')
  if (!t) throw new Error(`No capability token in the desk's drive URL: ${pollUrl}`)
  return t
}
