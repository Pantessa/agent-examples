'use client'

import { useEffect, useState } from 'react'

interface RunStep {
  label: string
  detail: string
}

interface RunResult {
  mode: 'dry-run' | 'live'
  address: string
  steps: RunStep[]
  goalMet: boolean
  paidUsd: number
  receipts: Array<{ url?: string; amountUsd?: number; outcome?: string }>
}

interface Status {
  mode: 'dry-run' | 'live'
  plansFor: string
  doors: { funding: string; fundingPaid: string; nearIntents: string }
  note: string
}

export default function Page() {
  const [status, setStatus] = useState<Status | null>(null)
  const [chain, setChain] = useState('Arbitrum')
  const [token, setToken] = useState('USDC')
  const [amount, setAmount] = useState('2')
  const [finalAction, setFinalAction] = useState('supply it to Aave on Arbitrum')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => undefined)
  }, [])

  async function run() {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chain, token, amount: Number(amount), finalAction: finalAction || undefined }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setResult(body as RunResult)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="wrap">
      <div className="head">
        <h1>The Lazy Trader</h1>
        <p>
          An agent that only knows how to sign. It has funds <em>somewhere</em>; you give it a goal <em>somewhere else</em>. It buys the
          hard part — scan, route, gas, ordering — from Yeetful&apos;s funding planner as one x402 call, then follows the runbook.
        </p>
        <span className={`mode ${status?.mode === 'live' ? 'live' : ''}`}>
          {status ? `${status.mode.toUpperCase()} · plans for ${status.plansFor.slice(0, 6)}…${status.plansFor.slice(-4)}` : 'loading…'}
        </span>
      </div>

      <div className="card goalForm">
        <div>
          <label>Chain</label>
          <select value={chain} onChange={(e) => setChain(e.target.value)}>
            <option>Arbitrum</option>
            <option>Base</option>
            <option>Ethereum</option>
          </select>
        </div>
        <div>
          <label>Token</label>
          <select value={token} onChange={(e) => setToken(e.target.value)}>
            <option>USDC</option>
            <option>ETH</option>
          </select>
        </div>
        <div>
          <label>Hold at least</label>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
        </div>
        <div className="full">
          <label>Then (the point of it all)</label>
          <input value={finalAction} onChange={(e) => setFinalAction(e.target.value)} placeholder="what the funding is for" />
        </div>
        <button onClick={run} disabled={running}>
          {running ? 'working…' : 'Let the lazy trader trade'}
        </button>
      </div>

      {error && (
        <div className="card">
          <div className="error">✗ {error}</div>
        </div>
      )}

      {result && (
        <div className="card log">
          {result.steps.map((s, i) => (
            <div className={`step ${s.label}`} key={i}>
              <span className="tag">{s.label}</span>
              <span className="detail">{s.detail}</span>
            </div>
          ))}
          {result.mode === 'live' && (
            <div className="step">
              <span className="tag">spend</span>
              <span className="detail">
                ${result.paidUsd.toFixed(2)} paid over x402 this run · {result.receipts.length} receipt(s) in the expense account
              </span>
            </div>
          )}
        </div>
      )}

      <div className="footnote">
        Dry-run rides the free door and stops before any signature. <code>LIVE=1</code> + <code>PRIVATE_KEY</code> pays the x402 door (
        {status?.doors.fundingPaid ?? '…'}) through the expense account and signs each leg. Deposits refund automatically if a swap can&apos;t
        fill — funds are never stranded mid-bridge.
      </div>
    </div>
  )
}
