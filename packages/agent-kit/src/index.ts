/**
 * @yeetful/agent-kit — shared payer plumbing for Yeetful's example agents.
 *
 * The mirror image of @yeetful/x402-service-kit: where the service-kit owns the
 * x402 *payment gate*, this kit owns the *payer* — the expense account
 * (allowlist + per-call/per-day USD caps + receipts) every agent spends through.
 *
 *   import { createExpenseAccount, loadAgentWallet, isLive } from '@yeetful/agent-kit'
 */

export { createExpenseAccount, GrantError } from './expense-account'
export type {
  ExpenseAccount,
  ExpenseAccountOptions,
  PayFn,
  Receipt,
} from './expense-account'

export { loadAgentWallet, isLive } from './env'
