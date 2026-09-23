// TEMPORARY — delete this file the moment `pantessa@1.1.0` is installed.
//
// `driveJob` ships in the published SDK as `pantessa/desk`. This example was
// written against its contract before that version was on npm, and this
// ambient declaration is the only thing standing in for it so `tsc` and
// `vitest` can run. It mirrors the contract exactly; when the real package is
// installed it supplies these types itself and this file must go, or it will
// shadow them.
declare module 'pantessa/desk' {
  export type DeskLegKind = 'tx' | 'txChain' | 'hlAction' | 'hlBatch' | 'wait' | 'unknown'

  export interface DeskLegView {
    seq: number
    kind: DeskLegKind
    summary: string
    artifact: Record<string, unknown> | null
    chainId: number | null
    valueUsd: number | null
    staleAfterMs: number | null
  }

  export interface DeskLegResult {
    txHash?: `0x${string}`
    chainId?: number
    orderResponse?: unknown
    batch?: Array<{ ok: boolean; orderResponse?: unknown; error?: string }>
  }

  export interface DriveJobOptions {
    base: string
    jobId: string
    token: string
    /** A viem LocalAccount or WalletClient — the agent's own key. */
    signer: unknown
    rpc?: Record<number, string>
    onLeg?: (leg: DeskLegView) => void | Promise<void>
    onDone?: (seq: number, result: DeskLegResult) => void | Promise<void>
    maxLegs?: number
    pollMs?: number
    timeoutMs?: number
    /** Classify every leg and return WITHOUT signing or broadcasting. */
    dryRun?: boolean
    hlSignatureChainId?: number
    fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  }

  export interface DriveJobOutcome {
    jobId: string
    /** `done` | `failed` | `canceled`, or `dry` when `dryRun` stopped the loop. */
    status: string
    legs: DeskLegView[]
    results: Array<{ seq: number; result: DeskLegResult }>
    failReason?: string
  }

  export function driveJob(opts: DriveJobOptions): Promise<DriveJobOutcome>
}
