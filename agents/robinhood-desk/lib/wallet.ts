'use client'

// The host page's wallet, the way the embed wants it: ONE EIP-1193 provider
// handed to `mountPantessaChat({ wallet })` at mount time.
//
// Real pages have more than one injected wallet (EIP-6963), and the user picks
// one AFTER the chat is already on screen. Rather than remount the embed (and
// lose the conversation) when they connect, the desk mounts once with a
// SWITCHING provider: a stable EIP-1193 facade whose `request` forwards to
// whichever wallet is currently selected, and which emits accountsChanged /
// chainChanged itself when the selection changes — so the SDK's bridge
// re-announces and the embed auto-connects, exactly as if window.ethereum had
// fired the event.

import type { Eip1193Provider } from 'pantessa/embed'
import { ROBINHOOD_CHAIN_PARAMS } from './chain'

export interface Eip6963ProviderInfo {
  uuid: string
  name: string
  icon: string
  rdns: string
}

export interface DiscoveredWallet {
  info: Eip6963ProviderInfo
  provider: Eip1193Provider
}

type Listener = (...args: unknown[]) => void

/** Discover injected wallets: EIP-6963 announcements + a window.ethereum fallback. */
export function discoverWallets(waitMs = 250): Promise<DiscoveredWallet[]> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') return resolve([])
    const found = new Map<string, DiscoveredWallet>()
    const onAnnounce = (e: Event) => {
      const detail = (e as CustomEvent<{ info?: Eip6963ProviderInfo; provider?: Eip1193Provider }>).detail
      if (detail?.info?.uuid && detail.provider) found.set(detail.info.uuid, { info: detail.info, provider: detail.provider })
    }
    window.addEventListener('eip6963:announceProvider', onAnnounce)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce)
      const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum
      if (found.size === 0 && eth) {
        found.set('window.ethereum', {
          info: { uuid: 'window.ethereum', name: 'Injected wallet', icon: '', rdns: 'window.ethereum' },
          provider: eth,
        })
      }
      resolve([...found.values()])
    }, waitMs)
  })
}

export interface SwitchingProvider extends Eip1193Provider {
  /** Point the facade at a wallet (or null to disconnect). Emits the change. */
  use(next: DiscoveredWallet | null): Promise<void>
  current(): DiscoveredWallet | null
}

export class WalletError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}

export function createSwitchingProvider(): SwitchingProvider {
  let target: DiscoveredWallet | null = null
  const listeners = new Map<string, Set<Listener>>()
  const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((fn) => fn(...args))

  // Forward the selected wallet's events to our subscribers (the SDK).
  const forward: Record<string, Listener> = {
    accountsChanged: (...a) => emit('accountsChanged', ...a),
    chainChanged: (...a) => emit('chainChanged', ...a),
    disconnect: (...a) => emit('disconnect', ...a),
  }
  const detach = (w: DiscoveredWallet | null) => {
    if (!w?.provider.removeListener) return
    for (const [ev, fn] of Object.entries(forward)) w.provider.removeListener(ev, fn)
  }
  const attach = (w: DiscoveredWallet | null) => {
    if (!w?.provider.on) return
    for (const [ev, fn] of Object.entries(forward)) w.provider.on(ev, fn)
  }

  return {
    async request({ method, params }) {
      if (!target) {
        // The bridge probes these on 'ready'; an honest empty answer keeps the
        // embed's "Connect host wallet" affordance visible instead of erroring.
        if (method === 'eth_accounts') return []
        throw new WalletError(4900, 'No wallet selected on the host page yet')
      }
      return target.provider.request({ method, params })
    },
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
    },
    removeListener(event, fn) {
      listeners.get(event)?.delete(fn)
    },
    async use(next) {
      if (next === target) return
      detach(target)
      target = next
      attach(target)
      if (!target) {
        emit('accountsChanged', [])
        emit('disconnect')
        return
      }
      const accounts = (await target.provider.request({ method: 'eth_accounts' }).catch(() => [])) as string[]
      const chainId = (await target.provider.request({ method: 'eth_chainId' }).catch(() => null)) as string | null
      if (chainId) emit('chainChanged', chainId)
      emit('accountsChanged', accounts)
    },
    current: () => target,
  }
}

/** Ask the wallet for accounts, then land it on Robinhood Chain (add if unknown). */
export async function connectWallet(w: DiscoveredWallet): Promise<{ accounts: string[]; chainId: string | null }> {
  const accounts = (await w.provider.request({ method: 'eth_requestAccounts' })) as string[]
  let chainId = (await w.provider.request({ method: 'eth_chainId' }).catch(() => null)) as string | null
  if (chainId?.toLowerCase() !== ROBINHOOD_CHAIN_PARAMS.chainId) {
    try {
      await w.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ROBINHOOD_CHAIN_PARAMS.chainId }] })
      chainId = ROBINHOOD_CHAIN_PARAMS.chainId
    } catch (err) {
      const code = (err as { code?: number })?.code
      // 4902 = chain unknown to the wallet → offer to add it, then switch.
      if (code === 4902 || code === -32603) {
        try {
          await w.provider.request({ method: 'wallet_addEthereumChain', params: [ROBINHOOD_CHAIN_PARAMS] })
          chainId = ROBINHOOD_CHAIN_PARAMS.chainId
        } catch {
          /* user declined — the desk still reads; the embed will ask to switch when it builds */
        }
      }
    }
  }
  return { accounts, chainId }
}
