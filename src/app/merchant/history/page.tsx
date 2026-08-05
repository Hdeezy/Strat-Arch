/**
 * TODAY'S PAYMENTS.
 *
 * Shows the card CODE, never anything about the person holding it. The
 * counter needs to match a line to a sale; it has no business knowing who
 * anyone is.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import { ReceiptText } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function MerchantHistoryPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=/merchant/history')

  const admin = createAdminClient()
  const { data: staff } = await admin
    .from('merchant_staff')
    .select('merchant_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  if (!staff) redirect('/merchant')

  const midnight = new Date()
  midnight.setHours(0, 0, 0, 0)

  const { data } = await admin
    .from('redemptions')
    .select('id, amount_cents, occurred_at, card:cards(card_code)')
    .eq('merchant_id', staff.merchant_id)
    .eq('status', 'succeeded')
    .gte('occurred_at', midnight.toISOString())
    .order('occurred_at', { ascending: false })

  const rows = (data ?? []) as unknown as {
    id: string
    amount_cents: number
    occurred_at: string
    card: { card_code: string } | null
  }[]

  const total = rows.reduce((s, r) => s + Number(r.amount_cents), 0)

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <p className="text-base font-medium text-slate-600">Taken today</p>
        <p className="text-4xl font-bold text-slate-900 leading-none mt-2 tabular-nums">
          {formatCAD(total)}
        </p>
        <p className="text-base text-slate-500 mt-2">
          {rows.length} payment{rows.length === 1 ? '' : 's'}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 px-6 py-12 text-center">
          <ReceiptText className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.5} aria-hidden="true" />
          <p className="mt-3 text-lg font-semibold text-slate-900">Nothing yet today</p>
          <p className="mt-1 text-base text-slate-600">
            Payments appear here the moment you take one.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map(r => (
            <li
              key={r.id}
              className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <p className="font-mono text-base font-semibold text-slate-900">
                  {r.card?.card_code ?? '—'}
                </p>
                <p className="text-sm text-slate-500">{formatDateHamilton(r.occurred_at)}</p>
              </div>
              <p className="text-xl font-bold text-slate-900 tabular-nums">
                {formatCAD(r.amount_cents)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
