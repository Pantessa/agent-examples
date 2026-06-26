import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { decodeProtectedHeader, decodeJwt, jwtVerify, importSPKI } from 'jose'
import { mintJwt, buildOrderConfig, placeOrder } from '@/lib/coinbase'

// A throwaway P-256 keypair in SEC1 PEM — the format CDP issues for ECDSA keys.
function ecKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'sec1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  return { privateKey, publicKey }
}

describe('Advanced Trade JWT', () => {
  const keyName = 'organizations/org-123/apiKeys/key-abc'

  it('mints an ES256 JWT bound to method+host+path with the CDP claims', async () => {
    const { privateKey, publicKey } = ecKeys()
    const jwt = await mintJwt({ keyName, privateKey }, 'GET', '/api/v3/brokerage/accounts')

    const header = decodeProtectedHeader(jwt)
    expect(header.alg).toBe('ES256')
    expect(header.kid).toBe(keyName)
    expect(header.typ).toBe('JWT')
    expect(typeof header.nonce).toBe('string')
    expect((header.nonce as string).length).toBeGreaterThan(0)

    const claims = decodeJwt(jwt)
    expect(claims.iss).toBe('cdp')
    expect(claims.sub).toBe(keyName)
    expect(claims.uri).toBe('GET api.coinbase.com/api/v3/brokerage/accounts')
    // Token is short-lived: 120s window.
    expect((claims.exp as number) - (claims.nbf as number)).toBe(120)

    // And it actually verifies against the public key.
    const verified = await jwtVerify(jwt, await importSPKI(publicKey, 'ES256'))
    expect(verified.payload.sub).toBe(keyName)
  })

  it('uses a fresh nonce per call', async () => {
    const { privateKey } = ecKeys()
    const a = decodeProtectedHeader(await mintJwt({ keyName, privateKey }, 'GET', '/x'))
    const b = decodeProtectedHeader(await mintJwt({ keyName, privateKey }, 'GET', '/x'))
    expect(a.nonce).not.toBe(b.nonce)
  })
})

describe('order config builder', () => {
  it('builds a GTC limit order', () => {
    const cfg = buildOrderConfig({ productId: 'BTC-USD', side: 'BUY', type: 'LIMIT', baseSize: '0.001', limitPrice: '60000' })
    expect(cfg).toEqual({ limit_limit_gtc: { base_size: '0.001', limit_price: '60000', post_only: false } })
  })

  it('builds a market BUY from quote size', () => {
    const cfg = buildOrderConfig({ productId: 'BTC-USD', side: 'BUY', type: 'MARKET', quoteSize: '25' })
    expect(cfg).toEqual({ market_market_ioc: { quote_size: '25' } })
  })

  it('builds a market SELL from base size', () => {
    const cfg = buildOrderConfig({ productId: 'BTC-USD', side: 'SELL', type: 'MARKET', baseSize: '0.001' })
    expect(cfg).toEqual({ market_market_ioc: { base_size: '0.001' } })
  })

  it('rejects a limit order missing price', () => {
    expect(() => buildOrderConfig({ productId: 'BTC-USD', side: 'BUY', type: 'LIMIT', baseSize: '0.001' })).toThrow()
  })
})

describe('LIVE gate', () => {
  it('previews (never places) an order when LIVE is unset', async () => {
    delete process.env.LIVE
    const res = await placeOrder({ productId: 'BTC-USD', side: 'BUY', type: 'LIMIT', baseSize: '0.001', limitPrice: '60000' })
    expect(res.placed).toBe(false)
    expect(res.status).toBe('preview')
    expect(res.config).toEqual({ limit_limit_gtc: { base_size: '0.001', limit_price: '60000', post_only: false } })
  })
})
