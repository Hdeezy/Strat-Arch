/**
 * TILL HOME.
 *
 * One job: get to the scanner. Everything else on this screen is smaller
 * than the button, because a customer is standing there.
 */

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { formatCAD } from '@/lib/utils'
import Link from 'next/link'
import { ScanLine, ChevronRight, ReceiptText, Wallet } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function MerchantHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=/merchant')

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
    .select('amount_cents')
    .eq('merchant_id', staff.merchant_id)
    .eq('status', 'succeeded')
    .gte('occurred_at', midnight.toISOString())

  const rows = (data ?? []) as unknown as { amount_cents: number }[]
  const todayTotal = rows.reduce((s, r) => s + Number(r.amount_cents), 0)

  return (
    <div className="space-y-5">
      {/* The button is the page. */}
      <Link
        href="/merchant/scan"
        className="flex flex-col items-center justify-center gap-3 w-full bg-hope-green hover:bg-hope-teal
                   text-white rounded-2xl py-10 transition-colors
                   focus:outline-none focus-visible:ring-4 focus-visible:ring-hope-green/40"
      >
        <ScanLine className="h-14 w-14" strokeWidth={1.75} aria-hidden="true" />
        <span className="text-2xl font-bold">Take a payment</span>
        <span className="text-base text-hope-pale">Scan the card, or type its code</span>
      </Link>

      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <p className="text-base font-medium text-slate-600">Taken today</p>
        <p className="text-5xl font-bold text-slate-900 leading-none mt-2 tabular-nums">
          {formatCAD(todayTotal)}
        </p>
        <p className="text-base text-slate-500 mt-2">
          {rows.length === 0
            ? 'No HOPE Card payments yet today'
            : `${rows.length} payment${rows.length === 1 ? '' : 's'}`}
        </p>
      </div>

      <div className="space-y-3">
        <Link
          href="/merchant/history"
          className="flex items-center gap-4 w-full bg-white hover:bg-slate-50 border border-slate-200 rounded-2xl p-4 transition-colors
                     focus:outline-none focus-visible:ring-4 focus-visible:ring-hope-green/40"
        >
          <ReceiptText className="h-6 w-6 flex-none text-hope-green" strokeWidth={2} aria-hidden="true" />
          <span className="flex-1 text-lg font-bold text-slate-900">Today&apos;s payments</span>
          <ChevronRight className="h-6 w-6 flex-none text-slate-400" strokeWidth={2.5} aria-hidden="true" />
        </Link>

        <Link
          href="/merchant/reconcile"
          className="flex items-center gap-4 w-full bg-white hover:bg-slate-50 border border-slate-200 rounded-2xl p-4 transition-colors
                     focus:outline-none focus-visible:ring-4 focus-visible:ring-hope-green/40"
        >
          <Wallet className="h-6 w-6 flex-none text-hope-green" strokeWidth={2} aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className="block text-lg font-bold text-slate-900">Getting paid</span>
            <span className="block text-sm text-slate-600">What you&apos;re owed and when it arrives</span>
          </span>
          <ChevronRight className="h-6 w-6 flex-none text-slate-400" strokeWidth={2.5} aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}
