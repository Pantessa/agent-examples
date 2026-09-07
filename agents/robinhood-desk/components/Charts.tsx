'use client'

// Hand-rolled SVG — no charting dependency in a five-line-install example.

export interface Sample {
  at: number
  usd: number
}

const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
export const fmtUsd = (n: number, digits = 2) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })

/** Portfolio value over the samples this desk has taken (session history). */
export function ValueChart({ samples }: { samples: Sample[] }) {
  if (samples.length < 2) {
    return (
      <div className="chart__empty">
        {samples.length === 0 ? 'no samples yet — connect or watch a wallet' : 'one sample — the line starts on the next refresh'}
      </div>
    )
  }
  const W = 900
  const H = 260
  const padL = 56
  const padR = 64
  const padT = 18
  const padB = 28
  const xs = samples.map((s) => s.at)
  const ys = samples.map((s) => s.usd)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const yLo = yMin === yMax ? yMin * 0.98 : yMin - (yMax - yMin) * 0.15
  const yHi = yMin === yMax ? yMax * 1.02 || 1 : yMax + (yMax - yMin) * 0.15
  const sx = (t: number) => padL + ((t - x0) / Math.max(1, x1 - x0)) * (W - padL - padR)
  const sy = (v: number) => padT + (1 - (v - yLo) / Math.max(1e-9, yHi - yLo)) * (H - padT - padB)
  const pts = samples.map((s) => [sx(s.at), sy(s.usd)] as const)
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${path} L${pts[pts.length - 1][0].toFixed(1)},${(H - padB).toFixed(1)} L${pts[0][0].toFixed(1)},${(H - padB).toFixed(1)} Z`
  const last = samples[samples.length - 1]
  const [lx, ly] = pts[pts.length - 1]
  const ticks = [yHi, (yHi + yLo) / 2, yLo]
  const up = last.usd >= samples[0].usd
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" preserveAspectRatio="none" role="img" aria-label="portfolio value">
      {ticks.map((v, i) => {
        const y = sy(v)
        return (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--line)" strokeDasharray="2 4" />
            <text x={padL - 8} y={y + 3} textAnchor="end" className="chart__axis">
              {fmtUsd(v, 0)}
            </text>
          </g>
        )
      })}
      <path d={area} fill={up ? 'var(--green-soft)' : 'var(--red-soft)'} opacity={0.9} />
      <path d={path} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={9} fill={up ? 'var(--green)' : 'var(--red)'} opacity={0.15} />
      <circle cx={lx} cy={ly} r={4} fill={up ? 'var(--green)' : 'var(--red)'} />
      <rect x={Math.min(lx + 10, W - padR + 4)} y={ly - 11} width={58} height={20} rx={3} fill="var(--card)" stroke="var(--red)" />
      <text x={Math.min(lx + 39, W - padR + 33)} y={ly + 3} textAnchor="middle" className="chart__last">
        {fmtUsd(last.usd, 0)}
      </text>
      <text x={padL} y={H - 8} className="chart__axis">
        {fmtTime(samples[0].at)}
      </text>
      <text x={W - padR} y={H - 8} textAnchor="end" className="chart__axis">
        {fmtTime(last.at)}
      </text>
    </svg>
  )
}

/** Horizontal weight bar for a holdings row. */
export function WeightBar({ weight }: { weight: number }) {
  return (
    <div className="bar" title={`${(weight * 100).toFixed(1)}%`}>
      <i style={{ width: `${Math.max(1, Math.min(100, weight * 100)).toFixed(1)}%` }} />
    </div>
  )
}
