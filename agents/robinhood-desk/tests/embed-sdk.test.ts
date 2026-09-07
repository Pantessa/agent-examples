// @vitest-environment jsdom
//
// The SDK-still-works check. Mounts the PUBLISHED `pantessa/embed` exactly the
// way the desk does (inline, scoped MCPs, key, light theme, a host-side
// provider) and asserts the wire the Pantessa /embed route expects: URL
// params, the origin-checked 'ready' handshake, the wallet announce, and the
// RPC relay + its allowlist. If the SDK or the contract drifts, this fails
// before a visitor does.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountPantessaChat, DEFAULT_EMBED_ORIGIN, type PantessaChatHandle } from 'pantessa/embed'
import { createSwitchingProvider, type DiscoveredWallet } from '@/lib/wallet'
import { DESK_MCPS } from '@/lib/config'

const ORIGIN = DEFAULT_EMBED_ORIGIN
const SRC = 'yeetful-embed'
const ACCOUNT = '0x8aa7A1dFA6635AF2979dA4D2bDd51780842e3F99'
const flush = () => new Promise<void>((r) => setTimeout(r, 0))
const dispatch = (data: unknown, origin = ORIGIN) => window.dispatchEvent(new MessageEvent('message', { origin, data }))

function fakeWallet(name = 'Mock'): DiscoveredWallet {
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>()
  return {
    info: { uuid: name, name, icon: '', rdns: `test.${name}` },
    provider: {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ACCOUNT]
        if (method === 'eth_chainId') return '0x1237'
        if (method === 'eth_blockNumber') return '0x10'
        return null
      }),
      on: (e, fn) => {
        if (!listeners.has(e)) listeners.set(e, new Set())
        listeners.get(e)!.add(fn)
      },
      removeListener: (e, fn) => listeners.get(e)?.delete(fn),
    },
  }
}

const handles: PantessaChatHandle[] = []
afterEach(() => {
  for (const h of handles.splice(0)) h.destroy()
  document.body.innerHTML = ''
})

describe('pantessa/embed × the desk', () => {
  it('builds the /embed URL the way the docs promise', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const h = mountPantessaChat({ container, mode: 'inline', mcps: [...DESK_MCPS], key: 'yfe_test', theme: 'light', wallet: false })
    handles.push(h)
    const url = new URL(h.iframe.src)
    expect(url.origin).toBe(ORIGIN)
    expect(url.pathname).toBe('/embed')
    expect(url.searchParams.get('mcps')).toBe(DESK_MCPS.join(','))
    expect(url.searchParams.get('key')).toBe('yfe_test')
    expect(url.searchParams.get('theme')).toBe('light')
    expect(url.searchParams.get('host')).toBe(window.location.origin)
    expect(url.searchParams.get('page')).toBe(window.location.href)
    expect(h.iframe.title).toBe('Pantessa chat')
  })

  it('announces the host wallet after ready, and re-announces when the switching provider changes wallets', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const provider = createSwitchingProvider()
    const h = mountPantessaChat({ container, mode: 'inline', mcps: [...DESK_MCPS], wallet: provider })
    handles.push(h)
    const posted: Array<Record<string, unknown>> = []
    const spy = vi.spyOn(h.iframe.contentWindow!, 'postMessage').mockImplementation((msg) => {
      posted.push(msg as Record<string, unknown>)
    })

    // A message from a foreign origin is ignored (the origin fence).
    dispatch({ source: SRC, v: 1, type: 'ready' }, 'https://evil.example')
    await flush()
    expect(posted).toHaveLength(0)

    dispatch({ source: SRC, v: 1, type: 'ready' })
    await flush()
    const announce = posted.find((m) => m.type === 'wallet')!
    expect(announce).toBeTruthy()
    expect(announce.accounts).toEqual([]) // no wallet selected yet — empty, honest
    expect(spy.mock.calls.every((c) => (c[1] as unknown) === ORIGIN)).toBe(true) // never '*'

    const w = fakeWallet()
    await provider.use(w)
    await flush()
    const after = posted.filter((m) => m.type === 'wallet').pop()!
    expect(after.accounts).toEqual([ACCOUNT])
    expect(after.chainId).toBe('0x1237')
  })

  it('relays allowlisted RPC to the selected wallet and refuses the rest with 4200', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const provider = createSwitchingProvider()
    const w = fakeWallet()
    await provider.use(w)
    const h = mountPantessaChat({ container, mode: 'inline', wallet: provider })
    handles.push(h)
    const posted: Array<Record<string, unknown>> = []
    vi.spyOn(h.iframe.contentWindow!, 'postMessage').mockImplementation((msg) => {
      posted.push(msg as Record<string, unknown>)
    })
    dispatch({ source: SRC, v: 1, type: 'ready' })
    await flush()

    dispatch({ source: SRC, v: 1, type: 'rpc', id: 'a', method: 'eth_blockNumber' })
    await flush()
    const ok = posted.find((m) => m.type === 'rpc:result' && m.id === 'a')!
    expect(ok.result).toBe('0x10')
    expect(w.provider.request).toHaveBeenCalledWith({ method: 'eth_blockNumber', params: undefined })

    dispatch({ source: SRC, v: 1, type: 'rpc', id: 'b', method: 'eth_sign' })
    await flush()
    const refused = posted.find((m) => m.type === 'rpc:error' && m.id === 'b')! as { error: { code: number } }
    expect(refused.error.code).toBe(4200)
  })

  it('setAddress / sendPrompt queue until ready, then post to the pinned origin', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const h = mountPantessaChat({ container, mode: 'inline', wallet: false })
    handles.push(h)
    const posted: Array<[unknown, string]> = []
    vi.spyOn(h.iframe.contentWindow!, 'postMessage').mockImplementation((msg, target) => {
      posted.push([msg, target as string])
    })
    h.setAddress(ACCOUNT)
    h.sendPrompt('Buy $10 of AAPL on Robinhood Chain')
    expect(posted).toHaveLength(0)
    dispatch({ source: SRC, v: 1, type: 'ready' })
    await flush()
    const types = posted.map(([m]) => (m as { type: string }).type)
    expect(types).toContain('address')
    expect(types).toContain('prompt')
    const prompt = posted.find(([m]) => (m as { type: string }).type === 'prompt')![0] as { text: string; send: boolean }
    expect(prompt.send).toBe(true)
    expect(posted.every(([, t]) => t === ORIGIN)).toBe(true)
  })
})
