import { describe, it, expect } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { recoverMessageAddress } from 'viem'
import { parseMcpBody, deskExecuteConsentMessage, tokenFromDriveUrl, Desk, DeskRefusal } from '../src/desk.js'
import { pickOption } from '../src/agent.js'
import { loadConfig, DEFAULT_ASK } from '../src/config.js'
import type { BrokerPlan } from '../src/desk.js'

const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const ACCOUNT = privateKeyToAccount(KEY)

describe('the consent text', () => {
  // The desk recovers the signer from these exact bytes. A stray character
  // here and every broker_execute this example makes is refused, so the
  // string is pinned literally rather than rebuilt from the same helper.
  const EXPECTED = [
    'Pantessa agent desk — execute consent',
    'Intent: abc123',
    'Wallet: 0x1234567890abcdef1234567890abcdef12345678',
    "Signing lets the desk compile this intent into a job owned by this wallet. It moves nothing by itself; every leg still needs this wallet's own signature.",
  ].join('\n')

  it('is byte-identical to the desk\'s own deskExecuteConsentMessage', () => {
    expect(deskExecuteConsentMessage('abc123', '0x1234567890ABCDEF1234567890abcdef12345678')).toBe(EXPECTED)
  })

  it('carries an em dash, an ASCII apostrophe, and a lowercased wallet', () => {
    const msg = deskExecuteConsentMessage('i', '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(msg).toContain('—') // em dash, not a hyphen
    expect(msg).toContain("wallet's") // ASCII apostrophe, not U+2019
    expect(msg).not.toContain('’')
    expect(msg).toContain('Wallet: 0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  })

  it('recovers to the signing agent and to nobody else', async () => {
    const message = deskExecuteConsentMessage('xyz', ACCOUNT.address)
    const signature = await ACCOUNT.signMessage({ message })
    expect((await recoverMessageAddress({ message, signature })).toLowerCase()).toBe(ACCOUNT.address.toLowerCase())
    // The same signature over a DIFFERENT intent must not recover to us —
    // that is what makes the consent single-use and intent-bound.
    const other = deskExecuteConsentMessage('zyx', ACCOUNT.address)
    expect((await recoverMessageAddress({ message: other, signature })).toLowerCase()).not.toBe(ACCOUNT.address.toLowerCase())
  })
})

describe('the MCP framing', () => {
  it('reads an SSE-framed reply', () => {
    expect(parseMcpBody('event: message\ndata: {"result":{"ok":true}}\n\n')).toEqual({ result: { ok: true } })
  })
  it('reads a plain JSON reply', () => {
    expect(parseMcpBody('{"result":{"ok":true}}')).toEqual({ result: { ok: true } })
  })
  it('refuses a framing it does not recognise', () => {
    expect(() => parseMcpBody('<html>nope</html>')).toThrow(/Unrecognized MCP response framing/)
  })
})

describe('the capability token', () => {
  it('comes out of the drive URL the desk hands back', () => {
    expect(tokenFromDriveUrl('https://www.pantessa.com/api/jobs/abc?t=v2.123.deadbeef')).toBe('v2.123.deadbeef')
  })
  it('refuses a drive URL with no token rather than driving anonymously', () => {
    expect(() => tokenFromDriveUrl('https://www.pantessa.com/api/jobs/abc')).toThrow(/No capability token/)
  })
})

describe('a tool refusal', () => {
  it('arrives as isError + a sentence, and becomes a DeskRefusal', async () => {
    const desk = new Desk({
      base: 'http://desk.invalid',
      fetchImpl: async () =>
        new Response('event: message\ndata: {"result":{"content":[{"type":"text","text":"it is a single-step ask"}],"isError":true}}\n\n', { status: 200 }),
    })
    await expect(desk.execute('i', '0x' + '11'.repeat(65))).rejects.toBeInstanceOf(DeskRefusal)
    await expect(desk.execute('i', '0x' + '11'.repeat(65))).rejects.toThrow(/single-step ask/)
  })
})

function planWith(options: BrokerPlan['options']): BrokerPlan {
  return { ask: 'a', quote: { gate: 'g', kind: 'action', mcps: [] }, options, say: '' }
}

describe('picking the route', () => {
  const funding = { id: 'fund-1', label: 'Just enough', resume: 'Fund it, then do it', kind: 'funding' as const }
  const proceed = { id: 'proceed', label: 'Proceed as asked', resume: 'a', kind: 'restate' as const }
  const decline = { id: 'decline', label: 'Walk away', resume: 'Never mind', kind: 'decline' as const }

  it('takes the first funding route when the wallet is short', () => {
    expect(pickOption(planWith([funding, proceed, decline]), null).id).toBe('fund-1')
  })
  it('proceeds when the desk offers no funding route', () => {
    expect(pickOption(planWith([proceed, decline]), null).id).toBe('proceed')
  })
  it('never walks away on its own', () => {
    expect(pickOption(planWith([decline, proceed]), null).id).toBe('proceed')
  })
  it('honours --option N verbatim', () => {
    expect(pickOption(planWith([funding, proceed, decline]), 2).id).toBe('decline')
  })
  it('stops rather than improvising when --option N is out of range', () => {
    expect(() => pickOption(planWith([proceed]), 7)).toThrow(/out of range/)
  })
})

describe('the config', () => {
  it('runs dry against production on a fresh key when nothing is set', () => {
    const cfg = loadConfig({} as NodeJS.ProcessEnv, [])
    expect(cfg.live).toBe(false)
    expect(cfg.bringsOwnKey).toBe(false)
    expect(cfg.base).toBe('https://www.pantessa.com')
    expect(cfg.ask).toBe(DEFAULT_ASK)
    expect(cfg.account.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    // A generated wallet gets its own desk identity so throwaway runs never
    // pile onto somebody else's public track record.
    expect(cfg.agentKey).toContain(cfg.account.address.slice(2, 12).toLowerCase())
  })

  it('reads the key, the base, the ask and LIVE from the environment', () => {
    const cfg = loadConfig({ AGENT_KEY: KEY, PANTESSA_BASE: 'http://localhost:3860/', ASK: 'Buy $5 of ETH on base', LIVE: '1' } as NodeJS.ProcessEnv, [])
    expect(cfg.account.address).toBe(ACCOUNT.address)
    expect(cfg.bringsOwnKey).toBe(true)
    expect(cfg.base).toBe('http://localhost:3860')
    expect(cfg.ask).toBe('Buy $5 of ETH on base')
    expect(cfg.live).toBe(true)
  })

  it('takes a 0x-less key and both --flag forms', () => {
    const cfg = loadConfig({ AGENT_KEY: KEY.slice(2) } as NodeJS.ProcessEnv, ['--ask', 'x', '--option=3'])
    expect(cfg.account.address).toBe(ACCOUNT.address)
    expect(cfg.ask).toBe('x')
    expect(cfg.optionIndex).toBe(3)
  })

  it('defaults to the sequenced ask, because a one-legged ask cannot reach the agent-signed path', () => {
    // broker_execute compiles SEQUENCED flows only: a bare "2x long $12 of
    // HYPE" is one step and the desk refuses it by name (measured on prod).
    expect(DEFAULT_ASK).toMatch(/, then /)
    expect(DEFAULT_ASK).toMatch(/Hyperliquid/i)
  })
})
