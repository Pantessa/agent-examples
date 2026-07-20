import { describe, it, expect, vi } from 'vitest'
import { heldOnDestination, runLazyTrade } from '@/lib/agent'
import type { FetchLike } from '@/lib/mcp'

// A fake MCP server: dispatches tools/call POSTs by tool name and answers in
// the fleet's ok() shape. Fully offline.
function mockMcp(handlers: Record<string, (args: Record<string, unknown>) => unknown>): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = []
  const fetchLike: FetchLike = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { params: { name: string; arguments: Record<string, unknown> } }
    const tool = body.params.name
    calls.push(tool)
    const handler = handlers[tool]
    if (!handler) throw new Error(`unexpected tool call: ${tool}`)
    const payload = handler(body.params.arguments)
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(payload) }] } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  return { fetch: fetchLike, calls }
}

const scanWith = (sources: Array<{ chain: string; token: string; balance: number; usd: number }>) => ({
  sources,
  readChains: ['Base', 'Arbitrum', 'Ethereum'],
  failedChains: [],
})

describe('heldOnDestination', () => {
  it('sums only the destination chain + goal token, case-insensitive', () => {
    const scan = scanWith([
      { chain: 'Base', token: 'USDC', balance: 12, usd: 12 },
      { chain: 'Arbitrum', token: 'USDC', balance: 0.5, usd: 0.5 },
      { chain: 'Arbitrum', token: 'ETH', balance: 0.001, usd: 1.9 },
    ])
    expect(heldOnDestination(scan, 'Arbitrum', 'usdc')).toBe(0.5)
    expect(heldOnDestination(scan, 'Ethereum', 'USDC')).toBe(0)
  })
})

describe('runLazyTrade (dry-run, offline)', () => {
  it('scan → shortfall → fund_and_build → builds every leg, signs NOTHING', async () => {
    const signLeg = vi.fn()
    const { fetch: mcp, calls } = mockMcp({
      scan_funding_sources: () => scanWith([{ chain: 'Base', token: 'USDC', balance: 12, usd: 12 }]),
      fund_and_build: (args) => {
        expect(args.amount).toBe(2) // the SHORTFALL (goal 2, held 0), not the goal
        expect(args.finalAction).toBe('supply it to Aave')
        return {
          plan: { kind: 'offer' },
          runbook: {
            option: 'Just enough (~$3.50 of USDC on Base)',
            yeetfulResume: 'Swap 3.5 USDC from Base to USDC on Arbitrum',
            steps: [
              { step: 1, kind: 'build', tool: 'build_swap', params: { originChain: 'Base', originToken: 'USDC', destinationChain: 'Arbitrum', destinationToken: 'USDC', amount: '3.5', from: '$USER_ADDRESS' }, note: '' },
              { step: 2, kind: 'notify', tool: 'submit_deposit_tx', note: '' },
              { step: 3, kind: 'await', tool: 'await_completion', note: '' },
              { step: 4, kind: 'act', note: 'Funds have landed — now do the thing this was for: supply it to Aave' },
            ],
          },
        }
      },
      build_swap: (args) => {
        expect(args.from).toMatch(/^0x[0-9a-fA-F]{40}$/) // placeholder resolved to a real address
        return {
          kind: 'swap_ready',
          deposit: { address: '0xdep0000000000000000000000000000000000000', chain: 'Base', exactAmount: '3.5 USDC', addressExpires: null },
          balanceCheck: { ok: true, note: 'Wallet holds enough.' },
          steps: [{ action: 'send_transaction', summary: 'Transfer 3.5 USDC to the one-time deposit address', tx: { to: '0xdep', data: '0x', value: '0', chainId: 8453 } }],
        }
      },
    })

    const result = await runLazyTrade(
      { chain: 'arbitrum', token: 'USDC', amount: 2, finalAction: 'supply it to Aave' },
      { freeFetch: mcp, paidFetch: mcp, signLeg },
    )

    expect(result.mode).toBe('dry-run')
    expect(result.goalMet).toBe(false)
    expect(signLeg).not.toHaveBeenCalled()
    // notify/await are skipped in dry-run; no verification re-scan.
    expect(calls).toEqual(['scan_funding_sources', 'fund_and_build', 'build_swap'])
    const labels = result.steps.map((s) => s.label)
    expect(labels).toEqual(['mode', 'scan', 'shortfall', 'runbook', 'build', 'dry-run', 'act', 'done'])
  })

  it('goal already met → no funding calls at all', async () => {
    const { fetch: mcp, calls } = mockMcp({
      scan_funding_sources: () => scanWith([{ chain: 'Arbitrum', token: 'USDC', balance: 5, usd: 5 }]),
    })
    const result = await runLazyTrade({ chain: 'Arbitrum', token: 'USDC', amount: 2 }, { freeFetch: mcp, paidFetch: mcp })
    expect(result.goalMet).toBe(true)
    expect(calls).toEqual(['scan_funding_sources'])
    expect(result.steps.map((s) => s.label)).toEqual(['mode', 'scan', 'goal'])
  })

  it('honest shortfall (runbook null) ends the run without inventing a route', async () => {
    const { fetch: mcp } = mockMcp({
      scan_funding_sources: () => scanWith([]),
      fund_and_build: () => ({ plan: { kind: 'short', note: 'Movable funds seen: none. The smallest plan moves ~$3.50.' }, runbook: null }),
    })
    const result = await runLazyTrade({ chain: 'Base', token: 'USDC', amount: 3 }, { freeFetch: mcp, paidFetch: mcp })
    expect(result.goalMet).toBe(false)
    const short = result.steps.find((s) => s.label === 'short')
    expect(short?.detail).toContain('smallest plan')
  })

  it('rejects unknown goal chains loudly', async () => {
    await expect(runLazyTrade({ chain: 'solana', token: 'USDC', amount: 1 })).rejects.toThrow(/Unknown goal chain/)
  })
})
