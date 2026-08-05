/**
 * Replay: rebuild balances from the entries and compare them to what the
 * system currently believes.
 *
 * This is the claim the whole ledger design rests on — that financial history
 * can be re-derived from an append-only record rather than trusted because a
 * number in a column says so. It is pgTAP invariant 3, the nightly
 * reconciliation job, and the answer to an auditor asking how a balance got
 * to be what it is.
 *
 * Read-only. Nothing in this file writes.
 */

import { createAdminClient } from '@/lib/supabase/admin'

export interface Drift {
  card_id: string
  card_code: string
  projected_cents: number
  replayed_cents: number
  delta_cents: number
}

export interface ReplayReport {
  checkedCards: number
  drift: Drift[]
  unbalancedTransactions: { transaction_id: string; sum_cents: number }[]
  negativeCardAccounts: { card_id: string; balance_cents: number }[]
  overCapturedAuthorizations: {
    id: string
    authorized_cents: number
    captured_cents: number
  }[]
  ok: boolean
}

/**
 * Run every invariant that can be checked from application code and return a
 * structured report. The same checks exist in pgTAP (supabase/tests/) and run
 * in CI; this version exists so the nightly cron can alert on them without a
 * psql session.
 */
export async function replayAndCompare(): Promise<ReplayReport> {
  const admin = createAdminClient()

  // ── Invariant 3: projection equals replay ────────────────────────────────
  const { data: cards, error: cardsError } = await admin
    .from('cards')
    .select('id, card_code, balance_cents')

  if (cardsError) throw new Error(`Replay failed reading cards: ${cardsError.message}`)

  const { data: balances, error: balError } = await admin
    .from('ledger_balances')
    .select('card_id, balance_cents')
    .not('card_id', 'is', null)

  if (balError) throw new Error(`Replay failed reading balances: ${balError.message}`)

  const replayed = new Map<string, number>()
  for (const b of balances ?? []) {
    replayed.set(b.card_id as string, Number(b.balance_cents))
  }

  const drift: Drift[] = []
  for (const c of cards ?? []) {
    const actual = replayed.get(c.id as string) ?? 0
    const projected = Number(c.balance_cents)
    if (actual !== projected) {
      drift.push({
        card_id: c.id as string,
        card_code: c.card_code as string,
        projected_cents: projected,
        replayed_cents: actual,
        delta_cents: projected - actual,
      })
    }
  }

  // ── Invariant 1: every transaction's entries sum to zero ─────────────────
  const { data: unbalanced, error: unbalError } = await admin.rpc(
    'find_unbalanced_transactions'
  )
  if (unbalError) {
    throw new Error(`Replay failed checking balance invariant: ${unbalError.message}`)
  }

  // ── Invariant 2: no card account is negative ─────────────────────────────
  // The float and the clearing account may legitimately go negative — a
  // chargeback against already-cleared money is exactly that case. A CARD
  // never may: it would mean someone spent value that was not there.
  const negativeCardAccounts = (balances ?? [])
    .filter(b => Number(b.balance_cents) < 0)
    .map(b => ({ card_id: b.card_id as string, balance_cents: Number(b.balance_cents) }))

  // ── Invariant 4: capture never exceeds authorization ─────────────────────
  // Also a CHECK constraint, so this should be structurally impossible. It is
  // checked anyway, because an invariant you only enforce is an invariant you
  // stop being able to prove. Column-to-column comparison is not expressible
  // through PostgREST, so it goes through an RPC.
  const { data: overCaptured, error: overError } = await admin.rpc(
    'find_over_captured_authorizations'
  )

  if (overError) {
    throw new Error(`Replay failed checking capture bound: ${overError.message}`)
  }

  const report: ReplayReport = {
    checkedCards: cards?.length ?? 0,
    drift,
    unbalancedTransactions: (unbalanced ?? []) as ReplayReport['unbalancedTransactions'],
    negativeCardAccounts,
    overCapturedAuthorizations: (overCaptured ?? []) as ReplayReport['overCapturedAuthorizations'],
    ok: false,
  }

  report.ok =
    report.drift.length === 0 &&
    report.unbalancedTransactions.length === 0 &&
    report.negativeCardAccounts.length === 0 &&
    report.overCapturedAuthorizations.length === 0

  return report
}
