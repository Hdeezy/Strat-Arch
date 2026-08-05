/**
 * OPERATOR CONSOLE DATA.
 *
 * Every read the admin pages need, in one place, so no page invents its own
 * version of "what is the float". Read-only throughout — nothing here writes,
 * and money still moves only through src/ledger/.
 *
 * The views and functions these call all exist as of migration 007. Until
 * now nothing in the UI read any of them, which meant the operator had a
 * double-entry ledger they could not see.
 */

import { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

// ── Position ───────────────────────────────────────────────────────────────

export interface LedgerPosition {
  cash_stripe: number
  donor_clearing: number
  card_float: number
  authorization_hold: number
  vendor_payable: number
  reclaimed: number
  on_cards: number
}

/**
 * Where every dollar currently sits.
 *
 * These should reconcile: cash in ≈ clearing + float + on cards + holds +
 * payables. They will not tie to the cent while a chargeback is outstanding,
 * which is exactly the case the nightly job exists to surface.
 */
export async function getLedgerPosition(admin: Admin): Promise<LedgerPosition> {
  const { data } = await admin
    .from('ledger_balances')
    .select('account_type, balance_cents, card_id')

  const rows = (data ?? []) as { account_type: string; balance_cents: number; card_id: string | null }[]
  const sumOf = (t: string) =>
    rows.filter(r => r.account_type === t).reduce((s, r) => s + Number(r.balance_cents), 0)

  return {
    cash_stripe: sumOf('cash_stripe'),
    donor_clearing: sumOf('donor_clearing'),
    card_float: sumOf('card_float'),
    authorization_hold: sumOf('authorization_hold'),
    vendor_payable: sumOf('vendor_payable'),
    reclaimed: sumOf('reclaimed'),
    on_cards: sumOf('card'),
  }
}

// ── Invariants ─────────────────────────────────────────────────────────────

export interface Invariant {
  invariant: string
  passed: boolean
  offenders: number
}

/** The five rules. Anything false is a stop-everything result. */
export async function getInvariants(admin: Admin): Promise<Invariant[]> {
  const { data, error } = await admin.rpc('check_ledger_invariants')
  if (error) return []
  return ((data ?? []) as Invariant[]).map(i => ({
    invariant: i.invariant,
    passed: i.passed === true,
    offenders: Number(i.offenders ?? 0),
  }))
}

export const INVARIANT_LABELS: Record<string, string> = {
  entries_sum_to_zero: 'Every transaction balances',
  no_negative_card_balances: 'No card is overdrawn',
  balances_equal_replay: 'Balances match a replay of history',
  capture_within_auth: 'No vendor captured more than authorised',
  append_only_guards_present: 'History cannot be rewritten',
}

// ── Clearance ──────────────────────────────────────────────────────────────

export interface ClearanceRow {
  id: string
  amount_cents: number
  is_anonymous: boolean
  clearance_due_at: string
  created_at: string
}

/**
 * Donations still inside the hold. This money is real but not yet spendable —
 * the gap that stops a chargeback landing on a card in someone's pocket.
 */
export async function getClearanceQueue(admin: Admin): Promise<ClearanceRow[]> {
  const { data } = await admin
    .from('donations')
    .select('id, amount_cents, is_anonymous, clearance_due_at, created_at')
    .is('cleared_at', null)
    .is('reversed_at', null)
    .order('clearance_due_at', { ascending: true })
    .limit(100)
  return (data ?? []) as ClearanceRow[]
}

// ── Open authorizations ────────────────────────────────────────────────────

export interface OpenAuth {
  id: string
  card_id: string
  merchant_id: string
  authorized_cents: number
  opened_at: string
  expires_at: string
  merchant: { name: string } | null
  card: { card_code: string } | null
}

/**
 * Holds nobody has closed. Each one is money a member cannot currently
 * spend, so an old one is a person short at a counter, not just a stale row.
 */
export async function getOpenAuthorizations(admin: Admin): Promise<OpenAuth[]> {
  const { data } = await admin
    .from('authorizations')
    .select('id, card_id, merchant_id, authorized_cents, opened_at, expires_at, merchant:merchants(name), card:cards(card_code)')
    .eq('status', 'open')
    .order('opened_at', { ascending: true })
    .limit(50)
  return (data ?? []) as unknown as OpenAuth[]
}

// ── Settlement ─────────────────────────────────────────────────────────────

export interface SettlementRow {
  merchant_id: string
  merchant_name: string
  merchant_address: string
  payout_schedule_days: number
  outstanding_cents: number
  last_settled_at: string | null
}

/** Who is owed what. A list a human acts on — nothing here pays anybody. */
export async function getSettlementInstructions(admin: Admin): Promise<SettlementRow[]> {
  const { data } = await admin.from('settlement_instructions').select('*')
  return (data ?? []) as SettlementRow[]
}

export interface WeeklyRow {
  week_start: string
  captured_cents: number
  settled_cents: number
  cleared_in_cents: number
  activated_cents: number
}

export async function getWeeklyReconciliation(admin: Admin, limit = 8): Promise<WeeklyRow[]> {
  const { data } = await admin
    .from('weekly_reconciliation')
    .select('*')
    .limit(limit)
  return (data ?? []) as WeeklyRow[]
}

// ── Activity ───────────────────────────────────────────────────────────────

export interface DailyTotal {
  label: string
  iso: string
  cents: number
  count: number
}

/**
 * Captures per day for the last N days, in Hamilton time.
 *
 * Read from ledger transactions rather than the legacy redemptions table, so
 * this stays right once that table is retired.
 */
export async function getDailyCaptures(admin: Admin, days = 14): Promise<DailyTotal[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString()

  const { data } = await admin
    .from('redemptions')
    .select('amount_cents, occurred_at, status')
    .gte('occurred_at', since)
    .eq('status', 'succeeded')

  const rows = (data ?? []) as { amount_cents: number; occurred_at: string }[]
  const buckets = new Map<string, { cents: number; count: number }>()

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000)
    buckets.set(hamiltonDay(d), { cents: 0, count: 0 })
  }
  for (const r of rows) {
    const key = hamiltonDay(new Date(r.occurred_at))
    const b = buckets.get(key)
    if (b) {
      b.cents += Number(r.amount_cents)
      b.count += 1
    }
  }

  return Array.from(buckets.entries()).map(([iso, v]) => ({
    iso,
    label: new Date(iso + 'T12:00:00Z').toLocaleDateString('en-CA', {
      weekday: 'short',
      timeZone: 'UTC',
    }),
    cents: v.cents,
    count: v.count,
  }))
}

function hamiltonDay(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
}

// ── Cards ──────────────────────────────────────────────────────────────────

export interface CardCounts {
  total: number
  unloaded: number
  active: number
  exhausted: number
  invalidated: number
  expired: number
}

export async function getCardCounts(admin: Admin): Promise<CardCounts> {
  const { data } = await admin.from('cards').select('state')
  const rows = (data ?? []) as { state: string }[]
  const n = (s: string) => rows.filter(r => r.state === s).length
  return {
    total: rows.length,
    unloaded: n('unloaded'),
    active: n('active'),
    exhausted: n('exhausted'),
    invalidated: n('invalidated'),
    expired: n('expired'),
  }
}

// ── Safety signals ─────────────────────────────────────────────────────────

export interface EnumerationSignal {
  source_hash: string
  distinct_cards: number
  total_lookups: number
  last_seen: string
}

/**
 * One source touching many DIFFERENT cards is the signature of someone other
 * than the member. Scrappy Cut §3a: log and alert, never silently block — a
 * member checking their own balance repeatedly is someone budgeting.
 */
export async function getEnumerationSignals(
  admin: Admin,
  hours = 24,
  threshold = 5
): Promise<EnumerationSignal[]> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString()
  const { data } = await admin
    .from('credential_lookups')
    .select('source_hash, card_id, looked_up_at')
    .gte('looked_up_at', since)
    .limit(5000)

  const rows = (data ?? []) as { source_hash: string; card_id: string | null; looked_up_at: string }[]
  const bySource = new Map<string, { cards: Set<string>; total: number; last: string }>()

  for (const r of rows) {
    let e = bySource.get(r.source_hash)
    if (!e) {
      e = { cards: new Set(), total: 0, last: r.looked_up_at }
      bySource.set(r.source_hash, e)
    }
    if (r.card_id) e.cards.add(r.card_id)
    e.total += 1
    if (r.looked_up_at > e.last) e.last = r.looked_up_at
  }

  return Array.from(bySource.entries())
    .map(([source_hash, v]) => ({
      source_hash,
      distinct_cards: v.cards.size,
      total_lookups: v.total,
      last_seen: v.last,
    }))
    .filter(s => s.distinct_cards >= threshold)
    .sort((a, b) => b.distinct_cards - a.distinct_cards)
}
