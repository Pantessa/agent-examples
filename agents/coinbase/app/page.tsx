'use client'

import { useCallback, useEffect, useState } from 'react'

type Holding = {
  currency: string
  name: string
  amount: number
  priceUsd: number | null
  valueUsd: number | null
}
type Portfolio = { holdings: Holding[]; totalUsd: number; live: boolean; error?: string }
type Receipt = { host: string; amountUsd: number; ok: boolean; txHash?: string; note: string; ts: number }
type Signal = {
  product: string
  source: string
  paidUsd: number
  referenceUsd: number | null
  quote: { productId: string; bid: number | null; ask: number | null; mid: number | null }
  action: 'BUY' | 'SELL' | 'HOLD'
  rationale: string
  suggestedLimitPrice: number | null
  suggestedBaseSize: string | null
}
type Status = {
  live: boolean
  hasCoinbaseKeys: boolean
  product: string
  agentAddress: string
  spend: { spentTodayUsd: number; remainingTodayUsd: number }
  receipts: Receipt[]
}

const usd = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const num = (n: number | null | undefined, p = 6) =>
  n == null ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: p })

export default function Page() {
  const [status, setStatus] = useState<Status | null>(null)
  const [pf, setPf] = useState<Portfolio | null>(null)
  const [signal, setSignal] = useState<Signal | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // Trade form
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [type, setType] = useState<'LIMIT' | 'MARKET'>('LIMIT')
  const [product, setProduct] = useState('BTC-USD')
  const [limitPrice, setLimitPrice] = useState('')
  const [baseSize, setBaseSize] = useState('')
  const [quoteSize, setQuoteSize] = useState('')

  const refreshStatus = useCallback(async () => {
    const s: Status = await (await fetch('/api/status')).json()
    setStatus(s)
    setProduct((p) => (p === 'BTC-USD' ? s.product : p))
  }, [])

  useEffect(() => {
    refreshStatus()
    fetch('/api/portfolio')
      .then((r) => r.json())
      .then(setPf)
  }, [refreshStatus])

  const getSignal = async () => {
    setBusy('signal')
    setFlash(null)
    try {
      const r = await fetch(`/api/signal?product=${encodeURIComponent(product)}`)
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      const sig: Signal = data.signal
      setSignal(sig)
      // Pre-fill the trade form so it's actionable in one click. On a real
      // recommendation use it; otherwise fall back to the live quote so the
      // fields are never empty.
      if (sig.action !== 'HOLD') setSide(sig.action)
      const px = sig.suggestedLimitPrice ?? sig.quote.bid ?? sig.quote.mid
      if (px) {
        setType('LIMIT')
        setLimitPrice(String(Math.round(px * 100) / 100))
        setBaseSize(sig.suggestedBaseSize ?? (25 / px).toPrecision(4))
      }
      await refreshStatus()
    } catch (e) {
      setFlash({ kind: 'err', text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const placeOrder = async () => {
    setBusy('trade')
    setFlash(null)
    try {
      const body: Record<string, string> = { productId: product, side, type }
      if (type === 'LIMIT') {
        body.limitPrice = limitPrice
        body.baseSize = baseSize
      } else if (side === 'BUY') {
        body.quoteSize = quoteSize
      } else {
        body.baseSize = baseSize
      }
      const r = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      const head = data.placed ? '✅ PLACED' : data.status === 'preview' ? '🔍 PREVIEW (dry-run)' : '⛔ REJECTED'
      setFlash({ kind: data.status === 'rejected' ? 'err' : 'ok', text: `${head}\n${data.message}\n\n${JSON.stringify(data.config, null, 2)}` })
      await refreshStatus()
    } catch (e) {
      setFlash({ kind: 'err', text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const live = status?.live
  const receipts = status?.receipts ?? []

  return (
    <div className="wrap">
      <header className="top">
        <div>
          <div className="brand">
            <span className="dot" /> Coinbase Agent
          </div>
          <p className="sub">
            A Yeetful x402 payer on Coinbase Advanced Trade — buys a signal through its expense account, then trades the book.
          </p>
        </div>
        <div className="badges">
          <span className={`badge ${live ? 'live' : 'dry'}`}>{live ? '● LIVE — real orders armed' : '● DRY-RUN — previews only'}</span>
          <span className="badge">{status?.hasCoinbaseKeys ? 'CDP keys ✓' : 'no CDP keys'}</span>
          {status?.agentAddress && (
            <span className="badge">wallet {status.agentAddress.slice(0, 6)}…{status.agentAddress.slice(-4)}</span>
          )}
        </div>
      </header>

      <div className="grid">
        {/* Portfolio */}
        <section className="panel">
          <h2>Portfolio</h2>
          <p className="hint">{pf?.live ? 'Live account balances.' : 'Sample holdings (set LIVE=1 + CDP keys for real balances).'}</p>
          <div className="total">{usd(pf?.totalUsd)}</div>
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Amount</th>
                <th>Price</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {(pf?.holdings ?? []).map((h) => (
                <tr key={h.currency}>
                  <td>
                    <span className="cur">{h.currency}</span>
                    <span className="nm">{h.name}</span>
                  </td>
                  <td>{num(h.amount)}</td>
                  <td>{usd(h.priceUsd)}</td>
                  <td>{usd(h.valueUsd)}</td>
                </tr>
              ))}
              {!pf && (
                <tr>
                  <td colSpan={4} className="empty">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {pf?.error && <div className="flash err">{pf.error}</div>}
        </section>

        {/* Signal + Trade */}
        <section className="panel">
          <h2>Signal &amp; Trade</h2>
          <p className="hint">Buy a market signal through the expense account, then place an order on the book.</p>

          <div className="row">
            <div className="field">
              <label>Product</label>
              <input value={product} onChange={(e) => setProduct(e.target.value.toUpperCase())} placeholder="BTC-USD" />
            </div>
            <div className="field" style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
              <button onClick={getSignal} disabled={busy === 'signal'}>
                {busy === 'signal' ? 'Buying signal…' : 'Get signal'}
              </button>
            </div>
          </div>

          {signal && (
            <div style={{ margin: '6px 0 14px' }}>
              <span className={`pill ${signal.action}`}>{signal.action}</span>
              <p className="signal-line">{signal.rationale}</p>
              <div className="kv">
                <span>bid / ask</span>
                <span>
                  {usd(signal.quote.bid)} / {usd(signal.quote.ask)}
                </span>
              </div>
              <div className="kv">
                <span>signal cost</span>
                <span>{signal.paidUsd > 0 ? usd(signal.paidUsd) : '$0.00 (free pass-through)'}</span>
              </div>
            </div>
          )}

          <div className="row">
            <div className="field">
              <label>Side</label>
              <div className="seg">
                <button className={side === 'BUY' ? 'on-buy' : ''} onClick={() => setSide('BUY')}>
                  Buy
                </button>
                <button className={side === 'SELL' ? 'on-sell' : ''} onClick={() => setSide('SELL')}>
                  Sell
                </button>
              </div>
            </div>
            <div className="field">
              <label>Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as 'LIMIT' | 'MARKET')}>
                <option value="LIMIT">Limit</option>
                <option value="MARKET">Market</option>
              </select>
            </div>
          </div>

          <div className="row">
            {type === 'LIMIT' && (
              <div className="field">
                <label>Limit price</label>
                <input value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder="65000" />
              </div>
            )}
            {type === 'MARKET' && side === 'BUY' ? (
              <div className="field">
                <label>Quote size (USD)</label>
                <input value={quoteSize} onChange={(e) => setQuoteSize(e.target.value)} placeholder="25" />
              </div>
            ) : (
              <div className="field">
                <label>Base size ({product.split('-')[0] || 'BTC'})</label>
                <input value={baseSize} onChange={(e) => setBaseSize(e.target.value)} placeholder="0.0004" />
              </div>
            )}
          </div>

          <button className="primary" onClick={placeOrder} disabled={busy === 'trade'}>
            {busy === 'trade' ? 'Submitting…' : live ? `Place ${side} order` : `Preview ${side} order (dry-run)`}
          </button>

          {flash && <div className={`flash ${flash.kind}`}>{flash.text}</div>}
        </section>

        {/* Expense account */}
        <section className="panel full">
          <h2>Expense account</h2>
          <p className="hint">
            Every signal purchase is grant-checked (allowlist + per-call/per-day caps) and receipted — settlement or denial.
          </p>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 12 }}>
            <div className="kv" style={{ borderBottom: 'none', gap: 10 }}>
              <span>spent today</span>
              <span>{usd(status?.spend.spentTodayUsd ?? 0)}</span>
            </div>
            <div className="kv" style={{ borderBottom: 'none', gap: 10 }}>
              <span>remaining today</span>
              <span>{usd(status?.spend.remainingTodayUsd ?? 0)}</span>
            </div>
          </div>
          <div className="receipts">
            {receipts.length === 0 && <div className="empty">No receipts yet — hit “Get signal”.</div>}
            {receipts
              .slice()
              .reverse()
              .map((r, i) => (
                <div className="receipt" key={`${r.ts}-${i}`}>
                  <span className={`tag ${r.ok ? 'ok' : 'deny'}`}>{r.ok ? 'OK' : 'DENY'}</span>
                  <span className="host">{r.host}</span>
                  <span className="amt">{r.note}</span>
                  <span className="amt">{usd(r.amountUsd)}</span>
                </div>
              ))}
          </div>
          <p className="note">
            Mirror of <code>x402-services</code>: there a service is a thin adapter over <code>@yeetful/x402-service-kit</code>;
            here an agent is a thin adapter over <code>@yeetful/agent-kit</code>. Illustrative momentum rule — not financial advice.
          </p>
        </section>
      </div>
    </div>
  )
}
