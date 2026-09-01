import { describe, it, expect } from 'vitest'
import { capRefusal, readRefusal, pickSlot, type FeedSlot } from '../lib/manager'

const slot = (over: Partial<FeedSlot> = {}): FeedSlot => ({ slotToken: 'abc123', kind: 'shape', mandate: 'tile my wallet 60% ETH, 40% USDC', capUsd: 100, ...over })

describe('capRefusal — the client-side fence (contract §4/§7.3)', () => {
  it('refuses an unpriced money ask before the server fail-closes', () => {
    expect(capRefusal(null, 100)).toMatch(/unpriceable/)
  })
  it('refuses an over-cap ask (an over-cap open benches the slot)', () => {
    expect(capRefusal(150, 100)).toMatch(/exceeds the slot cap/)
  })
  it('refuses a non-positive ask', () => {
    expect(capRefusal(0, 100)).toMatch(/positive/)
  })
  it('passes an at-cap and under-cap ask', () => {
    expect(capRefusal(100, 100)).toBeNull()
    expect(capRefusal(40, 100)).toBeNull()
  })
})

describe('readRefusal — honest slot-state reads (contract §5)', () => {
  it('reads FIRED as terminal', () => {
    expect(readRefusal('Refused at open: this desk identity was FIRED from its mandate slot. Fired is terminal.')).toBe('fired')
  })
  it('reads BENCHED', () => {
    expect(readRefusal("Refused at open: this desk identity's mandate slot is BENCHED (a cap breach benches immediately).")).toBe('benched')
  })
  it('reads a dead slot_token as a re-pull signal, not a state', () => {
    expect(readRefusal('No open listing matches this slot_token — it may have been unlisted, filled, or removed.')).toBe('dead-token')
  })
  it('everything else is other', () => {
    expect(readRefusal('some other message')).toBe('other')
  })
})

describe('pickSlot — kind preference, idle on empty', () => {
  it('idles (null) on an empty feed', () => {
    expect(pickSlot([])).toBeNull()
  })
  it('prefers the requested kind', () => {
    const chosen = pickSlot([slot({ kind: 'shape', slotToken: 's' }), slot({ kind: 'dca', slotToken: 'd' })], 'dca')
    expect(chosen?.slotToken).toBe('d')
  })
  it('falls back to the newest when no kind matches', () => {
    expect(pickSlot([slot({ slotToken: 'first' })], 'yield')?.slotToken).toBe('first')
  })
})
