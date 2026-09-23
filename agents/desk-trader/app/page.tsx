'use client'

import { useEffect, useState } from 'react'

interface Status {
  mode: string
  base: string
  defaultAsk: string
  note: string
}

interface Run {
  wallet: string
  ask: string
  lines: string[]
  outcome?: { kind: string; where?: string; why?: string }
  error?: string
}

const STEPS = [
  ['broker_open', 'the desk reads the wallet and quotes the ask — holdings verdict + funding routes'],
  ['pick a route', 'the first fundable option, or --option N'],
  ['consent', 'one personal_sign over five lines: intent · wallet · issued at · what it lets the desk do'],
  ['broker_execute', 'the desk compiles the job; the agent gets a job id + a capability token'],
  ['driveJob', 'poll → sign the offered leg with the agent’s own key → broadcast → complete → repeat; wait legs settle on-chain first'],
]

export default function Page() {
  const [status, setStatus] = useState<Status | null>(null)
  const [ask, setAsk] = useState('')
  const [running, setRunning] = useState(false)
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then((s: Status) => {
        setStatus(s)
        setAsk((a) => a || s.defaultAsk)
      })
      .catch(() => undefined)
  }, [])

  async function go() {
    setRunning(true)
    setError(null)
    setRun(null)
    try {
      const res = await fetch('/api/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ask }) })
      const body = (await res.json()) as Run
      setRun(body)
      if (body.error) setError(body.error)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="wrap">
      <div className="head">
        <h1>Desk Trader</h1>
        <p>
          An agent that holds its own key and wants a 2x HYPE long. It asks the Pantessa desk, gets its holdings read and a funding route it
          can afford, signs one consent, and then signs every leg itself &mdash; <strong>round-trip across every settlement boundary, batched
          within one</strong>. Pantessa never holds the key.
        </p>
        <span className="mode">{status ? `DRY RUN · ${status.base.replace(/^https?:\/\//, '')}` : 'loading…'}</span>
      </div>

      <div className="card">
        {STEPS.map(([k, v]) => (
          <div className="step" key={k}>
            <span className="tag">{k}</span>
            <span className="detail">{v}</span>
          </div>
        ))}
      </div>

      <div className="card goalForm">
        <div className="full">
          <label>The ask</label>
          <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder={status?.defaultAsk ?? ''} />
        </div>
        <button onClick={go} disabled={running || !ask.trim()}>
          {running ? 'running the loop…' : 'Run it dry (fresh throwaway key)'}
        </button>
      </div>

      {error && (
        <div className="card">
          <div className="error">✗ {error}</div>
        </div>
      )}

      {run && (
        <div className="card log">
          <div className="step">
            <span className="tag">wallet</span>
            <span className="detail">{run.wallet} — minted for this run, holds nothing</span>
          </div>
          {run.lines.map((l, i) => (
            <div className="step" key={i}>
              <span className="detail" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 12 }}>
                {l}
              </span>
            </div>
          ))}
          {run.outcome && (
            <div className="step">
              <span className="tag">outcome</span>
              <span className="detail">
                {run.outcome.kind}
                {run.outcome.where ? ` (${run.outcome.where})` : ''} — a refusal here is the product working: an empty wallet gets no calldata.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="footnote">
        {status?.note ?? ''} To sign for real, run the CLI with your own funded burner:{' '}
        <code>AGENT_KEY=0x… LIVE=1 pnpm dev</code> — every leg is guard-checked server-side and the runner verifies each completion on-chain
        before the next leg builds. Source and README: <code>agents/desk-trader</code> in Pantessa/agent-examples.
      </div>
    </div>
  )
}
