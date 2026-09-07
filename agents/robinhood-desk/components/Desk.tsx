'use client'

// The desk: a host app that READS the chain itself and turns every click into
// an ask for the embedded Pantessa chat, which BUILDS (guarded, on its side)
// and hands the signature to the visitor's own wallet on this page.
//
// Nothing here can move money. The only executable surface is the embed.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PantessaDesk, { type PantessaDeskHandle } from './PantessaDesk'
import { ValueChart, WeightBar, fmtUsd, type Sample } from './Charts'
import type { DeskConfig } from '@/lib/config'
import type { Portfolio } from '@/lib/portfolio'
import { prompts, trimNum } from '@/lib/portfolio'
import { appLine, lineForEvent, pushLine, signedUsd, type LogLine } from '@/lib/desk-log'
import { connectWallet, createSwitchingProvider, discoverWallets, type DiscoveredWallet } from '@/lib/wallet'
import { EXPLORER_ADDRESS, ROBINHOOD_CHAIN_PARAMS } from '@/lib/chain'

const POLL_MS = 30_000
const MAX_SAMPLES = 720

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
// 24h, locale-free — the clock renders only after mount (see `now`), and the
// log lines only exist client-side, so nothing time-shaped is server-rendered.
const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
const hhmmss = (t: number) => `${hhmm(t)}:${pad(new Date(t).getSeconds())}`

function loadSamples(addr: string): Sample[] {
  try {
    const raw = localStorage.getItem(`desk:samples:${addr.toLowerCase()}`)
    const arr = raw ? (JSON.parse(raw) as Sample[]) : []
    return Array.isArray(arr) ? arr.filter((s) => typeof s.at === 'number' && typeof s.usd === 'number') : []
  } catch {
    return []
  }
}
function saveSamples(addr: string, samples: Sample[]) {
  try {
    localStorage.setItem(`desk:samples:${addr.toLowerCase()}`, JSON.stringify(samples.slice(-MAX_SAMPLES)))
  } catch {
    /* private mode — the chart just won't persist */
  }
}

const ROSTER = [
  { id: 'robinhood-free', name: 'Robinhood Chain', role: 'stocks · bridge', color: '#0f7a4f', badge: 'RH', desc: 'Tokenized-stock swaps against USDG, portfolio reads, the canonical bridge in. Native guarded builds.' },
  { id: 'uniswap-free', name: 'Uniswap', role: 'swaps · quotes', color: '#2457c5', badge: 'UNI', desc: 'v3 quotes and swaps on every chain the desk touches — the same pools that price this page.' },
  { id: 'yeetful-tool-wallet', name: 'Wallet reader', role: 'balances · history', color: '#5b4b8a', badge: 'W', desc: 'Multi-chain balances and activity, so "what do I hold?" answers from data, not memory.' },
]

export default function Desk({ config }: { config: DeskConfig }) {
  // ── wallet ────────────────────────────────────────────────────────────────
  const provider = useMemo(() => createSwitchingProvider(), [])
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([])
  const [selected, setSelected] = useState<DiscoveredWallet | null>(null)
  const [accounts, setAccounts] = useState<string[]>([])
  const [chainId, setChainId] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)

  const rescan = useCallback(() => {
    void discoverWallets().then(setWallets)
  }, [])
  useEffect(() => {
    rescan()
    // Wallets that inject late (some extensions announce after load).
    const t = setTimeout(rescan, 1500)
    return () => clearTimeout(t)
  }, [rescan])

  // Mirror the selected wallet's own events into the header state.
  useEffect(() => {
    const onAccounts = (...a: unknown[]) => setAccounts(Array.isArray(a[0]) ? (a[0] as string[]) : [])
    const onChain = (...a: unknown[]) => setChainId(typeof a[0] === 'string' ? a[0] : null)
    provider.on?.('accountsChanged', onAccounts)
    provider.on?.('chainChanged', onChain)
    return () => {
      provider.removeListener?.('accountsChanged', onAccounts)
      provider.removeListener?.('chainChanged', onChain)
    }
  }, [provider])

  // ── watch mode (?address= or env) ─────────────────────────────────────────
  const [watch, setWatch] = useState<string | null>(config.watchAddress)
  const [watchInput, setWatchInput] = useState('')
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('address')
    if (q && /^0x[0-9a-fA-F]{40}$/.test(q)) setWatch(q)
  }, [])

  const activeAddress = accounts[0] ?? watch ?? null

  // ── log ───────────────────────────────────────────────────────────────────
  const [lines, setLines] = useState<LogLine[]>([])
  const log = useCallback((line: LogLine | null) => setLines((ls) => pushLine(ls, line)), [])

  // ── embed ─────────────────────────────────────────────────────────────────
  const desk = useRef<PantessaDeskHandle>(null)
  const [embedReady, setEmbedReady] = useState(false)
  const onEmbedEvent = useCallback((name: string, data?: unknown) => log(lineForEvent(name, data)), [log])
  const onEmbedReady = useCallback(() => {
    setEmbedReady(true)
    log(appLine('EMBED', `pantessa chat ready · ${new URL(config.embedOrigin).host} · ${config.embedKey ? 'keyed' : 'keyless'}`, 'signed'))
  }, [log, config.embedOrigin, config.embedKey])

  const ask = useCallback(
    (text: string) => {
      desk.current?.ask(text)
      log(appLine('ASK', text, 'build'))
    },
    [log],
  )

  // ── portfolio ─────────────────────────────────────────────────────────────
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPortfolio(null)
    setError(null)
    setSamples(activeAddress ? loadSamples(activeAddress) : [])
  }, [activeAddress])

  const refresh = useCallback(async () => {
    if (!activeAddress) return
    setLoading(true)
    try {
      const res = await fetch(`/api/portfolio?address=${activeAddress}`, { cache: 'no-store' })
      const data = (await res.json()) as Portfolio | { error: string }
      if (!res.ok || 'error' in data) throw new Error('error' in data ? data.error : `HTTP ${res.status}`)
      setPortfolio(data)
      setError(null)
      setSamples((prev) => {
        const next = [...prev, { at: Date.now(), usd: data.totals.usd }].slice(-MAX_SAMPLES)
        saveSamples(activeAddress, next)
        return next
      })
      log(appLine('READ', `${data.positions.length} holdings · block ${data.block} · ${fmtUsd(data.totals.usd)}`, 'neutral'))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      log(appLine('RPC', message.slice(0, 90), 'bad'))
    } finally {
      setLoading(false)
    }
  }, [activeAddress, log])

  useEffect(() => {
    if (!activeAddress) return
    void refresh()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [activeAddress, refresh])

  // Re-read after money moves: a signed/settled turn is the trigger.
  useEffect(() => {
    const latest = lines[0]
    if (latest?.tone === 'signed' && latest.tag !== 'EMBED') {
      const t = setTimeout(() => void refresh(), 4_000)
      return () => clearTimeout(t)
    }
  }, [lines, refresh])

  // ── clock ─────────────────────────────────────────────────────────────────
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // ── derived ───────────────────────────────────────────────────────────────
  const onRobinhood = chainId?.toLowerCase() === ROBINHOOD_CHAIN_PARAMS.chainId
  const connected = accounts.length > 0
  const stocks = portfolio?.positions.filter((p) => p.kind === 'stock') ?? []
  const cash = portfolio?.positions.filter((p) => p.kind === 'stable') ?? []
  const first = samples[0]
  const last = samples[samples.length - 1]
  const pnl = first && last ? last.usd - first.usd : 0
  const pnlPct = first && first.usd > 0 ? (pnl / first.usd) * 100 : 0
  const gate = {
    connect: connected,
    ask: lines.some((l) => l.tag === 'ASK'),
    build: lines.some((l) => l.tag === 'BUILD'),
    sign: lines.some((l) => l.tag === 'SIGN' || l.tag === 'DONE'),
  }
  const moved = signedUsd(lines)
  const live = embedReady && !error

  // ── actions ───────────────────────────────────────────────────────────────
  const connect = async (w: DiscoveredWallet) => {
    setConnecting(true)
    try {
      const { accounts: acc, chainId: cid } = await connectWallet(w)
      await provider.use(w)
      setSelected(w)
      setAccounts(acc)
      setChainId(cid)
      log(appLine('WALLET', `${w.info.name} connected · ${acc[0] ? short(acc[0]) : 'no account'}${cid?.toLowerCase() === ROBINHOOD_CHAIN_PARAMS.chainId ? ' · robinhood chain' : ' · wrong chain'}`, 'signed'))
    } catch (err) {
      log(appLine('WALLET', `connect refused: ${(err as Error)?.message ?? err}`.slice(0, 90), 'warn'))
    } finally {
      setConnecting(false)
    }
  }
  const disconnect = async () => {
    await provider.use(null)
    setSelected(null)
    setAccounts([])
    setChainId(null)
    log(appLine('WALLET', 'disconnected on the host page', 'neutral'))
  }
  const submitWatch = (e: React.FormEvent) => {
    e.preventDefault()
    const v = watchInput.trim()
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) {
      setWatch(v)
      log(appLine('WATCH', `watching ${short(v)} (read-only)`, 'neutral'))
    }
  }

  return (
    <div className="desk">
      {/* ── header ── */}
      <header className="card top">
        <div className="brand">
          <div className="brand__mark" aria-hidden>
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <rect x="3" y="3" width="20" height="20" rx="4" stroke="#fff" strokeWidth="2" />
              <rect x="8" y="8" width="10" height="10" rx="2" fill="#fff" />
            </svg>
          </div>
          <div>
            <div className="brand__name">
              STOCK DESK
              <span>| {activeAddress ? short(activeAddress) : 'no wallet'}</span>
            </div>
            <div className="brand__sub">tokenized stocks · robinhood chain · pantessa embed example</div>
          </div>
        </div>
        <div className="top__right">
          <div className="wallets">
            {connected && selected ? (
              <>
                <span className="wallet wallet--on">
                  {selected.info.icon ? <img src={selected.info.icon} alt="" /> : null}
                  <span className="addr">{short(accounts[0])}</span>
                  <span className="label" style={{ color: onRobinhood ? 'var(--green)' : 'var(--amber)' }}>{onRobinhood ? 'RH chain' : 'switch chain'}</span>
                </span>
                <button type="button" className="chip" onClick={() => void disconnect()}>
                  disconnect
                </button>
              </>
            ) : wallets.length > 0 ? (
              wallets.map((w) => (
                <button key={w.info.uuid} type="button" className="wallet" disabled={connecting} onClick={() => void connect(w)} title={w.info.rdns}>
                  {w.info.icon ? <img src={w.info.icon} alt="" /> : null}
                  {connecting ? 'connecting…' : `connect ${w.info.name}`}
                </button>
              ))
            ) : (
              <button type="button" className="wallet" onClick={rescan} title="No injected wallet found — install one, then rescan">
                no wallet found · rescan
              </button>
            )}
          </div>
          <span className={`pill ${live ? 'pill--live' : 'pill--off'}`} title={embedReady ? 'embed ready' : 'embed loading'}>
            <i className="dot" /> {live ? 'live' : embedReady ? 'degraded' : 'booting'}
          </span>
          <span className="clock num">{now === null ? '--:--:--' : hhmmss(now)}</span>
        </div>
      </header>

      {/* ── tiles ── */}
      <section className="tiles">
        <div className="tile">
          <div className="label">portfolio / usd</div>
          <div className="tile__value num">{portfolio ? fmtUsd(portfolio.totals.usd) : '—'}</div>
          <div className="tile__sub">{portfolio ? `${stocks.length} stocks · block ${portfolio.block}` : activeAddress ? (loading ? 'reading the chain…' : error ? 'read failed' : '—') : 'connect or watch a wallet'}</div>
        </div>
        <div className="tile">
          <div className="label">session p&amp;l / usd</div>
          <div className={`tile__value num ${pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : ''}`}>{first && last ? `${pnl >= 0 ? '+' : '−'}${fmtUsd(Math.abs(pnl))}` : '—'}</div>
          <div className={`tile__sub ${pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : ''}`}>{first && last ? `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% since ${hhmm(first.at)}` : 'from the first sample'}</div>
        </div>
        <div className="tile">
          <div className="label">cash / usdg</div>
          <div className="tile__value num">{portfolio ? fmtUsd(portfolio.totals.cashUsd) : '—'}</div>
          <div className="tile__sub">{cash.length ? cash.map((c) => `${trimNum(Number(c.qty))} ${c.symbol}`).join(' · ') : 'no stables on 4663'}</div>
        </div>
        <div className="tile">
          <div className="label">gas / eth</div>
          <div className="tile__value num">{portfolio ? `${trimNum(Number(portfolio.eth.qty))} ETH` : '—'}</div>
          <div className="tile__sub">{portfolio?.eth.usd != null ? fmtUsd(portfolio.eth.usd) : 'priced via WETH → USDG'}</div>
        </div>
        <div className="tile">
          <div className="label">desk gate</div>
          <div className="tile__value" style={{ fontSize: 22, color: gate.sign ? 'var(--green)' : 'var(--ink)' }}>
            {gate.sign ? 'SIGNED' : gate.build ? 'BUILT' : gate.ask ? 'ASKED' : gate.connect ? 'CONNECTED' : 'IDLE'}
          </div>
          <div className="gate" aria-hidden>
            <i className={gate.connect ? 'on' : ''} />
            <i className={gate.ask ? 'on' : ''} />
            <i className={gate.build ? 'on' : ''} />
            <i className={gate.sign ? 'on' : ''} />
          </div>
          <div className="tile__sub">connect → ask → build → sign{moved > 0 ? ` · ${fmtUsd(moved)} moved` : ''}</div>
        </div>
      </section>

      {/* ── chart + log ── */}
      <section className="row2">
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">balance history</h2>
            <span className="card__meta">usd / {samples.length} samples / every {POLL_MS / 1000}s</span>
          </div>
          <ValueChart samples={samples} />
        </div>
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">activity log</h2>
            <span className="card__meta">{lines.length} events</span>
          </div>
          {lines[0] ? (
            <div className="log__lead">
              <b>{hhmm(lines[0].at)} {lines[0].tag}</b>
              <div>{lines[0].text}</div>
            </div>
          ) : null}
          <ul className="log">
            {lines.slice(1).map((l) => (
              <li key={l.id} className={`tone-${l.tone}`}>
                <time>{hhmm(l.at)}</time>
                <b>{l.tag}</b>
                <span className="t">{l.href ? <a href={l.href} target="_blank" rel="noopener noreferrer">{l.text}</a> : l.text}</span>
                <i className="d" />
              </li>
            ))}
            {lines.length === 0 && <li className="tone-neutral"><time>—</time><b>LOG</b><span className="t">waiting for the embed…</span><i className="d" /></li>}
          </ul>
        </div>
      </section>

      {/* ── holdings + THE DESK ── */}
      <section className="row3">
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">holdings</h2>
            <span className="card__meta">
              {activeAddress ? (
                <a href={`${EXPLORER_ADDRESS}${activeAddress}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
                  {short(activeAddress)} · explorer ↗
                </a>
              ) : (
                'nothing to read yet'
              )}
            </span>
          </div>
          {!activeAddress ? (
            <div className="empty">
              <p>Connect a wallet above, or watch any address read-only:</p>
              <form className="watch" onSubmit={submitWatch}>
                <input value={watchInput} onChange={(e) => setWatchInput(e.target.value)} placeholder="0x… a Robinhood Chain address" spellCheck={false} />
                <button type="submit" className="chip">watch</button>
              </form>
              <p style={{ marginTop: 12 }}>
                Watch mode reads balances and hands the address to the embed as <code>context</code>. Signing still needs a connected wallet.
              </p>
            </div>
          ) : portfolio && portfolio.positions.length === 0 ? (
            <div className="empty">
              <p>No holdings on Robinhood Chain yet. Fund it from the desk:</p>
              <div className="asks">
                <button type="button" className="ask" onClick={() => ask(prompts.fund(25))} disabled={!embedReady}>{prompts.fund(25)}</button>
                <button type="button" className="ask" onClick={() => ask(prompts.buyUsd('AAPL', 10))} disabled={!embedReady}>{prompts.buyUsd('AAPL', 10)}</button>
              </div>
            </div>
          ) : (
            <div className="tablewrap">
            <table className="holdings">
              <thead>
                <tr>
                  <th>asset</th>
                  <th className="r">qty</th>
                  <th className="r">price</th>
                  <th className="r">value</th>
                  <th>weight</th>
                  <th className="r">act</th>
                </tr>
              </thead>
              <tbody>
                {(portfolio?.positions ?? []).map((p) => (
                  <tr key={p.address}>
                    <td>
                      <span className="sym">{p.symbol}</span>
                      <span className="name">{p.name}</span>
                    </td>
                    <td className="r num mono">{trimNum(Number(p.qty))}</td>
                    <td className="r num mono">{p.price == null ? <span className="warn" title="no USDG pool answered">n/a</span> : fmtUsd(p.price)}</td>
                    <td className="r num mono">{p.price == null ? '—' : fmtUsd(p.usd)}</td>
                    <td>
                      <WeightBar weight={p.weight} />
                    </td>
                    <td className="r">
                      {p.kind === 'stock' ? (
                        <div className="acts">
                          <button type="button" className="chip chip--buy" disabled={!embedReady} onClick={() => ask(prompts.buyUsd(p.symbol, 10))} title={prompts.buyUsd(p.symbol, 10)}>+$10</button>
                          <button type="button" className="chip chip--sell" disabled={!embedReady} onClick={() => ask(prompts.sellQty(p.symbol, p.qty))} title={prompts.sellQty(p.symbol, p.qty)}>sell</button>
                          <button type="button" className="chip" disabled={!embedReady} onClick={() => ask(prompts.dcaWeekly(p.symbol, 10))} title={prompts.dcaWeekly(p.symbol, 10)}>dca</button>
                        </div>
                      ) : p.kind === 'stable' ? (
                        <div className="acts">
                          <button type="button" className="chip chip--buy" disabled={!embedReady} onClick={() => ask(prompts.buyUsd('AAPL', Math.min(10, Math.floor(p.usd))))}>buy stock</button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {loading && !portfolio && (
                  <tr>
                    <td colSpan={6} className="empty">reading {short(activeAddress)} on Robinhood Chain…</td>
                  </tr>
                )}
                {error && !portfolio && (
                  <tr>
                    <td colSpan={6} className="empty neg">{error}</td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          )}
          {portfolio?.totals.unpriced.length ? (
            <p className="tile__sub" style={{ marginTop: 10 }}>unpriced (no USDG pool): {portfolio.totals.unpriced.join(', ')}</p>
          ) : null}
        </div>

        <div className="card deskpanel">
          <div className="card__head">
            <h2 className="card__title">the desk</h2>
            <span className="card__meta">
              pantessa embed · {config.embedKey ? 'keyed' : 'keyless'} · {new URL(config.embedOrigin).host} · signs on this page
            </span>
          </div>
          <div className="asks">
            <button type="button" className="ask" disabled={!embedReady} onClick={() => ask(prompts.portfolio())}>{prompts.portfolio()}</button>
            <button type="button" className="ask" disabled={!embedReady} onClick={() => ask(prompts.buyUsd('AAPL', 10))}>{prompts.buyUsd('AAPL', 10)}</button>
            <button type="button" className="ask" disabled={!embedReady} onClick={() => ask(prompts.dcaWeekly('NVDA', 10))}>{prompts.dcaWeekly('NVDA', 10)}</button>
            <button type="button" className="ask" disabled={!embedReady} onClick={() => ask(prompts.rebalance())}>{prompts.rebalance()}</button>
            <button type="button" className="ask" disabled={!embedReady} onClick={() => ask(prompts.fund(25))}>{prompts.fund(25)}</button>
          </div>
          <PantessaDesk
            ref={desk}
            origin={config.embedOrigin}
            embedKey={config.embedKey}
            mcps={config.mcps}
            wallet={provider}
            theme="light"
            address={connected ? null : watch}
            onEvent={onEmbedEvent}
            onReady={onEmbedReady}
          />
        </div>
      </section>

      {/* ── roster ── */}
      <section className="roster">
        {ROSTER.map((a) => (
          <div key={a.id} className="card agent">
            <div className="agent__badge" style={{ background: a.color }}>{a.badge}</div>
            <div>
              <div className="agent__name">{a.name}</div>
              <div className="agent__role" style={{ color: a.color }}>{a.role} · <span className="mono" style={{ textTransform: 'none', letterSpacing: 0 }}>{a.id}</span></div>
              <div className="agent__desc">{a.desc}</div>
            </div>
          </div>
        ))}
      </section>

      <footer className="foot">
        <span>non-custodial · your wallet signs · reads are public chain data</span>
        <span>
          <a href="https://www.pantessa.com/docs/embed" target="_blank" rel="noopener noreferrer">embed docs</a>
          {' · '}
          <a href="https://www.npmjs.com/package/pantessa" target="_blank" rel="noopener noreferrer">npm i pantessa</a>
          {' · '}
          <a href="https://github.com/Pantessa/agent-examples" target="_blank" rel="noopener noreferrer">source</a>
        </span>
      </footer>
    </div>
  )
}
