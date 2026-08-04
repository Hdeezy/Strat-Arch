/**
 * DONATIONS — money in, and whether it is spendable yet.
 *
 * A donation has three fates: it clears into the float, it is still inside
 * the 72-hour hold, or the network reversed it. The previous version of this
 * page showed none of that, which made a reversed gift look identical to a
 * cleared one and the "total raised" figure quietly wrong.
 *
 * Reversed donations are excluded from the raised total for exactly that
 * reason — that money is gone, and a figure that includes it is a figure that
 * will be used to promise cards nobody can fund.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import {
  PageHeader, Panel, Stat, Money, Status,
  Table, THead, TH, TBody, TR, TD, Empty,
} from '@/components/ui/primitives'
import {
  HeartHandshake, Hourglass, CircleCheck, Undo2, TriangleAlert,
  EyeOff, UserCheck, FileText,
} from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const WINDOW = 200

interface DonationRow {
  id: string
  amount_cents: number
  donor_email: string | null
  donor_note: string | null
  receipt_requested: boolean
  receipt_issued_at: string | null
  is_anonymous: boolean
  clearance_due_at: string
  cleared_at: string | null
  reversed_at: string | null
  created_at: string
  card: { card_code: string } | null
}

export default async function AdminDonationsPage() {
  const admin = createAdminClient()

  const { data } = await admin
    .from('donations')
    .select(
      'id, amount_cents, donor_email, donor_user_id, donor_note, receipt_requested, receipt_issued_at, is_anonymous, clearance_due_at, cleared_at, reversed_at, created_at, card:cards(card_code)'
    )
    .order('created_at', { ascending: false })
    .limit(WINDOW)

  const donations = (data ?? []) as unknown as DonationRow[]
  const now = Date.now()

  const cleared = donations.filter(d => d.cleared_at && !d.reversed_at)
  const reversed = donations.filter(d => d.reversed_at)
  const holding = donations.filter(d => !d.cleared_at && !d.reversed_at)
  const overdue = holding.filter(d => new Date(d.clearance_due_at).getTime() < now)

  const sum = (rows: DonationRow[]) => rows.reduce((s, d) => s + Number(d.amount_cents), 0)
  const raised = sum(cleared) + sum(holding)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Donations"
        description={`Every gift received, newest first, and where each one sits in the 72-hour clearance hold. Figures cover the ${WINDOW} most recent donations.`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Raised"
          value={formatCAD(raised)}
          icon={HeartHandshake}
          tone="positive"
          sub={`${cleared.length + holding.length} gift${cleared.length + holding.length === 1 ? '' : 's'}, reversals excluded`}
        />
        <Stat
          label="Cleared"
          value={formatCAD(sum(cleared))}
          icon={CircleCheck}
          sub={`${cleared.length} released into the float`}
        />
        <Stat
          label="In clearance"
          value={formatCAD(sum(holding))}
          icon={Hourglass}
          tone={overdue.length > 0 ? 'warning' : 'neutral'}
          sub={
            overdue.length > 0
              ? `${holding.length} holding · ${overdue.length} past due`
              : `${holding.length} holding, not yet spendable`
          }
        />
        <Stat
          label="Reversed"
          value={formatCAD(sum(reversed))}
          icon={Undo2}
          tone={reversed.length > 0 ? 'danger' : 'neutral'}
          sub={`${reversed.length} chargeback${reversed.length === 1 ? '' : 's'}`}
        />
      </div>

      {overdue.length > 0 && (
        <Panel tone="warning" className="flex items-start gap-3 p-4">
          <TriangleAlert
            className="mt-0.5 h-4 w-4 flex-none text-amber-700"
            strokeWidth={2}
            aria-hidden="true"
          />
          <div className="text-sm">
            <div className="font-semibold text-amber-900">
              {overdue.length} donation{overdue.length === 1 ? '' : 's'} past the clearance window
            </div>
            <p className="mt-0.5 text-amber-800">
              The hold has elapsed but the money has not joined the float, so no card can
              be loaded from it. That is the clearance job not running, not a donor
              problem — check <Link href="/admin/ledger" className="underline underline-offset-2">the ledger</Link>.
            </p>
          </div>
        </Panel>
      )}

      {donations.length === 0 ? (
        <Panel>
          <Empty
            icon={HeartHandshake}
            title="No donations yet"
            description="A row lands here the moment Stripe confirms a payment against a card code. Nothing appears for an abandoned checkout."
          />
        </Panel>
      ) : (
        <Table>
          <THead>
            <TH>Received</TH>
            <TH>Donor</TH>
            <TH>Card</TH>
            <TH align="right">Amount</TH>
            <TH>Clearance</TH>
            <TH className="hidden lg:table-cell">Receipt</TH>
          </THead>
          <TBody>
            {donations.map(d => (
              <TR key={d.id}>
                <TD className="whitespace-nowrap text-xs text-slate-500">
                  {formatDateHamilton(d.created_at)}
                </TD>
                <TD>
                  <span className="inline-flex items-center gap-1.5">
                    {d.is_anonymous ? (
                      <EyeOff className="h-3.5 w-3.5 flex-none text-slate-400" strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <UserCheck className="h-3.5 w-3.5 flex-none text-slate-400" strokeWidth={2} aria-hidden="true" />
                    )}
                    <span className="text-slate-700">
                      {d.is_anonymous ? 'Anonymous' : d.donor_email ?? 'Identified'}
                    </span>
                  </span>
                </TD>
                <TD>
                  {d.card ? (
                    <Link
                      href={`/admin/cards?q=${encodeURIComponent(d.card.card_code)}`}
                      className="font-mono text-xs font-semibold text-slate-900 hover:text-emerald-700"
                    >
                      {d.card.card_code}
                    </Link>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </TD>
                <TD align="right" className="font-medium text-slate-900">
                  <Money cents={d.amount_cents} />
                </TD>
                <TD>
                  <ClearanceStatus donation={d} now={now} />
                </TD>
                <TD className="hidden lg:table-cell">
                  {d.receipt_issued_at ? (
                    <Status tone="ok" icon={FileText}>Issued</Status>
                  ) : d.receipt_requested ? (
                    <Status tone="warn" icon={FileText}>Requested</Status>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  )
}

/**
 * Held vs cleared vs reversed is the single most useful thing on this page:
 * only cleared money can load a card, and only reversed money has left.
 */
function ClearanceStatus({ donation, now }: { donation: DonationRow; now: number }) {
  if (donation.reversed_at) {
    return (
      <span className="inline-flex items-center gap-2">
        <Status tone="danger" icon={Undo2}>Reversed</Status>
        <span className="whitespace-nowrap text-xs text-slate-500">
          {formatDateHamilton(donation.reversed_at)}
        </span>
      </span>
    )
  }
  if (donation.cleared_at) {
    return (
      <span className="inline-flex items-center gap-2">
        <Status tone="ok" icon={CircleCheck}>Cleared</Status>
        <span className="whitespace-nowrap text-xs text-slate-500">
          {formatDateHamilton(donation.cleared_at)}
        </span>
      </span>
    )
  }
  const due = new Date(donation.clearance_due_at).getTime()
  if (due < now) {
    return (
      <span className="inline-flex items-center gap-2">
        <Status tone="warn" icon={TriangleAlert}>Held — past due</Status>
        <span className="whitespace-nowrap text-xs text-slate-500">
          due {formatDateHamilton(donation.clearance_due_at)}
        </span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-2">
      <Status tone="muted" icon={Hourglass}>Held</Status>
      <span className="whitespace-nowrap text-xs text-slate-500">
        clears {formatDateHamilton(donation.clearance_due_at)}
      </span>
    </span>
  )
}
