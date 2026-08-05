/**
 * OVERVIEW — the first page of the operator's day.
 *
 * Ordered by what demands action rather than by what is interesting: is the
 * ledger sound, where is the money, what is stuck, what happened. A dashboard
 * that opens on a chart teaches the operator to scroll past the part that
 * decides whether it is safe to move money at all.
 *
 * Every figure here is read from the ledger through admin-queries. The legacy
 * roll-ups this page used to compute (summing the cards and donations tables
 * in the browser's timezone) were a second, quietly diverging account of the
 * same money — and they hid the double-entry system entirely.
 */

import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  getInvariants,
  getLedgerPosition,
  getOpenAuthorizations,
  getClearanceQueue,
  getDailyCaptures,
  getCardCounts,
  INVARIANT_LABELS,
} from '@/lib/admin-queries'
import { computeFlags, type SuspiciousFlag } from '@/lib/admin-flags'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import {
  PageHeader, Section, Panel, Stat, Money, Status,
  Table, THead, TH, TBody, TR, TD, Empty, BarRow,
} from '@/components/ui/primitives'
import {
  ShieldCheck, ShieldAlert, ShieldQuestion, Wallet, Hourglass, Banknote,
  CreditCard, Clock, TriangleAlert, Receipt, ArrowRight, TrendingDown,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * A hold this old is not a stale row, it is a person standing at a counter
 * unable to spend their own balance. Fifteen minutes is longer than any real
 * transaction and short enough that the operator can still fix it today.
 */
const STALE_AUTH_MINUTES = 15

const FLAG_LABELS: Record<SuspiciousFlag['type'], string> = {
  rapid_redemption: 'Repeated spending in one hour',
  velocity_outlier: 'Spending well above this card’s pattern',
  quick_load_redeem: 'Spent within a minute of being loaded',
}

export default async function AdminOverviewPage() {
  const admin = createAdminClient()

  // The layout already refuses non-operators, so nothing here re-checks auth.
  const [invariants, position, openAuths, clearance, daily, cards, flags] = await Promise.all([
    getInvariants(admin),
    getLedgerPosition(admin),
    getOpenAuthorizations(admin),
    getClearanceQueue(admin),
    getDailyCaptures(admin, 14),
    getCardCounts(admin),
    computeFlags().catch((): SuspiciousFlag[] => []),
  ])

  const now = Date.now()
  const failing = invariants.filter(i => !i.passed)

  const staleAuths = openAuths.filter(a => minutesSince(a.opened_at, now) >= STALE_AUTH_MINUTES)
  const overdueClearance = clearance.filter(d => new Date(d.clearance_due_at).getTime() < now)
  const needsAttention = staleAuths.length > 0 || overdueClearance.length > 0

  const today = daily[daily.length - 1]
  const maxDay = Math.max(...daily.map(d => d.cents), 1)
  const windowCents = daily.reduce((s, d) => s + d.cents, 0)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="Where the money sits right now, and what is waiting on a person."
        action={
          <div className="text-right text-xs text-slate-500">
            <div>Hamilton time</div>
            <div className="tabular-nums">{formatDateHamilton(new Date())}</div>
          </div>
        }
      />

      <InvariantBanner invariants={invariants} failing={failing} />

      {/* ── Position ─────────────────────────────────────────────────────── */}
      <Section
        title="Position"
        description="Read from the ledger, not from the card table."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <Stat
            label="On cards"
            value={formatCAD(position.on_cards)}
            sub="Held by members, spendable now"
            icon={CreditCard}
          />
          <Stat
            label="Float available"
            value={formatCAD(position.card_float)}
            sub={
              position.card_float < 0
                ? 'Negative — the pool is carrying a loss'
                : 'Cleared, ready to activate onto cards'
            }
            icon={Wallet}
            tone={position.card_float < 0 ? 'danger' : 'positive'}
          />
          <Stat
            label="In clearance"
            value={formatCAD(position.donor_clearing)}
            sub={
              clearance.length > 0
                ? `${clearance.length} donation${clearance.length === 1 ? '' : 's'} held, not yet spendable`
                : 'Nothing inside the clearance hold'
            }
            icon={Hourglass}
          />
          <Stat
            label="Owed to vendors"
            value={formatCAD(position.vendor_payable)}
            sub="Captured, not yet paid out — open settlement"
            icon={Banknote}
            tone={position.vendor_payable > 0 ? 'warning' : 'neutral'}
            href="/admin/settlement"
          />
        </div>

        {position.card_float < 0 && (
          <Panel tone="danger" className="p-4">
            <div className="flex items-start gap-3">
              <TrendingDown className="h-4 w-4 flex-none text-red-700 mt-0.5" strokeWidth={2} aria-hidden="true" />
              <div className="text-sm text-red-900 space-y-1">
                <div className="font-semibold">
                  The float is negative by <Money cents={Math.abs(position.card_float)} className="text-red-900" />
                </div>
                <p className="text-red-800">
                  A chargeback reversed money that had already cleared and been
                  spent, so the pool absorbed the loss. This is the intended
                  behaviour — no card was clawed back — but the shortfall is
                  real and stays until new donations clear into the float.
                  Activating cards now spends money the programme does not have.
                </p>
              </div>
            </div>
          </Panel>
        )}

        {/* The rest of the identity: cash in ≈ clearing + float + on cards +
            holds + payables. Quiet, because it is context, not a decision. */}
        <Panel className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          <QuietFigure
            label="Cash at Stripe"
            cents={position.cash_stripe}
            hint="Everything donors have paid in"
          />
          <QuietFigure
            label="In open holds"
            cents={position.authorization_hold}
            hint={`${openAuths.length} authorisation${openAuths.length === 1 ? '' : 's'} not yet captured`}
          />
          <QuietFigure
            label="Reclaimed"
            cents={position.reclaimed}
            hint="From invalidated cards, awaiting reissue"
          />
        </Panel>
      </Section>

      {/* ── Attention ────────────────────────────────────────────────────── */}
      {needsAttention && (
        <Section
          title="Needs attention"
          description="Nothing here clears itself."
        >
          <div className="space-y-4">
            {staleAuths.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  <Clock className="h-4 w-4 text-amber-600" strokeWidth={2} aria-hidden="true" />
                  {staleAuths.length} authorisation{staleAuths.length === 1 ? '' : 's'} open
                  longer than {STALE_AUTH_MINUTES} minutes
                </div>
                <p className="text-xs text-slate-500 max-w-2xl">
                  Each one is money a member cannot spend right now. Capture it
                  if the sale happened, void it if it did not.
                </p>
                <Table>
                  <THead>
                    <TH>Card</TH>
                    <TH>Vendor</TH>
                    <TH align="right">Held</TH>
                    <TH align="right">Open for</TH>
                    <TH>State</TH>
                  </THead>
                  <TBody>
                    {staleAuths.map(a => {
                      const expired = new Date(a.expires_at).getTime() < now
                      return (
                        <TR key={a.id}>
                          <TD mono>{a.card?.card_code ?? '—'}</TD>
                          <TD>{a.merchant?.name ?? 'Unknown vendor'}</TD>
                          <TD align="right"><Money cents={a.authorized_cents} /></TD>
                          <TD align="right" className="tabular-nums text-slate-600">
                            {humanDuration(minutesSince(a.opened_at, now))}
                          </TD>
                          <TD>
                            {expired ? (
                              <Status tone="danger" icon={TriangleAlert}>Past expiry</Status>
                            ) : (
                              <Status tone="warn" icon={Clock}>Still open</Status>
                            )}
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              </div>
            )}

            {overdueClearance.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  <Hourglass className="h-4 w-4 text-amber-600" strokeWidth={2} aria-hidden="true" />
                  {overdueClearance.length} donation{overdueClearance.length === 1 ? '' : 's'} past
                  the clearance hold, worth{' '}
                  <Money cents={overdueClearance.reduce((s, d) => s + d.amount_cents, 0)} />
                </div>
                <p className="text-xs text-slate-500 max-w-2xl">
                  These should already have moved into the float. If the list is
                  growing, the clearance cron is not running — check it before
                  clearing anything by hand.
                </p>
                <Table>
                  <THead>
                    <TH>Donation</TH>
                    <TH align="right">Amount</TH>
                    <TH>Due</TH>
                    <TH align="right">Overdue by</TH>
                    <TH>Donor</TH>
                  </THead>
                  <TBody>
                    {overdueClearance.map(d => (
                      <TR key={d.id}>
                        <TD mono>{d.id.slice(0, 8)}</TD>
                        <TD align="right"><Money cents={d.amount_cents} /></TD>
                        <TD className="text-slate-600">{formatDateHamilton(d.clearance_due_at)}</TD>
                        <TD align="right" className="tabular-nums text-slate-600">
                          {humanDuration(minutesSince(d.clearance_due_at, now))}
                        </TD>
                        <TD>
                          {d.is_anonymous
                            ? <Status tone="muted">Anonymous</Status>
                            : <Status tone="muted">Named</Status>}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ── Activity ─────────────────────────────────────────────────────── */}
      <Section
        title="Activity"
        description="Captures per day in Hamilton time, last 14 days."
        action={
          <Link
            href="/admin/redemptions"
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            All redemptions
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </Link>
        }
      >
        <Panel className="p-4 space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Today
              </div>
              <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-slate-900">
                {formatCAD(today?.cents ?? 0)}
              </div>
            </div>
            <div className="text-sm text-slate-500">
              {today?.count ?? 0} capture{(today?.count ?? 0) === 1 ? '' : 's'}
              <span className="mx-2 text-slate-300">·</span>
              {formatCAD(windowCents)} over 14 days
            </div>
          </div>

          {windowCents > 0 ? (
            <div>
              {daily.map((d, i) => (
                <BarRow
                  key={d.iso}
                  label={i === daily.length - 1 ? 'Today' : dayLabel(d.label, d.iso)}
                  value={d.cents}
                  max={maxDay}
                  formatted={formatCAD(d.cents)}
                />
              ))}
            </div>
          ) : (
            <Empty
              icon={Receipt}
              title="No captures in the last 14 days"
              description="A bar appears here when a vendor completes a sale against a card."
            />
          )}
        </Panel>
      </Section>

      {/* ── Suspicious patterns ──────────────────────────────────────────── */}
      {flags.length > 0 && (
        <Section
          title="Suspicious patterns"
          description="Velocity signals from the last 24 hours. A signal is a reason to look, never a reason to block a card."
        >
          <Panel tone="warning" className="divide-y divide-amber-200">
            {flags.map((f, i) => (
              <div key={`${f.card_id}-${f.type}-${i}`} className="flex items-start gap-3 px-4 py-3">
                <TriangleAlert
                  className="h-4 w-4 flex-none text-amber-600 mt-0.5"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <div className="min-w-0 space-y-0.5 text-sm">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="font-medium text-slate-900">
                      {FLAG_LABELS[f.type] ?? f.type}
                    </span>
                    <Link
                      href={`/admin/cards?q=${encodeURIComponent(f.card_code)}`}
                      className="font-mono text-xs text-slate-600 underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
                    >
                      {f.card_code}
                    </Link>
                  </div>
                  <div className="text-slate-700">{f.detail}</div>
                  <div className="text-xs text-slate-500">{formatDateHamilton(f.occurred_at)}</div>
                </div>
              </div>
            ))}
          </Panel>
        </Section>
      )}

      {/* ── Card inventory ───────────────────────────────────────────────── */}
      <Section
        title="Card inventory"
        description="Physical cards issued against this programme."
        action={
          <Link
            href="/admin/cards"
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            All cards
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </Link>
        }
      >
        {cards.total === 0 ? (
          <Panel>
            <Empty
              icon={CreditCard}
              title="No cards exist yet"
              description="Cards appear here once a batch is generated on the Print cards page."
              action={
                <Link
                  href="/admin/print-cards"
                  className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Print a batch
                </Link>
              }
            />
          </Panel>
        ) : (
          <Panel className="overflow-hidden">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-slate-200">
              <CountCell label="Total" value={cards.total} hint="All states" />
              <CountCell label="Unloaded" value={cards.unloaded} hint="Printed, no money yet" />
              <CountCell label="Active" value={cards.active} hint="Carrying a balance" />
              <CountCell label="Exhausted" value={cards.exhausted} hint="Spent to zero" />
              <CountCell label="Invalidated" value={cards.invalidated} hint="Lost, stolen, reissued" />
              <CountCell label="Expired" value={cards.expired} hint="Past their end date" />
            </div>
          </Panel>
        )}
      </Section>
    </div>
  )
}

// ── Invariant banner ───────────────────────────────────────────────────────

/**
 * When the ledger is sound this is one grey line, because shouting about
 * normality is how a console trains its operator to ignore it. When a rule
 * fails it takes over the top of the page.
 *
 * An empty result is neither: a check that did not run has proved nothing,
 * and saying "all clear" on its behalf would be a lie.
 */
function InvariantBanner({
  invariants,
  failing,
}: {
  invariants: { invariant: string; passed: boolean; offenders: number }[]
  failing: { invariant: string; passed: boolean; offenders: number }[]
}) {
  if (invariants.length === 0) {
    return (
      <Panel tone="warning" className="px-4 py-3">
        <div className="flex items-start gap-2.5 text-sm">
          <ShieldQuestion className="h-4 w-4 flex-none text-amber-700 mt-0.5" strokeWidth={2} aria-hidden="true" />
          <div>
            <span className="font-semibold text-amber-900">Invariant check did not run.</span>{' '}
            <span className="text-amber-800">
              The ledger is unverified, which is not the same as sound. Confirm
              check_ledger_invariants() exists and the service role can call it
              before treating any figure on this page as settled.
            </span>
          </div>
        </div>
      </Panel>
    )
  }

  if (failing.length === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <ShieldCheck className="h-3.5 w-3.5 flex-none text-emerald-600" strokeWidth={2} aria-hidden="true" />
        All {invariants.length} ledger invariants pass. Checked just now.
      </div>
    )
  }

  return (
    <Panel tone="danger" className="overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3.5 border-b border-red-200">
        <ShieldAlert className="h-5 w-5 flex-none text-red-700 mt-0.5" strokeWidth={2} aria-hidden="true" />
        <div>
          <h2 className="text-sm font-semibold text-red-900">
            Stop — do not load real money.
          </h2>
          <p className="mt-0.5 text-sm text-red-800 max-w-2xl">
            {failing.length} of {invariants.length} ledger invariants{' '}
            {failing.length === 1 ? 'is' : 'are'} failing. Until every rule
            passes, the balances below cannot be trusted and no card should be
            activated or settled.
          </p>
        </div>
      </div>
      <ul className="divide-y divide-red-200">
        {failing.map(f => (
          <li key={f.invariant} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
            <div className="min-w-0">
              <div className="font-medium text-red-900">
                {INVARIANT_LABELS[f.invariant] ?? f.invariant}
              </div>
              <div className="font-mono text-xs text-red-700/80">{f.invariant}</div>
            </div>
            <div className="flex-none text-right">
              <div className="text-sm font-semibold tabular-nums text-red-900">{f.offenders}</div>
              <div className="text-xs text-red-700/80">
                offending {f.offenders === 1 ? 'row' : 'rows'}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

// ── Small cells ────────────────────────────────────────────────────────────

function QuietFigure({ label, cents, hint }: { label: string; cents: number; hint: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-base font-semibold text-slate-900">
        <Money cents={cents} />
      </div>
      <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
    </div>
  )
}

function CountCell({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-xl font-semibold tabular-nums text-slate-900">{value}</div>
      <div className="mt-0.5 text-xs font-medium text-slate-700">{label}</div>
      <div className="text-[11px] text-slate-500">{hint}</div>
    </div>
  )
}

// ── Time helpers ───────────────────────────────────────────────────────────

function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
}

function humanDuration(mins: number): string {
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** Fourteen bars means two of every weekday, so the date has to be on it. */
function dayLabel(weekday: string, iso: string): string {
  const day = Number(iso.slice(8, 10))
  return Number.isFinite(day) ? `${weekday} ${day}` : weekday
}
