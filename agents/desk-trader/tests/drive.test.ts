/**
 * The published `driveJob` against the mock desk — every artifact shape the
 * runner can offer, signed by the agent's own key, end to end over real HTTP.
 *
 * This is the file that proves "each leg went to the RIGHT signer path": a
 * single transaction and a transaction chain come back as raw transactions the
 * toy node can recover our address from, and a Hyperliquid action comes back as
 * a typed-data signature the relay recovers against THE BYTES IT SERVED. If a
 * driver ever signed the wrong thing — re-serialized an HL action, broadcast on
 * the wrong chain, posted a hash it never sent — one of these fails.
 *
 * It SKIPS until `pantessa@1.1.0` is installed (vitest.config.ts says so in the
 * run header). It never fakes a pass.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { recoverTransactionAddress, parseTransaction, type TransactionSerialized } from 'viem'
import { LEG_RESULT_KEYS } from 'pantessa/desk'
import { startMockDesk, type MockDesk, type MockScenario, type MockStep } from './mock-desk.js'

declare const __SDK_PRESENT__: boolean
const SDK_PRESENT = typeof __SDK_PRESENT__ === 'boolean' ? __SDK_PRESENT__ : false

const ACCOUNT = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')

let mock: MockDesk | null = null
afterEach(async () => {
  await mock?.close()
  mock = null
})

const hlTypedData = (nonce: number) => ({
  domain: { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: '0x0000000000000000000000000000000000000000' },
  types: { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
  primaryType: 'Agent',
  message: { source: 'a', connectionId: `0x${nonce.toString(16).padStart(64, '0')}` },
})

/** The C2 batch shape: `orderRequest.batch` at the TOP level, members tagged
 *  by kind, the `order` last. */
function batchStep(leverageNonce: number, orderNonce: number): MockStep {
  return {
    seq: 0,
    kind: 'sign',
    status: 'pending',
    builder: 'native-hl-exec',
    title: 'Set leverage, then long',
    valueUsd: 12,
    artifact: {
      summary: 'Set leverage, then long',
      orderRequest: {
        protocol: 'hyperliquid',
        expected: { coin: 'HYPE' },
        batch: [
          { kind: 'leverage', action: { type: 'updateLeverage' }, nonce: leverageNonce, typedData: hlTypedData(leverageNonce), expected: { coin: 'HYPE', leverage: 2 } },
          { kind: 'order', action: { type: 'order' }, nonce: orderNonce, typedData: hlTypedData(orderNonce), expected: { coin: 'HYPE', kind: 'long', isBuy: true } },
        ],
      },
    },
  }
}

function scenario(steps: MockStep[]): MockScenario {
  return { fundingVerdict: 'short', movableUsd: 0, askUsd: 12, fundingOptions: [], executeRefusal: null, steps }
}

async function drive(sc: MockScenario, over: Record<string, unknown> = {}) {
  mock = await startMockDesk(sc, ACCOUNT.address.toLowerCase())
  const { driveJob } = await import('pantessa/desk')
  const legs: unknown[] = []
  const outcome = await driveJob({
    base: mock.url,
    jobId: 'mockjob00000',
    token: 'mock-capability-token',
    signer: ACCOUNT,
    pollMs: 10,
    rpc: { 1: `${mock.url}/rpc/1`, 8453: `${mock.url}/rpc/8453`, 42161: `${mock.url}/rpc/42161` },
    onLeg: (l: unknown) => void legs.push(l),
    ...over,
  } as never)
  return { outcome, legs, mock: mock! }
}

describe.skipIf(!SDK_PRESENT)('driveJob against the mock desk', () => {
  it('signs a single transaction with the agent key and completes with its hash', async () => {
    const { outcome, mock: m } = await drive(
      scenario([
        {
          seq: 0,
          kind: 'sign',
          status: 'pending',
          builder: 'native-hl-exec',
          title: 'Deposit 13 USDC to Hyperliquid',
          valueUsd: 13,
          artifact: { summary: 'Deposit 13 USDC to Hyperliquid', txRequest: { to: '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7', data: '0xa9059cbb', value: '0x0', chainId: 42161 } },
        },
      ]),
    )

    expect(m.broadcasts).toHaveLength(1)
    const raw = m.broadcasts[0]!.raw as TransactionSerialized
    expect(m.broadcasts[0]!.chainId).toBe(42161)
    // The transaction the node received was signed by OUR key, for the target
    // the runner named — not a re-addressed one.
    expect((await recoverTransactionAddress({ serializedTransaction: raw })).toLowerCase()).toBe(ACCOUNT.address.toLowerCase())
    expect(parseTransaction(raw).to?.toLowerCase()).toBe('0x2df1c51e09aecf9cacb7bc98cb1742757f163df7')
    // And the completion carries the hash that was actually broadcast.
    expect(m.completes).toHaveLength(1)
    expect(m.completes[0]!.result.txHash).toBe(m.broadcasts[0]!.hash)
    expect((outcome as { status: string }).status).toBe('done')
  })

  it('walks a transaction chain in order and re-quotes the step that carries a recipe', async () => {
    const { mock: m } = await drive(
      scenario([
        {
          seq: 0,
          kind: 'sign',
          status: 'pending',
          builder: 'native-swap',
          title: 'Approve, then swap',
          valueUsd: 12,
          artifact: {
            summary: 'Approve, then swap',
            txChain: {
              refresh: { kind: 'swap', stepIndex: 1, params: { sell: 'USDC', buy: 'ETH' } },
              steps: [
                { title: 'Approve', tx: { to: '0x0000000000000000000000000000000000000a11', data: '0x095ea7b3', value: '0x0', chainId: 8453 } },
                { title: 'Swap', tx: { to: '0x00000000000000000000000000000000000005ad', data: '0xdead', value: '0x0', chainId: 8453 }, validUntil: Math.floor(Date.now() / 1000) + 300 },
              ],
            },
          },
        },
      ]),
    )

    expect(m.refreshes).toHaveLength(1)
    expect(m.refreshes[0]).toMatchObject({ kind: 'swap', sell: 'USDC', from: ACCOUNT.address })
    expect(m.broadcasts).toHaveLength(2)
    // Step 2 went out with the FRESH calldata the re-quote returned, not the
    // stale bytes the artifact was built with — the dead-calldata rule.
    expect(parseTransaction(m.broadcasts[1]!.raw as TransactionSerialized).to?.toLowerCase()).toBe('0x000000000000000000000000000000000000c0de')
    // The completion names the LAST hash in the chain.
    expect(m.completes[0]!.result.txHash).toBe(m.broadcasts[1]!.hash)
  })

  it('refuses a withheld re-quote rather than signing calldata that would revert', async () => {
    await expect(
      drive({
        ...scenario([
          {
            seq: 0,
            kind: 'sign',
            status: 'pending',
            builder: 'native-swap',
            title: 'Swap',
            valueUsd: 12,
            artifact: {
              summary: 'Swap',
              txChain: {
                refresh: { kind: 'swap', stepIndex: 0, params: {} },
                steps: [{ title: 'Swap', tx: { to: '0x00000000000000000000000000000000000005ad', data: '0xdead', value: '0x0', chainId: 8453 }, validUntil: Math.floor(Date.now() / 1000) + 300 }],
              },
            },
          },
        ]),
        refreshBlocked: true,
      }),
    ).rejects.toThrow(/withheld|revert/i)
    expect(mock!.broadcasts).toEqual([])
  })

  it('signs a Hyperliquid action as the exact bytes the runner served', async () => {
    const nonce = Date.now()
    const { mock: m } = await drive(
      scenario([
        {
          seq: 0,
          kind: 'sign',
          status: 'pending',
          builder: 'native-hl-exec',
          title: '2x Long $12 of HYPE',
          valueUsd: 12,
          artifact: {
            summary: '2x Long $12 of HYPE',
            orderRequest: {
              protocol: 'hyperliquid',
              typedData: hlTypedData(nonce),
              // jsonb sorted these keys; the driver must NOT re-serialize and
              // re-hash the action — it signs the typed data it was handed.
              hl: { action: { orders: [], type: 'order' }, nonce, expected: { coin: 'HYPE', kind: 'long', isBuy: true } },
            },
          },
        },
      ]),
    )

    expect(m.hlSubmits).toHaveLength(1)
    expect(m.hlSubmits[0]!.signer).toBe(ACCOUNT.address.toLowerCase())
    expect(m.hlSubmits[0]!.nonce).toBe(nonce)
    // The action went back to the relay unchanged, key order and all.
    expect(m.hlSubmits[0]!.action).toEqual({ orders: [], type: 'order' })
    expect(m.broadcasts).toEqual([])
  })

  it('signs a Hyperliquid batch in order, from the top-level orderRequest.batch', async () => {
    const a = Date.now()
    const b = a + 1
    const { mock: m } = await drive(scenario([batchStep(a, b)]))

    // Sequential nonces, in the order the venue must see them — the leverage
    // set first, the order last — one signature each, all ours.
    expect(m.hlSubmits.map((s) => s.nonce)).toEqual([a, b])
    expect(m.hlSubmits.every((s) => s.signer === ACCOUNT.address.toLowerCase())).toBe(true)
    expect(m.completes[0]!.result).toMatchObject({ batch: [{ ok: true }, { ok: true }] })
  })

  it('stops at the member the venue rejects, and POSTs the partial batch instead of throwing', async () => {
    const a = Date.now()
    const b = a + 1
    // The leverage set lands; the order is refused for margin.
    const { mock: m } = await drive({ ...scenario([batchStep(a, b)]), hlRejectNonce: b })

    expect(m.hlSubmits.map((s) => s.nonce)).toEqual([a, b])
    // The completion records WHICH member failed, so the runner can re-offer
    // from it — a thrown error would have lost that.
    const batch = (m.completes[0]!.result as { batch: Array<{ ok: boolean; error?: string }> }).batch
    expect(batch).toHaveLength(2)
    expect(batch[0]!.ok).toBe(true)
    expect(batch[1]!.ok).toBe(false)
    expect(batch[1]!.error).toMatch(/insufficient margin/)
    // And only the keys the runner accepts came back.
    expect(Object.keys(m.completes[0]!.result).every((k) => (LEG_RESULT_KEYS as readonly string[]).includes(k))).toBe(true)
  })

  it('classifies every leg and signs nothing in dryRun', async () => {
    const { outcome, legs, mock: m } = await drive(
      scenario([
        {
          seq: 0,
          kind: 'sign',
          status: 'pending',
          builder: 'native-hl-exec',
          title: 'Deposit 13 USDC to Hyperliquid',
          valueUsd: 13,
          artifact: { summary: 'Deposit 13 USDC to Hyperliquid', txRequest: { to: '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7', data: '0x', value: '0x0', chainId: 42161 } },
        },
      ]),
      { dryRun: true },
    )

    expect((outcome as { status: string }).status).toBe('dry')
    expect(legs).toHaveLength(1)
    expect(legs[0]).toMatchObject({ seq: 0, kind: 'tx', chainId: 42161, valueUsd: 13 })
    expect(m.broadcasts).toEqual([])
    expect(m.hlSubmits).toEqual([])
    expect(m.completes).toEqual([])
  })
})
