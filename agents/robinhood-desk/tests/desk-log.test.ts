import { describe, expect, it } from 'vitest'
import { appLine, lineForEvent, pushLine, signedUsd, MAX_LINES } from '@/lib/desk-log'

describe('lineForEvent — the embed contract → log lines', () => {
  it('maps every turn outcome the embed reports', () => {
    expect(lineForEvent('turn', { outcome: 'answered' })?.tag).toBe('REPLY')
    const built = lineForEvent('turn', { outcome: 'tx-built', artifact: 'tx-chain', valueUsd: 10 })!
    expect(built.tag).toBe('BUILD')
    expect(built.tone).toBe('build')
    expect(built.text).toContain('transaction chain')
    expect(built.text).toContain('$10.00')
    const signed = lineForEvent('turn', { outcome: 'signed', artifact: 'tx', valueUsd: 9.5, txUrl: 'https://robinhoodchain.blockscout.com/tx/0xabc', chainId: 4663 })!
    expect(signed.tag).toBe('SIGN')
    expect(signed.tone).toBe('signed')
    expect(signed.href).toBe('https://robinhoodchain.blockscout.com/tx/0xabc')
    expect(lineForEvent('turn', { outcome: 'settled', jobId: 'j1', jobStatus: 'done' })?.tag).toBe('DONE')
    expect(lineForEvent('turn', { outcome: 'clarify' })?.tone).toBe('warn')
    expect(lineForEvent('turn', { outcome: 'refused' })?.tag).toBe('HELD')
    expect(lineForEvent('turn', { outcome: 'credit-gate' })?.tag).toBe('PLAN')
    expect(lineForEvent('turn', { outcome: 'error' })?.tone).toBe('bad')
    expect(lineForEvent('turn', { outcome: 'something-new' })?.text).toBe('something-new')
  })
  it('order-signed carries the receipt link; unknown events are still logged', () => {
    const l = lineForEvent('order-signed', { artifact: 'cow-order', valueUsd: 50, txUrl: 'https://explorer.cow.fi/x' })!
    expect(l.tag).toBe('SIGN')
    expect(l.text).toContain('CoW order signed')
    expect(l.href).toContain('explorer.cow.fi')
    expect(lineForEvent('future-event', undefined)?.tag).toBe('EMBED')
  })
})

describe('pushLine / signedUsd', () => {
  it('prepends, caps, and sums signed money only', () => {
    let lines = pushLine([], appLine('ASK', 'Buy $10 of AAPL', 'build'))
    lines = pushLine(lines, lineForEvent('turn', { outcome: 'signed', artifact: 'tx', valueUsd: 9.9 }))
    lines = pushLine(lines, lineForEvent('turn', { outcome: 'tx-built', artifact: 'tx', valueUsd: 100 }))
    lines = pushLine(lines, null)
    expect(lines[0].tag).toBe('BUILD')
    expect(signedUsd(lines)).toBe(9.9)
    for (let i = 0; i < MAX_LINES + 5; i++) lines = pushLine(lines, appLine('X', 'y'))
    expect(lines.length).toBe(MAX_LINES)
  })
})
