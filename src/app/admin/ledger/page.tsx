/**
 * THE LEDGER — where the money is.
 *
 * The position is rendered as a FLOW, not a table of accounts, because the
 * ordering is the explanation: cash arrives at Stripe, waits out clearance,
 * joins the float, lands on a card, gets held at a counter, and ends up owed
 * to a vendor. An operator who can see the sequence can tell which stage is
 * stuck. A flat list of seven balances tells them nothing.
 *
 * Read-only. Every figure here comes from src/lib/admin-queries.ts, which
 * reads the ledger_balances view — the same numbers the invariants check.
 */

import {
  getLedgerPosition,
  getInvariants,
  getWeeklyReconciliation,
  getClearanceQueue,
  getOpenAuthorizations,
  INVARIANT_LABELS,
  type LedgerPosition,
} from '@/lib/admin-queries'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  PageHeader, Section, Panel, Money, Status,
  Table, THead, TH, TBody, TR, TD, Empty,
} from '@/components/ui/primitives'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import {
  Landmark, Hourglass, Layers, CreditCard, Lock, Store, Undo2,
  CircleCheck, CircleAlert, TriangleAlert, ShieldAlert, Inbox,
  CalendarClock, EyeOff, UserCheck, Clock,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const dynamic = 'force-dynamic'

/** The reaper releases a hold at 15 minutes. Anything older got missed. */
const STALE_HOLD_MS = 15 * 60_000

interface Stage {
  key: keyof LedgerPosition
  label: string
  account: string
  icon: LucideIcon
  tint: string
  note: string
}

/**
 * The six stages, in the order value passes through them. The note on each is
 * the whole point of the page — the balance alone does not say why the money
 * is sitting where it is.
 */
const STAGES: Stage[] = [
  {
    key: 'cash_stripe',
    label: 'Cash in',
    account: 'cash_stripe',
    icon: Landmark,
    tint: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    note:
      "Real money, in the Foundation's own Stripe account. Every figure below " +
      'it is a claim against this one, which is why it sits at the top rather ' +
      'than in the list.',
  },
  {
    key: 'donor_clearing',
    label: 'In clearance',
    account: 'donor_clearing',
    icon: Hourglass,
    tint: 'bg-slate-100 text-slate-600 border-slate-200',
    note:
      'Donations received but held for 72 hours, so a chargeback lands on the ' +
      'pool rather than on a card in someone’s pocket. Identified donors ' +
      'clear immediately; anonymous gifts serve the full window.',
  },
  {
    key: 'card_float',
    label: 'Cleared float',
    account: 'card_float',
    icon: Layers,
    tint: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    note:
      'Cleared and spendable, but not yet assigned to anybody. This is what an ' +
      'advocate draws on when they activate a card. A float near zero means the ' +
      'next card cannot be loaded.',
  },
  {
    key: 'on_cards',
    label: 'On cards',
    account: 'card',
    icon: CreditCard,
    tint: 'bg-slate-100 text-slate-600 border-slate-200',
    note:
      'Value sitting on cards right now, across every card in the programme. ' +
      'This is somebody’s groceries. It is the one figure here that belongs ' +
      'to a person rather than to the Foundation.',
  },
  {
    key: 'authorization_hold',
    label: 'Held at a counter',
    account: 'authorization_hold',
    icon: Lock,
    tint: 'bg-amber-50 text-amber-700 border-amber-200',
    note:
      'Reserved by a vendor mid-sale and not yet captured. It has already left ' +
      'the card’s spendable balance, so a stale hold is a person short at a ' +
      'till. Released by capture, by void, or by the 15-minute reaper.',
  },
  {
    key: 'vendor_payable',
    label: 'Owed to vendors',
    account: 'vendor_payable',
    icon: Store,
    tint: 'bg-amber-50 text-amber-700 border-amber-200',
    note:
      'Captured value the Foundation has not yet transferred out. A human ' +
      'clears this from the settlement page. Nothing in the app pays a vendor.',
  },
]

export default async function LedgerPage() {
  const admin = createAdminClient()

  const [position, invariants, weekly, clearance, holds] = await Promise.all([
    getLedgerPosition(admin),
    getInvariants(admin),
    getWeeklyReconciliation(admin, 8),
    getClearanceQueue(admin),
    getOpenAuthorizations(admin),
  ])

  const now = Date.now()

  // Cash at Stripe should equal every claim against it. Reclaimed is in the
  // sum even though it sits off the flow — it is still money owed inward.
  const claims =
    position.donor_clearing +
    position.card_float +
    position.on_cards +
    position.authorization_hold +
    position.vendor_payable +
    position.reclaimed
  const drift = position.cash_stripe - claims

  const failing = invariants.filter(i => !i.passed)
  const clearanceTotal = clearance.reduce((s, c) => s + Number(c.amount_cents), 0)
  const overdueClearance = clearance.filter(c => new Date(c.clearance_due_at).getTime() < now)
  const staleHolds = holds.filter(h => now - new Date(h.opened_at).getTime() > STALE_HOLD_MS)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Ledger"
        description="Every dollar in the programme, at the stage it has reached. Read-only — money moves only through the ledger functions, never from this page."
      />

      {failing.length > 0 && (
        <Panel tone="danger" className="p-4 flex items-start gap-3">
          <TriangleAlert className="h-4 w-4 flex-none text-red-700 mt-0.5" strokeWidth={2} aria-hidden="true" />
          <div className="text-sm">
            <div className="font-semibold text-red-900">
              {failing.length} invariant{failing.length === 1 ? '' : 's'} failing
            </div>
            <p className="text-red-800 mt-0.5">
              Stop and investigate before activating cards or settling vendors. The
              figures below are computed from the same rows the failing check reads.
            </p>
          </div>
        </Panel>
      )}

      {/* ── Position, as a flow ──────────────────────────────────────────── */}
      <Section
        title="Position"
        description="In the order value passes through the system."
      >
        <Panel>
          <ol className="px-4 py-4">
            {STAGES.map((stage, i) => {
              const Icon = stage.icon
              return (
                <li key={stage.key} className="relative flex gap-4 pb-6 last:pb-0">
                  {i < STAGES.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute left-4 top-9 bottom-0 w-px -translate-x-1/2 bg-slate-200"
                    />
                  )}
                  <div
                    className={`relative z-10 h-8 w-8 flex-none rounded-lg border grid place-items-center ${stage.tint}`}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-4">
                      <h3 className="text-sm font-semibold text-slate-900">
                        <span className="mr-2 font-mono text-[10px] font-normal tabular-nums text-slate-400">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        {stage.label}
                      </h3>
                      <Money
                        cents={position[stage.key]}
                        className="flex-none text-base font-semibold text-slate-900"
                      />
                    </div>
                    <div className="flex items-baseline justify-between gap-4">
                      <p className="mt-1 text-xs leading-relaxed text-slate-500 max-w-2xl">
                        {stage.note}
                      </p>
                      <span className="flex-none font-mono text-[10px] uppercase tracking-wide text-slate-400">
                        {stage.account}
                      </span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>

          {/* Reclaimed is deliberately outside the numbered flow: it left a card
              and has not rejoined the float, so it is beside the sequence. */}
          <div className="border-t border-slate-100 px-4 py-3 flex gap-4">
            <div className="h-8 w-8 flex-none rounded-lg border border-slate-200 bg-slate-50 grid place-items-center text-slate-500">
              <Undo2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className="text-sm font-semibold text-slate-900">
                  Reclaimed{' '}
                  <span className="font-normal text-slate-400">— beside the flow</span>
                </h3>
                <Money cents={position.reclaimed} className="flex-none text-base font-semibold text-slate-900" />
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 max-w-2xl">
                Pulled off invalidated cards and parked until it is reissued onto a
                replacement. It has left a card but has not returned to the float,
                so it sits outside the sequence rather than inside it.
              </p>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 rounded-b-xl">
            <div className="flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">Tie-out</span>
                  {drift === 0 ? (
                    <Status tone="ok" icon={CircleCheck}>Balanced</Status>
                  ) : (
                    <Status tone="warn" icon={TriangleAlert}>
                      Out by {formatCAD(Math.abs(drift))}
                    </Status>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 max-w-2xl">
                  Cash in should equal every claim against it. A gap is usually a
                  chargeback that landed on the float after the money had already
                  cleared — the case the nightly reconciliation exists to surface,
                  not a fault in this page.
                </p>
              </div>
              <div className="flex-none text-right">
                <Money cents={claims} className="text-sm font-semibold text-slate-700" />
                <div className="text-[10px] uppercase tracking-wide text-slate-400 mt-0.5">
                  claims against cash
                </div>
              </div>
            </div>
          </div>
        </Panel>
      </Section>

      {/* ── Invariants ───────────────────────────────────────────────────── */}
      <Section
        title="Invariants"
        description="Checked in the database, not here. Any failure is a stop-everything result."
      >
        {invariants.length === 0 ? (
          <Panel>
            <Empty
              icon={ShieldAlert}
              title="The invariant check did not run"
              description="check_ledger_invariants() ships in migration 007. An empty list here means the migration has not been applied to this database, or the RPC returned an error."
            />
          </Panel>
        ) : (
          <Panel className="divide-y divide-slate-100">
            {invariants.map(inv => (
              <div key={inv.invariant} className="flex items-center gap-3 px-4 py-2.5">
                {inv.passed ? (
                  <CircleCheck className="h-4 w-4 flex-none text-emerald-600" strokeWidth={2} aria-hidden="true" />
                ) : (
                  <CircleAlert className="h-4 w-4 flex-none text-red-600" strokeWidth={2} aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-900">
                    {INVARIANT_LABELS[inv.invariant] ?? inv.invariant}
                  </div>
                  <div className="font-mono text-[10px] text-slate-400">{inv.invariant}</div>
                </div>
                {inv.passed ? (
                  <Status tone="ok">Pass</Status>
                ) : (
                  <Status tone="danger">
                    Fail — {inv.offenders} offender{inv.offenders === 1 ? '' : 's'}
                  </Status>
                )}
              </div>
            ))}
          </Panel>
        )}
      </Section>

      {/* ── Weekly reconciliation ────────────────────────────────────────── */}
      <Section
        title="Weekly reconciliation"
        description="Eight weeks of movement, Hamilton time. In on the left, out on the right."
      >
        {weekly.length === 0 ? (
          <Panel>
            <Empty
              icon={CalendarClock}
              title="No weeks with ledger activity yet"
              description="A row appears here the first week a donation clears, a card is activated, or a vendor captures a sale."
            />
          </Panel>
        ) : (
          <Table>
            <THead>
              <TH>Week of</TH>
              <TH align="right">Cleared in</TH>
              <TH align="right">Onto cards</TH>
              <TH align="right">Captured</TH>
              <TH align="right">Settled out</TH>
            </THead>
            <TBody>
              {weekly.map(w => (
                <TR key={w.week_start}>
                  <TD className="whitespace-nowrap">{weekLabel(w.week_start)}</TD>
                  <TD align="right"><Money cents={w.cleared_in_cents} /></TD>
                  <TD align="right"><Money cents={w.activated_cents} /></TD>
                  <TD align="right"><Money cents={w.captured_cents} /></TD>
                  <TD align="right"><Money cents={w.settled_cents} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Section>

      {/* ── Clearance queue ──────────────────────────────────────────────── */}
      <Section
        title="Clearance queue"
        description={
          clearance.length === 0
            ? 'Donations still inside the hold.'
            : `${clearance.length} donation${clearance.length === 1 ? '' : 's'} holding, ${
                overdueClearance.length
              } past due.`
        }
        action={
          clearance.length > 0 ? (
            <div className="text-right">
              <Money cents={clearanceTotal} className="text-sm font-semibold text-slate-900" />
              <div className="text-[10px] uppercase tracking-wide text-slate-400">not yet spendable</div>
            </div>
          ) : undefined
        }
      >
        {clearance.length === 0 ? (
          <Panel>
            <Empty
              icon={Inbox}
              title="Nothing is in clearance"
              description="A donation appears here the moment Stripe confirms it, and leaves when the clearance job releases it into the float."
            />
          </Panel>
        ) : (
          <Table>
            <THead>
              <TH>Received</TH>
              <TH>Donor</TH>
              <TH align="right">Amount</TH>
              <TH>Clears</TH>
              <TH>Status</TH>
            </THead>
            <TBody>
              {clearance.map(c => {
                const due = new Date(c.clearance_due_at).getTime()
                const overdue = due < now
                return (
                  <TR key={c.id}>
                    <TD className="whitespace-nowrap text-slate-500">
                      {formatDateHamilton(c.created_at)}
                    </TD>
                    <TD>
                      <span className="inline-flex items-center gap-1.5">
                        {c.is_anonymous ? (
                          <EyeOff className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} aria-hidden="true" />
                        ) : (
                          <UserCheck className="h-3.5 w-3.5 text-slate-400" strokeWidth={2} aria-hidden="true" />
                        )}
                        {c.is_anonymous ? 'Anonymous — 72 h hold' : 'Identified — clears at once'}
                      </span>
                    </TD>
                    <TD align="right"><Money cents={c.amount_cents} /></TD>
                    <TD className="whitespace-nowrap text-slate-500">
                      {formatDateHamilton(c.clearance_due_at)}
                    </TD>
                    <TD>
                      {overdue ? (
                        <Status tone="warn" icon={TriangleAlert}>
                          Overdue by {duration(now - due)}
                        </Status>
                      ) : (
                        <Status tone="muted" icon={Clock}>
                          Holding — {duration(due - now)} left
                        </Status>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
        {overdueClearance.length > 0 && (
          <p className="text-xs text-slate-500">
            Past due means the clearance cron has not run since the window elapsed.
            Nothing is lost — the money clears on the next run — but the donor&rsquo;s
            gift is not spendable until it does.
          </p>
        )}
      </Section>

      {/* ── Open authorizations ──────────────────────────────────────────── */}
      <Section
        title="Open authorizations"
        description={
          staleHolds.length > 0
            ? `${staleHolds.length} of ${holds.length} older than 15 minutes — the expiry reaper should already have released them.`
            : 'Holds a vendor has opened and not yet closed. Each one is money a member cannot currently spend.'
        }
      >
        {holds.length === 0 ? (
          <Panel>
            <Empty
              icon={Lock}
              title="No holds are open"
              description="A row appears here between a vendor authorizing a sale and capturing it — usually under a minute."
            />
          </Panel>
        ) : (
          <Table>
            <THead>
              <TH>Card</TH>
              <TH>Vendor</TH>
              <TH align="right">Held</TH>
              <TH align="right">Age</TH>
              <TH>Status</TH>
            </THead>
            <TBody>
              {holds.map(h => {
                const age = now - new Date(h.opened_at).getTime()
                const stale = age > STALE_HOLD_MS
                return (
                  <TR key={h.id}>
                    <TD mono>{h.card?.card_code ?? '—'}</TD>
                    <TD>{h.merchant?.name ?? 'Unknown vendor'}</TD>
                    <TD align="right"><Money cents={h.authorized_cents} /></TD>
                    <TD align="right" className="tabular-nums text-slate-500">{duration(age)}</TD>
                    <TD>
                      {stale ? (
                        <Status tone="warn" icon={TriangleAlert}>Stale — reaper missed it</Status>
                      ) : (
                        <Status tone="muted" icon={Clock}>Open</Status>
                      )}
                    </TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>
        )}
        {staleHolds.length > 0 && (
          <p className="text-xs text-slate-500">
            Holds are reaped at the point of use: the next vendor to authorize any
            card in the system releases every stale hold, and the daily cron is the
            backstop. If these persist, no card has been used since they opened.
          </p>
        )}
      </Section>
    </div>
  )
}

/**
 * week_start is a date_trunc taken in Hamilton time and returned without a
 * zone, so it is a wall-clock date. Formatting it at midday UTC keeps it from
 * sliding a day backwards on the server.
 */
function weekLabel(weekStart: string): string {
  return new Date(weekStart.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Coarse duration. Minutes matter for holds, days for clearance. */
function duration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60_000))
  if (mins < 90) return `${mins} min`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.round(hours / 24)} d`
}
