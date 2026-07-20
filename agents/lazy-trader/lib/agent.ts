/**
 * The lazy trader's brain. The agent can hold a key and sign — that's ALL it
 * brings. Everything hard about acting cross-chain (where the money sits, how
 * it should move, gas on the far side, deposit addresses, ordering) is bought
 * from Yeetful's funding planner as ONE x402 call: `fund_and_build` returns a
 * numbered runbook of exact NEAR Intents tool calls, and this agent just...
 * follows it, signing each leg with its own wallet.
 *
 * Safe by default: without `LIVE=1` the run rides the FREE funding door, plans
 * for a demo address with real holdings, builds every leg's deposit tx — and
 * stops before any signature. LIVE=1 + PRIVATE_KEY pays the paid door through
 * the expense account (receipted) and actually signs.
 */
import { createExpenseAccount, isLive, loadAgentPrivateKey, loadAgentWallet, type ExpenseAccount, type Receipt } from '@yeetful/agent-kit'
import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  DEMO_ADDRESS,
  FUNDING_FREE_DOOR,
  FUNDING_MCP,
  FUNDING_PAID_DOOR,
  NEAR_INTENTS_DOOR,
  resolveGoalChain,
  type GoalChain,
} from './config'
import { callMcpTool, type FetchLike } from './mcp'

export interface Goal {
  /** Destination chain — name or chainId ("arbitrum", "8453"). */
  chain: string
  /** Token that must land there ("USDC", "ETH"). */
  token: string
  /** How much of it the agent wants to HOLD there (the goal, not the shortfall). */
  amount: number
  /** What the funding is for — becomes the runbook's final step. */
  finalAction?: string
}

export interface RunStep {
  label: string
  detail: string
  data?: unknown
}

export interface RunResult {
  mode: 'dry-run' | 'live'
  address: `0x${string}`
  goal: Goal
  steps: RunStep[]
  goalMet: boolean
  paidUsd: number
  receipts: Receipt[]
}

// ── MCP response shapes (structural — only the fields this agent reads) ─────

interface Scan {
  sources: Array<{ chain: string; token: string; balance: number; usd: number }>
  readChains: string[]
  failedChains: string[]
}

interface FundAndBuild {
  plan: { kind: 'offer' | 'short'; note?: string; needUsd?: number; totalUsd?: number; sourcesSeen?: string }
  runbook: {
    option: string
    steps: Array<{ step: number; kind: 'build' | 'notify' | 'await' | 'act'; tool?: string; params?: Record<string, unknown>; note: string }>
    yeetfulResume: string
  } | null
}

interface SwapReady {
  kind: string
  deposit: { address: string; chain: string; exactAmount: string; addressExpires: string | null }
  balanceCheck: { ok: boolean | null; note: string }
  steps: Array<{ action: string; summary: string; tx: { to: string; data: string; value: string; chainId: number } }>
}

// ── Expense account (one per process so receipts + day totals accumulate) ───

let account: ExpenseAccount | null = null
export function expenseAccount(): ExpenseAccount {
  if (!account) {
    account = createExpenseAccount({
      allow: [new URL(FUNDING_MCP).host],
      perCallUsd: Number(process.env.FUNDING_MAX_USD ?? 0.05),
      perDayUsd: Number(process.env.FUNDING_DAY_USD ?? 1),
    })
  }
  return account
}

// ── Injectable seams so tests run fully offline ─────────────────────────────

export interface RunDeps {
  /** Fetch for FREE doors (funding free door + near-intents). */
  freeFetch?: FetchLike
  /** Paid fetch for the x402 funding door (defaults to the expense account). */
  paidFetch?: FetchLike
  /** Signs + broadcasts one leg's deposit tx, returns the tx hash. */
  signLeg?: (tx: { to: string; data: string; value: string; chainId: number }) => Promise<string>
}

async function defaultSignLeg(tx: { to: string; data: string; value: string; chainId: number }): Promise<string> {
  const pk = loadAgentPrivateKey()
  if (!pk) throw new Error('LIVE=1 needs PRIVATE_KEY to sign legs.')
  const goalChain = resolveGoalChainById(tx.chainId)
  if (!goalChain) throw new Error(`Leg targets unsupported chainId ${tx.chainId}.`)
  const wallet = createWalletClient({
    account: privateKeyToAccount(pk),
    chain: goalChain.chain,
    transport: http(goalChain.rpcUrl),
  })
  return wallet.sendTransaction({
    to: tx.to as `0x${string}`,
    data: tx.data as `0x${string}`,
    value: BigInt(tx.value || '0'),
  } as Parameters<typeof wallet.sendTransaction>[0])
}

function resolveGoalChainById(chainId: number): GoalChain | null {
  return resolveGoalChain(String(chainId))
}

/** Movable balance of the goal token already sitting on the destination. */
export function heldOnDestination(scan: Scan, chainWord: string, token: string): number {
  return scan.sources
    .filter((s) => s.chain === chainWord && s.token.toUpperCase() === token.toUpperCase())
    .reduce((a, s) => a + s.balance, 0)
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''))

// ── The run ─────────────────────────────────────────────────────────────────

export async function runLazyTrade(goal: Goal, deps: RunDeps = {}): Promise<RunResult> {
  const live = isLive()
  const steps: RunStep[] = []
  const push = (label: string, detail: string, data?: unknown) => steps.push({ label, detail, data })

  const dest = resolveGoalChain(goal.chain)
  if (!dest) throw new Error(`Unknown goal chain "${goal.chain}" — this demo covers Base, Arbitrum, Ethereum.`)
  if (!(goal.amount > 0)) throw new Error('Goal amount must be positive.')

  const wallet = loadAgentWallet()
  const own = wallet.account!.address
  // Dry-run plans for a wallet with REAL holdings so the demo shows a real
  // plan; live always uses the agent's own key.
  const address = live || process.env.PRIVATE_KEY ? own : DEMO_ADDRESS

  const freeFetch = deps.freeFetch ?? fetch
  const paidFetch = deps.paidFetch ?? (live ? (expenseAccount().pay as FetchLike) : freeFetch)
  const fundingDoor = live ? FUNDING_PAID_DOOR : FUNDING_FREE_DOOR
  const signLeg = deps.signLeg ?? defaultSignLeg

  push(
    'mode',
    live
      ? `LIVE — funding calls pay the x402 door (${FUNDING_PAID_DOOR}), legs will be SIGNED by ${own}.`
      : `DRY-RUN — free door, planning for ${address}, nothing gets signed. Set LIVE=1 (and PRIVATE_KEY) to execute.`,
  )

  // 1 · Where does the money actually sit?
  const scan = (await callMcpTool(fundingDoor, 'scan_funding_sources', { user: address }, paidFetch)) as Scan
  const holdings = scan.sources.map((s) => `${fmt(s.balance)} ${s.token} on ${s.chain} (~$${s.usd.toFixed(2)})`).join(' · ') || 'nothing movable'
  push('scan', `Movable funds: ${holdings}${scan.failedChains.length ? ` — ${scan.failedChains.join('/')} unreadable (unknown, not empty)` : ''}`, scan)

  // 2 · Shortfall = goal minus what's already there.
  const held = heldOnDestination(scan, dest.word, goal.token)
  const shortfall = Math.max(0, goal.amount - held)
  if (shortfall === 0) {
    push('goal', `Already holding ${fmt(held)} ${goal.token} on ${dest.word} — no funding needed.${goal.finalAction ? ` Next: ${goal.finalAction}` : ''}`)
    return finish(live, address, goal, steps, true)
  }
  push('shortfall', `Goal: ${fmt(goal.amount)} ${goal.token} on ${dest.word}. Holding ${fmt(held)} there → shortfall ${fmt(shortfall)} ${goal.token}.`)

  // 3 · Buy the hard part: ONE call returns the executable runbook.
  const fab = (await callMcpTool(
    fundingDoor,
    'fund_and_build',
    { user: address, chain: dest.word, token: goal.token, amount: shortfall, ...(goal.finalAction ? { finalAction: goal.finalAction } : {}) },
    paidFetch,
  )) as FundAndBuild
  if (!fab.runbook) {
    push('short', fab.plan.note ?? 'The wallet cannot cover this move — honest shortfall.', fab.plan)
    return finish(live, address, goal, steps, false)
  }
  push('runbook', `Plan "${fab.runbook.option}" → ${fab.runbook.steps.length} steps. Resume sentence: "${fab.runbook.yeetfulResume}"`, fab.runbook)

  // 4 · Follow the runbook.
  let depositAddress: string | null = null
  let lastTxHash: string | null = null
  for (const s of fab.runbook.steps) {
    if (s.kind === 'build') {
      const built = (await callMcpTool(NEAR_INTENTS_DOOR, 'build_swap', { ...s.params, from: address }, freeFetch)) as SwapReady
      depositAddress = built.deposit.address
      push('build', `Leg built: send ${built.deposit.exactAmount} on ${built.deposit.chain} to one-time deposit ${built.deposit.address}. ${built.balanceCheck.note}`, built.deposit)
      const tx = built.steps[0]?.tx
      if (!tx) throw new Error('build_swap returned no signable step.')
      if (!live) {
        push('dry-run', `Would sign: ${built.steps[0]!.summary}`)
        continue
      }
      const hash = await signLeg(tx)
      lastTxHash = hash
      push('signed', `Deposit transfer broadcast: ${hash}`)
    } else if (s.kind === 'notify' && live && depositAddress && lastTxHash) {
      // Best-effort speed-up; the swap settles without it.
      await callMcpTool(NEAR_INTENTS_DOOR, 'submit_deposit_tx', { depositAddress, txHash: lastTxHash }, freeFetch).catch(() => undefined)
      push('notify', 'Deposit tx submitted to 1Click for faster pickup.')
    } else if (s.kind === 'await' && live && depositAddress) {
      let outcome = 'PENDING'
      for (let i = 0; i < 12 && !/SUCCESS|REFUNDED|FAILED/.test(outcome); i++) {
        const status = (await callMcpTool(NEAR_INTENTS_DOOR, 'await_completion', { depositAddress }, freeFetch)) as { status?: string } | string
        outcome = typeof status === 'string' ? status : (status.status ?? JSON.stringify(status))
      }
      push('settled', `Leg outcome: ${outcome}`)
      if (/REFUNDED|FAILED/.test(outcome)) {
        push('halt', 'Leg did not settle — stopping the runbook; deposits refund automatically.')
        return finish(live, address, goal, steps, false)
      }
    } else if (s.kind === 'act') {
      push('act', s.note)
    }
  }

  // 5 · Live: prove it with a fresh scan.
  let goalMet = false
  if (live) {
    const after = (await callMcpTool(fundingDoor, 'scan_funding_sources', { user: address }, paidFetch)) as Scan
    const heldAfter = heldOnDestination(after, dest.word, goal.token)
    goalMet = heldAfter + 1e-9 >= goal.amount
    push('verify', `Fresh scan: holding ${fmt(heldAfter)} ${goal.token} on ${dest.word} — goal ${goalMet ? 'MET' : 'not yet met (settlement may still be landing)'}.`)
  } else {
    push('done', 'Dry-run complete: plan bought, every leg built, nothing signed. Set LIVE=1 to let the lazy trader actually trade.')
    goalMet = false
  }

  return finish(live, address, goal, steps, goalMet)
}

function finish(live: boolean, address: `0x${string}`, goal: Goal, steps: RunStep[], goalMet: boolean): RunResult {
  const acct = account
  return {
    mode: live ? 'live' : 'dry-run',
    address,
    goal,
    steps,
    goalMet,
    paidUsd: acct ? acct.spentTodayUsd() : 0,
    receipts: acct ? acct.receipts() : [],
  }
}
