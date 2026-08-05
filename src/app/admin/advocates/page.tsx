/**
 * ADVOCATES — the people who hand cards to people.
 *
 * Screening is a policy artifact rather than a screen (Scrappy Cut §3: the
 * advocate lifecycle UI is cut, replaced by a column and a manual seed). So
 * this page reports state; it does not manage it. Adding or deactivating an
 * advocate is still a database change, and the page says so rather than
 * offering buttons that do not exist.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { formatDateHamilton } from '@/lib/utils'
import {
  PageHeader, Panel, Status, Table, THead, TH, TBody, TR, TD, Empty,
} from '@/components/ui/primitives'
import { Users, Info } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function AdminAdvocatesPage() {
  const admin = createAdminClient()

  const { data } = await admin
    .from('advocates')
    .select('*, charity:charities(name)')
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: false })

  const advocates = (data ?? []) as unknown as {
    id: string
    full_name: string
    phone: string | null
    is_active: boolean
    created_at: string
    charity: { name: string } | null
  }[]

  const active = advocates.filter(a => a.is_active).length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Advocates"
        description="Outreach workers authorised to load cards and hand them out."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Panel className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Active</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">{active}</p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Inactive</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">
            {advocates.length - active}
          </p>
        </Panel>
        <Panel className="p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Total</p>
          <p className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">
            {advocates.length}
          </p>
        </Panel>
      </div>

      {advocates.length === 0 ? (
        <Panel>
          <Empty
            icon={Users}
            title="No advocates yet"
            description="Advocates are added by inserting a row against a screened account. Until one exists, nobody can load or hand out cards."
          />
        </Panel>
      ) : (
        <Table>
          <THead>
            <TH>Name</TH>
            <TH>Organisation</TH>
            <TH>Phone</TH>
            <TH>Status</TH>
            <TH align="right">Added</TH>
          </THead>
          <TBody>
            {advocates.map(a => (
              <TR key={a.id} className={a.is_active ? undefined : 'opacity-60'}>
                <TD className="font-medium text-slate-900">{a.full_name}</TD>
                <TD className="text-slate-500">{a.charity?.name ?? '—'}</TD>
                <TD className="text-slate-500">{a.phone ?? '—'}</TD>
                <TD>
                  {a.is_active
                    ? <Status tone="ok">Active</Status>
                    : <Status tone="muted">Inactive</Status>}
                </TD>
                <TD align="right" className="text-slate-500 whitespace-nowrap">
                  {formatDateHamilton(a.created_at)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Panel className="p-4 flex gap-3">
        <Info className="h-4 w-4 flex-none text-slate-400 mt-0.5" strokeWidth={2} aria-hidden="true" />
        <p className="text-sm text-slate-600">
          Advocates are added and deactivated in the database, not here. Screening
          happens before that row exists, and keeping it a deliberate manual step is
          the point — permissions bind to a screened state rather than to a button
          someone can click.
        </p>
      </Panel>
    </div>
  )
}
