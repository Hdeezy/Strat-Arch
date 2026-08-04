/**
 * VENDORS — the counters where cards are spent.
 *
 * A vendor's category is a gate, not a label: a card allowing food will be
 * refused at a vendor whose category is clothing. So the category column is
 * operational information, and getting it wrong on a row means cards
 * silently fail at that counter.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { CATEGORY_LABELS, type CardCategory } from '@/lib/types'
import {
  PageHeader, Panel, Status, Table, THead, TH, TBody, TR, TD, Empty,
} from '@/components/ui/primitives'
import { Store } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function AdminMerchantsPage() {
  const admin = createAdminClient()

  const { data } = await admin
    .from('merchants')
    .select('*, charity:charities(name)')
    .order('is_active', { ascending: false })
    .order('name', { ascending: true })

  const merchants = (data ?? []) as unknown as {
    id: string
    name: string
    address: string
    category: CardCategory
    is_active: boolean
    trust_score: number
    payout_schedule_days: number
    charity: { name: string } | null
  }[]

  const active = merchants.filter(m => m.is_active).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendors"
        description="Where cards can be spent. A vendor's category decides which cards it will accept."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Panel className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Accepting cards</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">{active}</p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Not accepting</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">
            {merchants.length - active}
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Categories covered</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">
            {new Set(merchants.filter(m => m.is_active).map(m => m.category)).size}
          </p>
        </Panel>
      </div>

      {merchants.length === 0 ? (
        <Panel>
          <Empty
            icon={Store}
            title="No vendors yet"
            description="Until at least one vendor is active, a funded card has nowhere to be spent. Vendors are onboarded manually at pilot scale."
          />
        </Panel>
      ) : (
        <Table>
          <THead>
            <TH>Vendor</TH>
            <TH>Address</TH>
            <TH>Accepts</TH>
            <TH>Programme</TH>
            <TH align="right">Payout</TH>
            <TH>Status</TH>
          </THead>
          <TBody>
            {merchants.map(m => (
              <TR key={m.id} className={m.is_active ? undefined : 'opacity-60'}>
                <TD className="font-medium text-slate-900">{m.name}</TD>
                <TD className="text-slate-500">{m.address}</TD>
                <TD>{CATEGORY_LABELS[m.category] ?? m.category}</TD>
                <TD className="text-slate-500">{m.charity?.name ?? '—'}</TD>
                <TD align="right" className="text-slate-500 tabular-nums whitespace-nowrap">
                  every {m.payout_schedule_days}d
                </TD>
                <TD>
                  {m.is_active
                    ? <Status tone="ok">Accepting</Status>
                    : <Status tone="muted">Paused</Status>}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  )
}
