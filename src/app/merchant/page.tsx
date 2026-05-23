import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { formatCAD, formatDateHamilton } from '@/lib/utils'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function MerchantHomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=/merchant')

  const admin = createAdminClient()
  const { data: staffRecord } = await admin
    .from('merchant_staff')
    .select('merchant_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!staffRecord) redirect('/auth/login')

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const { data: todayRedemptions } = await admin
    .from('redemptions')
    .select('amount_cents')
    .eq('merchant_id', staffRecord.merchant_id)
    .eq('status', 'succeeded')
    .gte('occurred_at', today.toISOString())

  const todayTotal = todayRedemptions?.reduce((sum, r) => sum + r.amount_cents, 0) || 0
  const todayCount = todayRedemptions?.length || 0

  return (
    <div className="space-y-6">
      {/* Today's stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-hope-dark text-white rounded-2xl p-4">
          <div className="text-xs text-hope-light">Today&apos;s Volume</div>
          <div className="text-2xl font-bold mt-1">{formatCAD(todayTotal)}</div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <div className="text-xs text-muted-foreground">Transactions</div>
          <div className="text-2xl font-bold text-hope-dark mt-1">{todayCount}</div>
        </div>
      </div>

      {/* Big scan button */}
      <Link
        href="/merchant/scan"
        className="block w-full bg-hope-green hover:bg-hope-teal text-white rounded-2xl py-8 text-center transition-colors"
      >
        <div className="text-5xl mb-3">📷</div>
        <div className="text-xl font-bold">Scan HOPE Card</div>
        <div className="text-sm text-hope-light mt-1">Open camera to accept payment</div>
      </Link>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/merchant/history" className="bg-white rounded-2xl shadow-sm p-4 text-center hover:bg-hope-pale transition-colors">
          <div className="text-2xl mb-1">📋</div>
          <div className="text-sm font-semibold text-hope-dark">Transaction History</div>
        </Link>
        <Link href="/merchant/reconcile" className="bg-white rounded-2xl shadow-sm p-4 text-center hover:bg-hope-pale transition-colors">
          <div className="text-2xl mb-1">💰</div>
          <div className="text-sm font-semibold text-hope-dark">Weekly Reconcile</div>
        </Link>
      </div>
    </div>
  )
}
