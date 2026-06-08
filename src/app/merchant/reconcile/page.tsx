import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'
import { formatCAD, formatDateHamilton } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function MerchantReconcilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login?redirectTo=/merchant/reconcile')

  const admin = createAdminClient()
  const { data: staffRecord } = await admin
    .from('merchant_staff')
    .select('merchant_id, merchant:merchants(name, payout_schedule_days)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!staffRecord) redirect('/merchant')

  const merchant = staffRecord.merchant as unknown as { name: string; payout_schedule_days: number } | null

  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - (merchant?.payout_schedule_days || 7))

  const { data: redemptions } = await admin
    .from('redemptions')
    .select('*, card:cards(card_code)')
    .eq('merchant_id', staffRecord.merchant_id)
    .eq('status', 'succeeded')
    .gte('occurred_at', weekAgo.toISOString())
    .order('occurred_at', { ascending: false })

  const weekTotal = redemptions?.reduce((sum, r) => sum + r.amount_cents, 0) || 0
  const count = redemptions?.length || 0

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-hope-dark">Weekly Reconciliation</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Last {merchant?.payout_schedule_days || 7} days · {merchant?.name}
        </p>
      </div>

      <div className="bg-hope-dark rounded-2xl p-5 text-white space-y-1">
        <div className="text-xs text-hope-light">Total Redeemed This Week</div>
        <div className="text-4xl font-bold">{formatCAD(weekTotal)}</div>
        <div className="text-sm text-hope-light">{count} transactions</div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-4 space-y-1">
        <div className="text-xs text-muted-foreground">Payout Schedule</div>
        <div className="text-sm font-medium text-hope-dark">
          Every {merchant?.payout_schedule_days || 7} days via Stripe Connect
        </div>
        <div className="text-xs text-muted-foreground">
          Living Rock Ministries will transfer funds to your registered bank account
        </div>
      </div>

      {count > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-hope-dark">Transactions</div>
          {redemptions?.map(r => {
            const card = r.card as { card_code: string } | null
            return (
              <div key={r.id} className="bg-white rounded-xl shadow-sm p-3 flex items-center justify-between">
                <div>
                  <div className="font-mono text-sm font-medium">{card?.card_code}</div>
                  <div className="text-xs text-muted-foreground">{formatDateHamilton(r.occurred_at)}</div>
                </div>
                <div className="font-semibold text-hope-dark">{formatCAD(r.amount_cents)}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
