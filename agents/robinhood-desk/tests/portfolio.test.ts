import { describe, expect, it } from 'vitest'
import { bestUsd, buildPortfolio, prompts, qtyNum, trimNum } from '@/lib/portfolio'
import { MONEY_TOKENS, stocksFromList } from '@/lib/tokens'

const AAPL = { address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9' as const, symbol: 'AAPL', name: 'Apple', decimals: 18, kind: 'stock' as const }
const USDG = MONEY_TOKENS.find((t) => t.symbol === 'USDG')!
const WETH = MONEY_TOKENS.find((t) => t.kind === 'gas')!
const ADDR = '0x8aa7A1dFA6635AF2979dA4D2bDd51780842e3F99' as const

describe('buildPortfolio', () => {
  it('prices stocks off the best USDG quote, stables 1:1, weights sum to 1', () => {
    const p = buildPortfolio(
      ADDR,
      [
        { token: AAPL, balance: 2n * 10n ** 18n, quotes: [320_000_000n, 321_500_000n] }, // 2 AAPL @ best $321.50
        { token: USDG, balance: 50_000_000n, quotes: [] }, // 50 USDG
        { token: WETH, balance: 0n, quotes: [4_000_000_000n] }, // held 0 → dropped
      ],
      { balance: 10n ** 16n, quotes: [4_000_000_000n] }, // 0.01 ETH @ $4000
      123n,
      new Date('2026-09-07T10:00:00Z'),
    )
    expect(p.positions.map((x) => x.symbol)).toEqual(['AAPL', 'USDG'])
    expect(p.positions[0].price).toBe(321.5)
    expect(p.positions[0].usd).toBe(643)
    expect(p.positions[1].price).toBe(1)
    expect(p.eth.usd).toBe(40)
    expect(p.totals.usd).toBe(733)
    expect(p.totals.stocksUsd).toBe(643)
    expect(p.totals.cashUsd).toBe(50)
    const w = p.positions.reduce((s, x) => s + x.weight, 0) + 40 / 733
    expect(w).toBeCloseTo(1, 9)
    expect(p.block).toBe('123')
    expect(p.chainId).toBe(4663)
  })

  it('names unpriced holdings instead of counting them at zero silently', () => {
    const p = buildPortfolio(ADDR, [{ token: AAPL, balance: 10n ** 18n, quotes: [] }], { balance: 0n, quotes: [] }, 1n)
    expect(p.positions[0].price).toBeNull()
    expect(p.positions[0].usd).toBe(0)
    expect(p.totals.unpriced).toEqual(['AAPL'])
    expect(p.eth.usd).toBeNull()
  })

  it('bestUsd picks the deepest pool', () => {
    expect(bestUsd([1_000_000n, 3_000_000n, 2_000_000n])).toBe(3)
    expect(bestUsd([])).toBeNull()
  })
})

describe('stocksFromList', () => {
  it('keeps only chain 4663, drops the money tokens, dedupes, sorts', () => {
    const out = stocksFromList([
      { chainId: 1, address: '0x1111111111111111111111111111111111111111', symbol: 'ETHX', decimals: 18 },
      { chainId: 4663, address: USDG.address, symbol: 'USDG', decimals: 6 },
      { chainId: 4663, address: AAPL.address, symbol: 'AAPL', name: 'Apple', decimals: 18 },
      { chainId: 4663, address: AAPL.address.toLowerCase(), symbol: 'AAPL', name: 'Apple dup', decimals: 18 },
      { chainId: 4663, address: '0x2222222222222222222222222222222222222222', symbol: 'AMD', decimals: 18 },
      { chainId: 4663, address: 'not-an-address', symbol: 'BAD', decimals: 18 },
    ])
    expect(out.map((t) => t.symbol)).toEqual(['AAPL', 'AMD'])
    expect(out[0].name).toBe('Apple')
    expect(out.every((t) => t.kind === 'stock')).toBe(true)
  })
})

describe('prompts — the exact sentences the Pantessa stock layer parses', () => {
  it('pins the grammar', () => {
    expect(prompts.buyUsd('AAPL', 10)).toBe('Buy $10 of AAPL on Robinhood Chain')
    expect(prompts.buyUsd('NVDA', 12.5)).toBe('Buy $12.5 of NVDA on Robinhood Chain')
    expect(prompts.sellQty('AAPL', '0.5')).toBe('Sell 0.5 AAPL for USDG on Robinhood Chain')
    expect(prompts.sellQty('AAPL', '54.837814768582694337')).toBe('Sell 54.8378 AAPL for USDG on Robinhood Chain')
    expect(qtyNum(2)).toBe('2')
    expect(prompts.dcaWeekly('NVDA', 10)).toBe('Buy $10 of NVDA every week on Robinhood Chain')
    expect(prompts.fund(25)).toBe('I need $25 of USDG on Robinhood Chain')
    expect(prompts.portfolio()).toBe('Show my portfolio on Robinhood Chain')
    expect(prompts.rebalance()).toBe('Rebalance my portfolio on Robinhood Chain')
  })
  it('trimNum never emits scientific notation or trailing zeros', () => {
    expect(trimNum(10)).toBe('10')
    expect(trimNum(12.5)).toBe('12.5')
    expect(trimNum(0.123456)).toBe('0.1235')
    expect(trimNum(1e-7)).toBe('0')
    expect(trimNum(NaN)).toBe('0')
  })
})
