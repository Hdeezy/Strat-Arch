/**
 * GETTING PAID.
 *
 * This page previously told vendors they would be paid "via Stripe Connect".
 * That is not how it works and never will be under the current design:
 * Connect was removed (Scrappy Cut §3 — the Foundation uses its own Stripe
 * account), and settlement deliberately has no automated payout path at all.
 * A human reads the instruction list and makes a bank transfer, which is the
 * RPAA boundary and shape decision 7.
 *
 * Telling a shop owner their money arrives automatically when it actually
 * depends on someone doing a transfer is the kind of wrong that costs
 * goodwill the first time a payment is late. So this page says plainly how
 * it really happens, and roughly when.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import { Wallet, Info } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function MerchantReconcilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=/merchant/reconcile')

  const admin = createAdminClient()
  const { data: staffRow } = await admin
    .from('merchant_staff')
    .select('merchant_id, merchant:merchants(name, payout_schedule_days)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()

  const staff = staffRow as unknown as {
    merchant_id: string
    merchant: { name: string; payout_schedule_days: number } | { name: string; payout_schedule_days: number }[] | null
  } | null

  if (!staff) redirect('/merchant')

  const merchant = Array.isArray(staff.merchant) ? staff.merchant[0] : staff.merchant
  const days = merchant?.payout_schedule_days ?? 7

  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data } = await admin
    .from('redemptions')
    .select('id, amount_cents, occurred_at, card:cards(card_code)')
    .eq('merchant_id', staff.merchant_id)
    .eq('status', 'succeeded')
    .gte('occurred_at', since.toISOString())
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
      <div className="bg-hope-dark rounded-2xl p-5 text-white">
        <p className="text-base text-hope-light">You&apos;re owed</p>
        <p className="text-5xl font-bold leading-none mt-2 tabular-nums">{formatCAD(total)}</p>
        <p className="text-base text-hope-light mt-2">
          {rows.length} payment{rows.length === 1 ? '' : 's'} in the last {days} days
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 flex-none text-hope-green" strokeWidth={2} aria-hidden="true" />
          <h2 className="text-lg font-bold text-slate-900">How you get paid</h2>
        </div>
        <p className="text-base text-slate-700">
          Roughly every {days} days, the charity totals what every shop is owed and
          sends a bank transfer. A person does that — it is not automatic, and it is
          deliberately not automatic.
        </p>
        <p className="text-base text-slate-700">
          The card itself never moves money to you. It records what was spent, and
          the charity settles up against that record.
        </p>
        <div className="flex gap-2.5 pt-1">
          <Info className="h-4 w-4 flex-none text-slate-400 mt-0.5" strokeWidth={2} aria-hidden="true" />
          <p className="text-sm text-slate-600">
            If a transfer looks late or the total doesn&apos;t match your till, contact the
            charity with this page open. The list below is the same record they settle
            from.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 px-6 py-12 text-center">
          <Wallet className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.5} aria-hidden="true" />
          <p className="mt-3 text-lg font-semibold text-slate-900">Nothing owed right now</p>
          <p className="mt-1 text-base text-slate-600">
            Payments you take will appear here and be settled on the next transfer.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-slate-900">
            What that total is made of
          </h2>
          <ul className="space-y-2">
            {rows.map(r => (
              <li
                key={r.id}
                className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-base font-medium text-slate-900">
                    {r.card?.card_code ?? '—'}
                  </p>
                  <p className="text-sm text-slate-500">{formatDateHamilton(r.occurred_at)}</p>
                </div>
                <p className="text-lg font-bold text-slate-900 tabular-nums">
                  {formatCAD(r.amount_cents)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
