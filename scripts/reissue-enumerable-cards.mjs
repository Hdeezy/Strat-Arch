#!/usr/bin/env node
/**
 * REISSUE THE CARDS MIGRATION 008 COULD NOT ROTATE.
 *
 * Migration 008 rotates every enumerable card code EXCEPT those already
 * issued to a person — renaming a card in someone's pocket would silently
 * kill it with no way for them to know why.
 *
 * Those cards need the real operation: invalidate the old card, which
 * reclaims its value, then reissue that value onto a fresh card with a
 * non-enumerable code. The holder swaps plastic and keeps their money.
 *
 * This script drives the same API routes an advocate would use, so the
 * ledger, the audit trail, and the invariants all see an ordinary
 * invalidate-and-reissue rather than a backdoor.
 *
 *   node scripts/reissue-enumerable-cards.mjs            # dry run
 *   node scripts/reissue-enumerable-cards.mjs --execute  # do it
 *
 * Requires in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   HOPE_ADMIN_SESSION_COOKIE  — a signed-in charity_admin session, because
 *                                the routes authenticate. Copy it from your
 *                                browser dev tools after logging in.
 *   NEXT_PUBLIC_APP_URL        — defaults to http://localhost:3000
 */

import { readFileSync } from 'node:fs'

// ── env ────────────────────────────────────────────────────────────────────
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  console.error('No .env.local found. Run this from the project root.')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const COOKIE = process.env.HOPE_ADMIN_SESSION_COOKIE
const EXECUTE = process.argv.includes('--execute')

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
if (EXECUTE && !COOKIE) {
  console.error(
    'Missing HOPE_ADMIN_SESSION_COOKIE. The invalidate and reissue routes\n' +
    'authenticate — log in as a charity_admin and copy the session cookie.'
  )
  process.exit(1)
}

const sb = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })

// ── find the stragglers ────────────────────────────────────────────────────
// Anything still matching the enumerable shape after migration 008 ran is,
// by construction, a card that was already issued.

const res = await sb(
  'cards?select=id,card_code,state,balance_cents,city_id,charity_id' +
  '&card_code=like.____-____&order=card_code'
)

if (!res.ok) {
  console.error(`Supabase query failed: ${res.status} ${await res.text()}`)
  process.exit(1)
}

const stragglers = (await res.json()).filter(c => /^[A-Z]{4}-[A-Z0-9]{4}$/.test(c.card_code))

if (stragglers.length === 0) {
  console.log('Nothing to do — no enumerable card codes remain.')
  process.exit(0)
}

console.log(`\n${stragglers.length} issued card(s) still carry an enumerable code:\n`)
for (const c of stragglers) {
  const bal = (c.balance_cents / 100).toFixed(2)
  console.log(`  ${c.card_code}  state=${c.state}  balance=$${bal}`)
}

if (!EXECUTE) {
  console.log(
    '\nDRY RUN. Each of these would be invalidated (reclaiming its value) and\n' +
    'reissued onto a fresh card with a non-enumerable code. The holder keeps\n' +
    'their balance and swaps the plastic.\n\n' +
    'Re-run with --execute to do it. Have the replacement cards printed first.\n'
  )
  process.exit(0)
}

// ── invalidate → mint replacement → reissue ────────────────────────────────

let done = 0
const failures = []

for (const card of stragglers) {
  const label = card.card_code
  try {
    // 1. Invalidate. reclaimCard() pulls the value into the reclaimed pool.
    const inv = await fetch(`${APP_URL}/api/cards/${card.id}/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
      body: JSON.stringify({ reason: 'Enumerable pilot code retired — Scrappy Cut §3a control 1' }),
    })
    if (!inv.ok) throw new Error(`invalidate ${inv.status}: ${await inv.text()}`)

    // 2. Mint a replacement. generate_unique_card_code() is collision-safe and
    //    the card_code_not_enumerable constraint refuses anything sequential.
    const mint = await sb('rpc/generate_unique_card_code', {
      method: 'POST',
      body: JSON.stringify({ prefix: 'HMLT' }),
    })
    if (!mint.ok) throw new Error(`mint ${mint.status}: ${await mint.text()}`)
    const newCode = await mint.json()

    const create = await sb('cards', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        city_id: card.city_id,
        charity_id: card.charity_id,
        card_code: newCode,
        state: 'unloaded',
      }),
    })
    if (!create.ok) throw new Error(`create ${create.status}: ${await create.text()}`)
    const [replacement] = await create.json()

    // 3. Reissue. The amount comes from the reclaim, inside the ledger.
    const re = await fetch(`${APP_URL}/api/cards/${replacement.id}/reissue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: COOKIE },
      body: JSON.stringify({
        from_card_code: card.card_code,
        reason: 'Replacement for retired enumerable pilot code',
      }),
    })

    // A zero-balance card has nothing to reissue; that is a clean outcome.
    if (!re.ok) {
      const body = await re.text()
      if (re.status === 409 && body.includes('No reclaimed value')) {
        console.log(`  ${label} -> ${newCode}  (was empty; nothing to move)`)
        done++
        continue
      }
      throw new Error(`reissue ${re.status}: ${body}`)
    }

    const out = await re.json()
    console.log(`  ${label} -> ${newCode}  moved $${(out.reissued_cents / 100).toFixed(2)}`)
    done++
  } catch (err) {
    console.error(`  ${label} FAILED: ${err.message}`)
    failures.push({ code: label, error: err.message })
  }
}

console.log(`\n${done} reissued, ${failures.length} failed.`)
if (failures.length) {
  console.log('\nFailures need a human. The old cards may be invalidated with their')
  console.log('value sitting in the reclaimed pool — check /admin before retrying.')
  process.exit(1)
}
console.log('\nPrint the new cards and swap them with the holders. The old plastic is dead.')
