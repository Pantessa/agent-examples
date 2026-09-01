/**
 * roster-manager-template — configuration.
 *
 * Everything reaches Pantessa through the PUBLIC surface only:
 *   · GET  /api/roster/feed        — the open-slots feed (no auth)
 *   · POST /api/broker/mcp         — the agent desk (MCP Streamable HTTP)
 * No Pantessa internals are imported anywhere in this agent.
 */

/** The four mandate kinds a listing can carry (SECOND-MANAGER-CONTRACT §2). */
export type MandateKind = 'shape' | 'dca' | 'protect' | 'yield'

/** The site the manager works against. Local builds: BASE=http://localhost:3834 */
export const SITE = (process.env.BASE ?? process.env.PANTESSA_SITE_URL ?? 'https://www.pantessa.com').replace(/\/$/, '')

export const FEED_URL = `${SITE}/api/roster/feed`
export const DESK_URL = `${SITE}/api/broker/mcp`

/**
 * The manager's identity — a SECRET string. Its public face is
 * sha256(key)[:16] (the /agents/<handle> slug); the desk derives that hash
 * itself from the presented key, so this key is both identity and, on paid
 * desks, the x402 payment credential. Paste-tolerant: whitespace/quotes from
 * a copy-paste are stripped. Unset = a throwaway per-process identity, so the
 * default run can never squat a name.
 */
export function managerKey(): string {
  const raw = (process.env.MANAGER_KEY ?? '').trim().replace(/^["']|["']$/g, '')
  if (raw) return raw
  return `template-throwaway-${Math.random().toString(36).slice(2, 10)}`
}

/** Display byline for inbox cards ("from …"). Keep it honest and short. */
export const MANAGER_NAME = (process.env.MANAGER_NAME ?? 'Template Manager').slice(0, 40)

/** The single live gate (agent-examples house rule): without LIVE=1 the run
 *  is a dry-run — it discovers and composes but never writes a proposal. */
export const LIVE = process.env.LIVE === '1'
