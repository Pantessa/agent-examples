'use client'

// THE EMBED. This is the whole install — mountPantessaChat once, inline, with
// the host wallet bridged in. Everything else on the page is the host app
// reading the chain and turning clicks into prompts.
//
// Notes a real integrator hits:
//   - Mount in an effect, destroy in its cleanup (React StrictMode double-runs
//     effects in dev; the SDK's destroy() makes that harmless).
//   - `wallet` is captured at mount. Pass a provider that survives the user
//     changing wallets later (lib/wallet.ts createSwitchingProvider) rather
//     than remounting — a remount drops the conversation.
//   - `key` is the PUBLIC yfe_ key; omit it and the embed is keyless.
//   - `origin` only exists so the example can point at a local build of the
//     Pantessa site; production installs leave it out.

import { useEffect, useImperativeHandle, useRef, forwardRef } from 'react'
import { mountPantessaChat, type Eip1193Provider, type PantessaChatHandle } from 'pantessa/embed'

export interface PantessaDeskProps {
  origin: string
  embedKey: string | null
  mcps: string[]
  wallet: Eip1193Provider
  theme?: 'light' | 'dark'
  /** Context-only address (watch mode) — the embed shows it as `context:`. */
  address?: string | null
  onEvent: (name: string, data?: unknown) => void
  onReady: () => void
}

export interface PantessaDeskHandle {
  /** Send an ask into the chat as the visitor's message. */
  ask(text: string, submit?: boolean): void
}

const PantessaDesk = forwardRef<PantessaDeskHandle, PantessaDeskProps>(function PantessaDesk(
  { origin, embedKey, mcps, wallet, theme = 'light', address, onEvent, onReady },
  ref,
) {
  const host = useRef<HTMLDivElement>(null)
  const chat = useRef<PantessaChatHandle | null>(null)
  // Latest callbacks without remounting the iframe when the parent re-renders.
  const cb = useRef({ onEvent, onReady })
  cb.current = { onEvent, onReady }

  useEffect(() => {
    if (!host.current) return
    const handle = mountPantessaChat({
      container: host.current,
      mode: 'inline',
      origin,
      mcps,
      key: embedKey ?? undefined,
      theme,
      wallet,
      onEvent: (name, data) => cb.current.onEvent(name, data),
      onReady: () => cb.current.onReady(),
    })
    chat.current = handle
    return () => {
      handle.destroy()
      chat.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, embedKey, mcps.join(','), theme, wallet])

  // Watch-mode address → context (queued by the SDK until 'ready').
  useEffect(() => {
    chat.current?.setAddress(address ?? null)
  }, [address])

  useImperativeHandle(ref, () => ({
    ask: (text, submit = true) => chat.current?.sendPrompt(text, { submit }),
  }))

  return <div ref={host} className="embed-host" data-testid="embed-host" />
})

export default PantessaDesk
