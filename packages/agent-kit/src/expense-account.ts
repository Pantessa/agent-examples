import type { WalletClient } from 'viem'
import { yeetful, GrantError, type PayFn, type Receipt } from 'yeetful/agent'
import { loadAgentWallet } from './env'

export { GrantError }
export type { PayFn, Receipt }

export interface ExpenseAccountOptions {
  /** Exact hostnames this agent may pay (e.g. "nansen.yeetful.com"). */
  allow: string[]
  /** Per-call cap in USD. Default $0.05. */
  perCallUsd?: number
  /** Per-day cap in USD. Default $1. */
  perDayUsd?: number
  /** Optional lifetime cap across this process. */
  totalUsd?: number | null
  /** Expiry — unix ms, ISO string, or Date. Default 24h from now. */
  expiresAt?: number | string | Date
  /** Override the wallet (defaults to {@link loadAgentWallet}). */
  wallet?: WalletClient
  /** How many receipts to retain in the in-memory log. Default 100. */
  maxReceipts?: number
  onReceipt?: (r: Receipt) => void
  onEvent?: (m: string) => void
}

export interface ExpenseAccount {
  /** The grant-aware paid `fetch`. Throws {@link GrantError} on a denied call. */
  pay: PayFn
  wallet: WalletClient
  address: `0x${string}`
  /** The receipt log, oldest-first (settlements AND denials). */
  receipts(): Receipt[]
  spentTodayUsd(): number
  remainingTodayUsd(): number
  /** Drain hosted-ledger sync (no-op without YEETFUL_API_KEY). */
  flushLedger(): Promise<void>
}

/**
 * Build an agent's expense account: an allowlist + per-call / per-day USD caps
 * wrapped around `yeetful()`'s paid fetch, pre-wired with the hosted-sync env
 * (`YEETFUL_API_KEY`, `YEETFUL_GRANT_ID`, `YEETFUL_LEDGER_URL`) and an in-memory
 * receipt log you can read back for a dashboard.
 */
export function createExpenseAccount(opts: ExpenseAccountOptions): ExpenseAccount {
  const wallet = opts.wallet ?? loadAgentWallet()
  const address = wallet.account!.address

  const log: Receipt[] = []
  const max = opts.maxReceipts ?? 100

  const pay = yeetful({
    wallet,
    grant: {
      id: process.env.YEETFUL_GRANT_ID || undefined,
      allow: opts.allow,
      perCallUsd: opts.perCallUsd ?? 0.05,
      perDayUsd: opts.perDayUsd ?? 1,
      totalUsd: opts.totalUsd ?? null,
      expiresAt: opts.expiresAt ?? Date.now() + 24 * 60 * 60 * 1000,
    },
    apiKey: process.env.YEETFUL_API_KEY || undefined,
    // Must be the dashboard's CANONICAL origin — fetch drops the auth header on
    // cross-origin redirects (apex → www), which 401s every receipt POST.
    ledgerUrl: process.env.YEETFUL_LEDGER_URL || undefined,
    onReceipt: (r) => {
      log.push(r)
      if (log.length > max) log.shift()
      opts.onReceipt?.(r)
    },
    onEvent: opts.onEvent,
  })

  return {
    pay,
    wallet,
    address,
    receipts: () => log.slice(),
    spentTodayUsd: () => pay.spentTodayUsd(),
    remainingTodayUsd: () => pay.remainingTodayUsd(),
    flushLedger: () => pay.flushLedger(),
  }
}
