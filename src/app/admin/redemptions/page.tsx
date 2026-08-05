/**
 * REDEMPTIONS — every capture, newest first.
 *
 * Shows the CAPTURED amount, which is what the vendor is owed and what the
 * member actually spent. Under the two-phase model an authorization reserves
 * the whole room available and the capture takes only what was rung up, so
 * "authorized" and "spent" are different numbers and only one of them is
 * money owed to anybody.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { formatDateHamilton } from '@/lib/utils'
import {
  PageHeader, Panel, Money, Status, Table, THead, TH, TBody, TR, TD, Empty,
} from '@/components/ui/primitives'
import { Receipt } from 'lucide-react'

export const dynamic = 'force-dynamic'

const STATUS_TONE = {
  succeeded: 'ok',
  failed: 'danger',
  pending: 'warn',
  refunded: 'muted',
} as const

export default async function AdminRedemptionsPage() {
  const admin = createAdminClient()

  const { data } = await admin
    .from('redemptions')
    .select('*, card:cards(card_code), merchant:merchants(name, category)')
    .order('occurred_at', { ascending: false })
    .limit(200)

  const rows = (data ?? []) as unknown as {
    id: string
    amount_cents: number
    status: keyof typeof STATUS_TONE
    occurred_at: string
    card: { card_code: string } | null
    merchant: { name: string; category: string } | null
  }[]

  const succeeded = rows.filter(r => r.status === 'succeeded')
  const total = succeeded.reduce((s, r) => s + Number(r.amount_cents), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Redemptions"
        description="Every capture at a vendor counter. The amount shown is what was actually spent, not what was held."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Panel className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total captured</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">
            <Money cents={total} />
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Successful</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">
            {succeeded.length}
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Average</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">
            <Money cents={succeeded.length ? Math.round(total / succeeded.length) : 0} />
          </p>
        </Panel>
      </div>

      {rows.length === 0 ? (
        <Panel>
          <Empty
            icon={Receipt}
            title="No redemptions yet"
            description="A row appears here the first time a vendor captures against a card. Until then, cards may be funded but nothing has been spent."
          />
        </Panel>
      ) : (
        <Table>
          <THead>
            <TH>When</TH>
            <TH>Card</TH>
            <TH>Vendor</TH>
            <TH align="right">Amount</TH>
            <TH>Status</TH>
          </THead>
          <TBody>
            {rows.map(r => (
              <TR key={r.id}>
                <TD className="text-slate-500 whitespace-nowrap">
                  {formatDateHamilton(r.occurred_at)}
                </TD>
                <TD mono className="font-semibold text-slate-900">
                  {r.card?.card_code ?? '—'}
                </TD>
                <TD>{r.merchant?.name ?? '—'}</TD>
                <TD align="right" className="font-semibold">
                  <Money cents={r.amount_cents} />
                </TD>
                <TD>
                  <Status tone={STATUS_TONE[r.status] ?? 'muted'}>{r.status}</Status>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {rows.length >= 200 && (
        <p className="text-xs text-slate-500">
          Showing the most recent 200. Use the CSV export for the full record.
        </p>
      )}
    </div>
  )
}
