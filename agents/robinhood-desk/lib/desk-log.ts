// The activity log: every embed event the host page hears becomes a line —
// pure reducer, pinned by tests, so the log is a faithful transcript of what
// the embed reported, not a guess.
//
// `turn` is the one event every chat turn emits (contract v1: 'event' with
// name 'turn'); `order-signed` fires when a CoW/HL order signs. The outcome
// vocabulary below is what components/ChatInterface reports on the Pantessa
// side — the desk renders it, it does not invent states.

export type TurnOutcome =
  | 'answered'
  | 'tx-built'
  | 'signed'
  | 'settled'
  | 'clarify'
  | 'refused'
  | 'credit-gate'
  | 'error'

export interface TurnEvent {
  outcome: TurnOutcome | string
  artifact?: string
  valueUsd?: number
  txUrl?: string
  chainId?: number
  jobId?: string
  jobStatus?: string
}

export type Tone = 'neutral' | 'build' | 'signed' | 'warn' | 'bad'

export interface LogLine {
  id: number
  at: number
  /** Short mono tag, ≤ 6 chars. */
  tag: string
  text: string
  tone: Tone
  href?: string
}

let seq = 0
export const nextId = () => ++seq

const ARTIFACT_WORDS: Record<string, string> = {
  tx: 'transaction',
  'tx-chain': 'transaction chain',
  job: 'multi-step job',
  'cow-order': 'CoW order',
  'hl-order': 'Hyperliquid order',
  vote: 'vote',
}

const usd = (n?: number) => (typeof n === 'number' && n > 0 ? ` · $${n.toFixed(2)}` : '')

/** One embed event → zero or one log line. */
export function lineForEvent(name: string, data: unknown, at = Date.now()): LogLine | null {
  const base = { id: nextId(), at }
  if (name === 'order-signed') {
    const d = (data ?? {}) as { artifact?: string; valueUsd?: number; txUrl?: string }
    return { ...base, tag: 'SIGN', text: `${ARTIFACT_WORDS[d.artifact ?? ''] ?? 'order'} signed${usd(d.valueUsd)}`, tone: 'signed', href: d.txUrl }
  }
  if (name !== 'turn') return { ...base, tag: 'EMBED', text: name, tone: 'neutral' }
  const t = (data ?? {}) as TurnEvent
  const what = ARTIFACT_WORDS[t.artifact ?? ''] ?? t.artifact ?? 'artifact'
  switch (t.outcome) {
    case 'answered':
      return { ...base, tag: 'REPLY', text: 'answered', tone: 'neutral' }
    case 'tx-built':
      return { ...base, tag: 'BUILD', text: `${what} built · guarded · awaiting your signature${usd(t.valueUsd)}`, tone: 'build' }
    case 'signed':
      return { ...base, tag: 'SIGN', text: `${what} signed${usd(t.valueUsd)}${t.txUrl ? ' · receipt' : ''}`, tone: 'signed', href: t.txUrl }
    case 'settled':
      return { ...base, tag: 'DONE', text: `job settled${t.jobStatus ? ` · ${t.jobStatus}` : ''}${usd(t.valueUsd)}`, tone: 'signed' }
    case 'clarify':
      return { ...base, tag: 'ASK', text: 'needs one more detail', tone: 'warn' }
    case 'refused':
      return { ...base, tag: 'HELD', text: 'refused by a guardrail — read the reply', tone: 'warn' }
    case 'credit-gate':
      return { ...base, tag: 'PLAN', text: 'house credits exhausted for this visitor', tone: 'warn' }
    case 'error':
      return { ...base, tag: 'ERR', text: 'turn errored', tone: 'bad' }
    default:
      return { ...base, tag: 'TURN', text: String(t.outcome), tone: 'neutral' }
  }
}

export function appLine(tag: string, text: string, tone: Tone = 'neutral', href?: string, at = Date.now()): LogLine {
  return { id: nextId(), at, tag, text, tone, href }
}

export const MAX_LINES = 200

export function pushLine(lines: LogLine[], line: LogLine | null): LogLine[] {
  if (!line) return lines
  const next = [line, ...lines]
  return next.length > MAX_LINES ? next.slice(0, MAX_LINES) : next
}

/** Signed money through this desk this session — the number a host cares about. */
export function signedUsd(lines: LogLine[]): number {
  return lines.filter((l) => l.tone === 'signed').reduce((s, l) => {
    const m = /\$([0-9.]+)/.exec(l.text)
    return s + (m ? Number(m[1]) : 0)
  }, 0)
}
