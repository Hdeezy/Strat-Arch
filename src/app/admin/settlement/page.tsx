/**
 * SETTLEMENT — who gets paid.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  THIS PAGE PRODUCES A LIST. IT DOES NOT MOVE MONEY.                  │
 * │                                                                      │
 * │  Shape decision 7 and the RPAA boundary: no file in the settlement   │
 * │  path may call a banking or payout API, and a lint rule on           │
 * │  `.payouts` / `.transfers` enforces it. A human reads the list,      │
 * │  makes the transfers, and then records that they did.                │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * The design follows from that. There is no primary action button, because a
 * button here would either be a lie or a law-breaking feature request. The
 * deliverable is a set of lines an operator carries to their bank, so the one
 * piece of interactivity on the page is copying a line without a typo.
 */

import { getSettlementInstructions } from '@/lib/admin-queries'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  PageHeader, Section, Panel, Money, Status,
  Table, THead, TH, TBody, TR, TD, Empty,
} from '@/components/ui/primitives'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import { Banknote, Store, HandCoins, TriangleAlert, Info } from 'lucide-react'
import { CopyButton } from './copy-button'

export const dynamic = 'force-dynamic'

const DAY_MS = 86_400_000

export default async function SettlementPage() {
  const admin = createAdminClient()
  const rows = await getSettlementInstructions(admin)

  // Same period end the settlement cron stamps, so a line copied from this
  // page and a line read out of the cron log carry the same reference.
  const periodEnd = new Date().toISOString().slice(0, 10)
  const now = Date.now()

  const total = rows.reduce((s, r) => s + Number(r.outstanding_cents), 0)
  const neverSettled = rows.filter(r => !r.last_settled_at)

  const lines = rows.map(r => ({
    merchantId: r.merchant_id,
    text: transferLine(r.merchant_name, Number(r.outstanding_cents), r.merchant_id, periodEnd),
  }))

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settlement"
        description="What each vendor is owed, and the lines a person takes to the bank. Nothing on this page pays anybody."
      />

      {/* ── The boundary, stated before the numbers ──────────────────────── */}
      <Panel tone="dark" className="p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl space-y-2">
            <div className="flex items-center gap-2">
              <HandCoins className="h-4 w-4 flex-none text-emerald-400" strokeWidth={2} aria-hidden="true" />
              <h2 className="text-sm font-semibold text-white">
                These are instructions. A human makes the transfers.
              </h2>
            </div>
            <p className="text-sm leading-relaxed text-slate-300">
              The HOPE Card system holds funds and keeps the books; it does not
              transmit money to vendors. Payouts are made by a person, from the
              Foundation&rsquo;s own bank, using the lines below. That is the RPAA
              boundary and shape decision 7 of the governing spec — not a missing
              feature, and not a &ldquo;pay now&rdquo; button somebody forgot to wire
              up.
            </p>
            <p className="text-sm leading-relaxed text-slate-400">
              A lint rule blocks any call to <code className="font-mono text-xs text-slate-300">.payouts</code>{' '}
              or <code className="font-mono text-xs text-slate-300">.transfers</code> anywhere in the
              settlement path, so the boundary survives the next person who tries to
              automate it.
            </p>
          </div>
          <div className="flex-none sm:text-right">
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
              Total outstanding
            </div>
            <Money cents={total} className="block mt-1 text-3xl font-semibold text-white" />
            <div className="mt-1 text-xs text-slate-400">
              {rows.length === 0
                ? 'no vendor is owed anything'
                : `across ${rows.length} vendor${rows.length === 1 ? '' : 's'}` +
                  (neverSettled.length > 0
                    ? `, ${neverSettled.length} never settled before`
                    : '')}
            </div>
          </div>
        </div>
      </Panel>

      {rows.length === 0 ? (
        <Panel>
          <Empty
            icon={Store}
            title="No vendor is owed anything right now."
            description="A vendor appears here as soon as they capture a sale. The row leaves once the payment has been made and recorded against their payable."
          />
        </Panel>
      ) : (
        <>
          {/* ── Who is owed what ─────────────────────────────────────────── */}
          <Section
            title="Outstanding by vendor"
            description="Read straight from the vendor payable accounts. Largest first."
          >
            <Table>
              <THead>
                <TH>Vendor</TH>
                <TH>Address</TH>
                <TH align="right">Outstanding</TH>
                <TH>Last settled</TH>
                <TH>Payout schedule</TH>
              </THead>
              <TBody>
                {rows.map(r => {
                  const lastMs = r.last_settled_at ? new Date(r.last_settled_at).getTime() : null
                  const daysSince = lastMs === null ? null : Math.floor((now - lastMs) / DAY_MS)
                  const overdue =
                    daysSince !== null && daysSince > Number(r.payout_schedule_days)
                  return (
                    <TR key={r.merchant_id}>
                      <TD className="font-medium text-slate-900 whitespace-nowrap">
                        {r.merchant_name}
                      </TD>
                      <TD className="text-slate-500 max-w-xs truncate">
                        {r.merchant_address}
                      </TD>
                      <TD align="right" className="font-medium text-slate-900">
                        <Money cents={r.outstanding_cents} />
                      </TD>
                      <TD className="whitespace-nowrap text-slate-500">
                        {r.last_settled_at ? (
                          <>
                            {formatDateHamilton(r.last_settled_at)}
                            {daysSince !== null && (
                              <span className="text-slate-400"> · {daysSince} d ago</span>
                            )}
                          </>
                        ) : (
                          <Status tone="muted">Never settled</Status>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap">
                        <span className="text-slate-500">
                          Every {r.payout_schedule_days} day
                          {Number(r.payout_schedule_days) === 1 ? '' : 's'}
                        </span>
                        {overdue && (
                          <span className="ml-2">
                            <Status tone="warn" icon={TriangleAlert}>Past schedule</Status>
                          </span>
                        )}
                      </TD>
                    </TR>
                  )
                })}
                <TR className="bg-slate-50 hover:bg-slate-50">
                  <TD className="font-semibold text-slate-900">Total</TD>
                  <TD />
                  <TD align="right" className="font-semibold text-slate-900">
                    <Money cents={total} />
                  </TD>
                  <TD />
                  <TD />
                </TR>
              </TBody>
            </Table>
          </Section>

          {/* ── The lines a person carries to the bank ───────────────────── */}
          <Section
            title="Transfer lines"
            description="One line per vendor for the bank's memo field. The reference is the ledger's idempotency key, so the same payment cannot be recorded twice."
            action={
              <CopyButton text={lines.map(l => l.text).join('\n')} label="Copy all lines" />
            }
          >
            <Panel className="divide-y divide-slate-100">
              {lines.map(l => (
                <div key={l.merchantId} className="flex items-start gap-3 px-4 py-3">
                  <code className="min-w-0 flex-1 font-mono text-xs leading-relaxed text-slate-700 break-words">
                    {l.text}
                  </code>
                  <CopyButton text={l.text} />
                </div>
              ))}
            </Panel>
          </Section>
        </>
      )}

      {/* ── The honest gap ───────────────────────────────────────────────── */}
      <Panel tone="warning" className="p-4">
        <div className="flex items-start gap-3">
          <Info className="h-4 w-4 flex-none text-amber-700 mt-0.5" strokeWidth={2} aria-hidden="true" />
          <div className="text-sm space-y-2">
            <div className="font-semibold text-amber-900">
              Recording a payment has no screen yet
            </div>
            <p className="text-amber-800 leading-relaxed">
              Once the transfer has actually left the bank, the payable has to be
              discharged against cash —{' '}
              <code className="font-mono text-xs">recordSettlement()</code> in{' '}
              <code className="font-mono text-xs">src/ledger/index.ts</code> does exactly
              that, and is keyed{' '}
              <code className="font-mono text-xs">settle:{'{merchant_id}'}:{'{period_end}'}</code>{' '}
              so calling it twice for the same period is a no-op.
            </p>
            <p className="text-amber-800 leading-relaxed">
              There is no UI for it. Until there is, a vendor stays on this list after
              they have been paid and the figures above overstate what is owed. That is
              a gap in this console, not in the ledger — and it is stated here rather
              than hidden behind a button that would not work.
            </p>
          </div>
        </div>
      </Panel>

      <p className="flex items-start gap-2 text-xs text-slate-500">
        <Banknote className="h-3.5 w-3.5 flex-none mt-0.5 text-slate-400" strokeWidth={2} aria-hidden="true" />
        <span>
          The weekly settlement cron writes the same list to the logs. This page and
          that job read one view, so they cannot disagree.
        </span>
      </p>
    </div>
  )
}

/**
 * The memo a bank transfer carries. Vendor and amount are for the human doing
 * the transfer; the reference is for the ledger, and matches the idempotency
 * key recordSettlement() will use when the payment is recorded.
 */
function transferLine(
  vendor: string,
  cents: number,
  merchantId: string,
  periodEnd: string
): string {
  return `HOPE Card settlement — ${vendor} — ${formatCAD(cents)} — period ending ${periodEnd} — ref settle:${merchantId}:${periodEnd}`
}
