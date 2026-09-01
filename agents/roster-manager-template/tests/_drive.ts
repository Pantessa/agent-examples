// End-to-end drive of the template vs a local Pantessa build (QA, not shipped
// as a unit test — it needs a running :3834 and DB). Uses ONLY the template's
// public-API functions for the manager half; the Pantessa-side list/hire/
// decline/fire use the same public HTTP a UI would. Run:
//   BASE=http://localhost:3834 MANAGER_KEY=... npx tsx tests/_drive.ts
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { DeskClient } from '../lib/desk'
import { discover, pickSlot, court, propose, pollStatus, capRefusal } from '../lib/manager'

const SITE = (process.env.BASE ?? 'http://localhost:3834').replace(/\/$/, '')
const J = { 'content-type': 'application/json' }
const results: boolean[] = []
const rec = (n: string, ok: boolean, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`) }

// Website .env.local (employer burner + secrets) — the drive plays BOTH the
// employer (site side) and the manager (template side).
const webEnv = (n: string) => (readFileSync('/Users/nategeier/yeetful/website-fund-buy-cascade/.env.local', 'utf8').match(new RegExp(`^${n}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '')

async function main() {
  const managerKey = process.env.MANAGER_KEY ?? 'qa-template-drive-manager'
  const handle = createHash('sha256').update(managerKey).digest('hex').slice(0, 16)
  const burner = privateKeyToAccount(webEnv('PRIVATE_KEY') as `0x${string}`)
  const W = burner.address
  console.log(`SITE ${SITE} · manager handle ${handle} · employer ${W}`)

  // ── SITE SIDE: mint a listed slot the template can discover ──
  let b: any = await (await fetch(`${SITE}/api/roster`, { method: 'POST', headers: J, body: JSON.stringify({ wallet: W, mandate: 'keep me 60/40 ETH/USDC', capUsd: 100 }) })).json()
  const slotId = b.slot?.id
  b = await (await fetch(`${SITE}/api/roster/list`, { method: 'POST', headers: J, body: JSON.stringify({ slotId, wallet: W }) })).json()
  const listSig = await burner.signMessage({ message: b.consentText })
  b = await (await fetch(`${SITE}/api/roster/list`, { method: 'POST', headers: J, body: JSON.stringify({ slotId, wallet: W, signature: listSig }) })).json()
  const token = b.slot?.listToken
  rec('site: fixture slot listed on the feed', !!token, `token ${token}`)

  // ── TEMPLATE SIDE: discover via the public feed ──
  const desk = new DeskClient(true) // stamp internal
  await desk.init()
  const feed = await discover()
  const found = feed.slots.find((s) => s.slotToken === token)
  rec('template: discovers the listing on the public feed (no wallet in feed)', !!found && !JSON.stringify(feed).match(/0x[0-9a-fA-F]{40}/), `${feed.slots.length} slots`)

  // pickSlot + court
  const picked = pickSlot(feed.slots, 'shape')
  const courted = await court(desk, token, managerKey)
  rec('template: courts the listing — engagement discloses the employer wallet', courted.ok && courted.wallet?.toLowerCase() === W.toLowerCase(), `wallet ${courted.wallet}`)

  // ── SITE SIDE: the human hires this manager (manual agentKeyHash door) ──
  b = await (await fetch(`${SITE}/api/roster/hire`, { method: 'POST', headers: J, body: JSON.stringify({ slotId, wallet: W, agentKeyHash: handle }) })).json()
  const hireSig = await burner.signMessage({ message: b.consentText })
  b = await (await fetch(`${SITE}/api/roster/hire`, { method: 'POST', headers: J, body: JSON.stringify({ slotId, wallet: W, signature: hireSig }) })).json()
  rec('site: employer hires the template identity (one signature)', b.slot?.status === 'hired' && b.slot?.agentKeyHash === handle)

  // ── TEMPLATE SIDE: the client-side cap gate refuses over-cap BEFORE the server ──
  rec('template: refuses an over-cap ask client-side (no bench)', capRefusal(150, courted.capUsd ?? 100) !== null)

  // propose ONE in-mandate, under-cap, $-priced open
  const p = await propose(desk, { wallet: W, ask: 'Swap $40 of USDC to ETH on Base', priceUsd: 40, capUsd: courted.capUsd ?? 100, agentKey: managerKey })
  rec('template: proposes → roster block + inbox url + badge', p.ok && !!p.intentId && !!p.url, p.refusal ?? `intent ${p.intentId}`)
  const slug = p.url?.split('/i/')[1]

  // badged inbox card visible on the site
  const inbox: any = await (await fetch(`${SITE}/api/inbox?wallet=${W}`)).json()
  const card = (inbox.items || []).find((i: any) => i.slug === slug)
  rec('site: the proposal is a badged inbox card', !!card?.roster?.mandate, JSON.stringify(card?.roster))

  // ── TEMPLATE SIDE: poll status (handed_off before any human sign) ──
  const st = await pollStatus(desk, p.intentId!)
  rec('template: broker_status reads a forward-only funnel state', ['open', 'handed_off'].includes(st.state), st.state)

  // ── SITE SIDE: decline; TEMPLATE reads declined, slot stays hired ──
  let d: any = await (await fetch(`${SITE}/api/roster/decline`, { method: 'POST', headers: J, body: JSON.stringify({ slug, wallet: W }) })).json()
  const decSig = await burner.signMessage({ message: d.consentText })
  await fetch(`${SITE}/api/roster/decline`, { method: 'POST', headers: J, body: JSON.stringify({ slug, wallet: W, signature: decSig }) })
  const st2 = await pollStatus(desk, p.intentId!)
  const roster: any = await (await fetch(`${SITE}/api/roster?wallet=${W}`)).json()
  const stillHired = (roster.slots || []).some((s: any) => s.id === slotId && s.status === 'hired')
  rec('decline: template reads declined; slot NOT benched (declines are an answer)', st2.state === 'declined' && stillHired, `state=${st2.state} hired=${stillHired}`)

  // ── SITE SIDE: fire; TEMPLATE's next propose reads FIRED (terminal) ──
  let f: any = await (await fetch(`${SITE}/api/roster/fire`, { method: 'POST', headers: J, body: JSON.stringify({ slotId, wallet: W }) })).json()
  const fireSig = await burner.signMessage({ message: f.consentText })
  await fetch(`${SITE}/api/roster/fire`, { method: 'POST', headers: J, body: JSON.stringify({ slotId, wallet: W, signature: fireSig }) })
  const after = await propose(desk, { wallet: W, ask: 'Swap $30 of USDC to ETH on Base', priceUsd: 30, capUsd: 100, agentKey: managerKey })
  rec('fire: template reads FIRED as terminal (forget the slot)', !after.ok && after.stateRead === 'fired', after.refusal?.slice(0, 80))

  console.log(`\n=== ${results.filter(Boolean).length}/${results.length} ===`)
  console.log('DRILL', JSON.stringify({ wallet: W.toLowerCase(), slotId, slug, handle }))
}
main().catch((e) => { console.error(e); process.exit(1) })
